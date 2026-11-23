import { engineReducer, finalStats, initEngine, type EngineAction } from '../src/engine/core';
import { toPayload } from '../src/services/cloud';
import type { TestResult } from '../src/types';

export * from './env';

/**
 * Drives the real typing engine like a person: variable key gaps, optional typos fixed with backspace and one
 * delete-word. Returns the TestResult the app would build, including the keylog.
 */
export function simulateTyping(words: string[], opts: { msPerKey?: number; typos?: boolean; limit?: { kind: 'time'; seconds: number } | { kind: 'words' } } = {}) {
  const ms = opts.msPerKey ?? 110;
  let s = initEngine(words, opts.limit ?? { kind: 'words' }, 'pending');
  let now = 1000;
  let i = 0;
  const act = (a: EngineAction) => (s = engineReducer(s, a));
  const gap = () => (now += ms * (0.6 + ((i++ * 7919) % 97) / 97));
  words.forEach((w, wi) => {
    if (opts.typos && wi === 1) {
      act({ type: 'char', char: 'z', now: gap() });
      act({ type: 'backspace', word: false, now: gap() });
    }
    if (opts.typos && wi === 3) {
      act({ type: 'char', char: w[0]!, now: gap() });
      act({ type: 'char', char: 'q', now: gap() });
      act({ type: 'backspace', word: true, now: gap() });
    }
    for (const ch of w) act({ type: 'char', char: ch, now: gap() });
    if (wi < words.length - 1) act({ type: 'space', now: gap() });
  });
  if (s.finishedAt === null) act({ type: 'timeout' });
  const f = finalStats(s);
  const r: TestResult = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    mode: opts.limit?.kind === 'time' ? 'time' : 'words',
    mode2: opts.limit?.kind === 'time' ? opts.limit.seconds : words.length,
    wpm: f.wpm,
    raw: f.raw,
    accuracy: f.accuracy,
    consistency: f.consistency,
    chars: f.chars,
    durationMs: Math.round(f.durationMs),
    wordsTyped: f.wordsTyped,
    language: 'english',
    punctuation: false,
    numbers: false,
    difficulty: 'normal',
    samples: s.samples,
    charStats: s.charStats,
    bigramErrors: s.bigramErrors,
    valid: f.valid,
    keylog: s.keylog,
  };
  return r;
}

export const payloadFor = (r: TestResult, challengeId: string) => toPayload({ ...r, challengeId });

