import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { engineReducer, initEngine, liveStats, type Limit, type LiveStats } from '../engine/core';
import { generateWords, type WordOptions } from '../engine/words';
import { randomSeed, createRng } from '../engine/random';

export type WordSource =
  | {
      kind: 'generated';
      options: WordOptions;
      limit: Limit;
      count: number;
      /** ranked tests: fetch a server-issued passage; when it arrives before the first keystroke it replaces the local words */
      challenge?: () => Promise<{ id: string; words: string[] } | null>;
    }
  | { kind: 'fixed'; words: string[] };

const BATCH = 60;

function initialWords(src: WordSource, rng: () => number): { words: string[]; limit: Limit } {
  if (src.kind === 'fixed') return { words: src.words, limit: { kind: 'words' } };
  const n = src.limit.kind === 'time' ? BATCH : src.count;
  return { words: generateWords(n, src.options, rng), limit: src.limit };
}

/**
 * Owns one typing test. `sourceKey` must change whenever the source changes (mode, options, text).
 * Timing uses performance.now(); the timer starts on the first keystroke.
 */
export function useTypingTest(source: WordSource, sourceKey: string) {
  const rngRef = useRef(createRng(randomSeed()));
  const sourceRef = useRef(source);
  const [state, dispatch] = useReducer(engineReducer, source, (src) => {
    const { words, limit } = initialWords(src, createRng(randomSeed()));
    return initEngine(words, limit);
  });
  const [tickLive, setLive] = useState<LiveStats>({ wpm: 0, raw: 0, accuracy: 100, elapsedMs: 0 });
  const live = useMemo(() => (state.finishedAt !== null ? liveStats(state, state.finishedAt) : tickLive), [state, tickLive]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    sourceRef.current = source;
  });

  // FT-01: the engine state carries the id of the server challenge whose words are on screen.
  const challengeReq = useRef(0);
  const challengeUsed = useRef(false);
  const requestChallenge = useCallback(() => {
    const req = ++challengeReq.current;
    challengeUsed.current = false;
    const src = sourceRef.current;
    if (src.kind !== 'generated' || !src.challenge) return;
    src.challenge().then(
      (c) => {
        // too late once typing started: that test stays unranked
        if (!c || req !== challengeReq.current || stateRef.current.startedAt !== null) return;
        dispatch({ type: 'reset', words: c.words, limit: stateRef.current.limit, challengeId: c.id });
      },
      () => {},
    );
  }, []);
  /** A challenge is single-use: call once its result has been recorded. */
  const consumeChallenge = useCallback(() => {
    challengeUsed.current = true;
  }, []);

  const restart = useCallback((repeat = false) => {
    const src = sourceRef.current;
    if (repeat) {
      const s = stateRef.current;
      // repeating a submitted passage is practice, not a ranked attempt
      dispatch({ type: 'reset', words: s.words, limit: s.limit, challengeId: challengeUsed.current ? null : s.challengeId });
    } else {
      rngRef.current = createRng(randomSeed());
      const { words, limit } = initialWords(src, rngRef.current);
      dispatch({ type: 'reset', words, limit });
      requestChallenge();
    }
    setLive({ wpm: 0, raw: 0, accuracy: 100, elapsedMs: 0 });
  }, [requestChallenge]);

  useEffect(() => {
    requestChallenge();
  }, [requestChallenge]);

  // New source -> new test.
  const firstKey = useRef(sourceKey);
  useEffect(() => {
    if (firstKey.current === sourceKey) return;
    firstKey.current = sourceKey;
    restart(false);
  }, [sourceKey, restart]);

  const running = state.startedAt !== null && state.finishedAt === null;

  // Timer: 100ms poll for sampling/timeout; live stats refresh every 250ms to avoid per-key re-render cost.
  useEffect(() => {
    if (!running) return;
    let n = 0;
    const id = window.setInterval(() => {
      const now = performance.now();
      dispatch({ type: 'tick', now });
      if (n++ % 2 === 0) setLive(liveStats(stateRef.current, now));
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);

  // Time mode: keep enough words ahead of the cursor.
  useEffect(() => {
    const src = sourceRef.current;
    if (src.kind !== 'generated' || state.limit.kind !== 'time' || state.challengeId !== null) return; // challenge passages are complete
    if (state.words.length - state.wordIndex < 40) {
      dispatch({ type: 'append', words: generateWords(BATCH, src.options, rngRef.current, state.words[state.words.length - 1]) });
    }
  }, [state.wordIndex, state.words, state.limit.kind, state.challengeId]);

  const type = useCallback((char: string) => dispatch({ type: 'char', char, now: performance.now() }), []);
  const space = useCallback(() => dispatch({ type: 'space', now: performance.now() }), []);
  const backspace = useCallback((word: boolean) => dispatch({ type: 'backspace', word, now: performance.now() }), []);

  return { state, live, running, finished: state.finishedAt !== null, type, space, backspace, restart, challengeId: state.challengeId, consumeChallenge };
}
