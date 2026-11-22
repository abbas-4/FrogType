import type { CharStats, Sample } from '../types';
import { calcAccuracy, calcConsistency, calcWpm, countChars, round2 } from './metrics';

export type Limit = { kind: 'time'; seconds: number } | { kind: 'words' };

export interface EngineState {
  words: string[];
  inputs: string[];
  wordIndex: number;
  limit: Limit;
  startedAt: number | null;
  finishedAt: number | null;
  keystrokes: number;
  correctKeystrokes: number;
  charStats: CharStats;
  bigramErrors: Record<string, number>;
  samples: Sample[];
  /** keystroke / error counters at the last sample boundary */
  sampleKeys: number;
  sampleErrors: number;
}

export type EngineAction =
  | { type: 'char'; char: string; now: number }
  | { type: 'space'; now: number }
  | { type: 'backspace'; word: boolean }
  | { type: 'tick'; now: number }
  | { type: 'timeout' }
  | { type: 'append'; words: string[] }
  | { type: 'reset'; words: string[]; limit: Limit };

const MAX_EXTRA = 10;

export function initEngine(words: string[], limit: Limit): EngineState {
  return {
    words,
    inputs: [''],
    wordIndex: 0,
    limit,
    startedAt: null,
    finishedAt: null,
    keystrokes: 0,
    correctKeystrokes: 0,
    charStats: {},
    bigramErrors: {},
    samples: [],
    sampleKeys: 0,
    sampleErrors: 0,
  };
}

function errors(s: EngineState) {
  return s.keystrokes - s.correctKeystrokes;
}

/** Push one sample per completed second up to `elapsedMs`. Fractional final second only when finishing. */
function fillSamples(s: EngineState, elapsedMs: number, final: boolean): EngineState {
  let st = s;
  const whole = Math.floor(elapsedMs / 1000);
  const push = (t: number, span: number) => {
    const c = countChars(st.words, st.inputs, st.wordIndex, true);
    const keys = st.keystrokes - st.sampleKeys;
    const errs = errors(st) - st.sampleErrors;
    const sample: Sample = {
      t: round2(t),
      wpm: calcWpm(c.wpmChars, t * 1000),
      raw: calcWpm(keys, span * 1000),
      errors: errs,
    };
    st = { ...st, samples: [...st.samples, sample], sampleKeys: st.keystrokes, sampleErrors: errors(st) };
  };
  while (st.samples.length < whole) push(st.samples.length + 1, 1);
  if (final) {
    const remainder = elapsedMs / 1000 - whole;
    if (remainder >= 0.25) push(elapsedMs / 1000, remainder);
  }
  return st;
}

function finish(s: EngineState, at: number): EngineState {
  if (s.startedAt === null) return s;
  const filled = fillSamples(s, at - s.startedAt, true);
  return { ...filled, finishedAt: at };
}

function bump(stats: CharStats, ch: string, error: boolean): CharStats {
  const prev = stats[ch] ?? [0, 0];
  return { ...stats, [ch]: [prev[0] + 1, prev[1] + (error ? 1 : 0)] };
}

export function engineReducer(s: EngineState, a: EngineAction): EngineState {
  switch (a.type) {
    case 'reset':
      return initEngine(a.words, a.limit);
    case 'append':
      return { ...s, words: [...s.words, ...a.words] };
    case 'tick': {
      if (s.startedAt === null || s.finishedAt !== null) return s;
      const elapsed = a.now - s.startedAt;
      if (s.limit.kind === 'time' && elapsed >= s.limit.seconds * 1000) {
        return finish(s, s.startedAt + s.limit.seconds * 1000);
      }
      return Math.floor(elapsed / 1000) > s.samples.length ? fillSamples(s, elapsed, false) : s;
    }
    case 'timeout':
      if (s.startedAt === null || s.finishedAt !== null || s.limit.kind !== 'time') return s;
      return finish(s, s.startedAt + s.limit.seconds * 1000);
    case 'char': {
      if (s.finishedAt !== null) return s;
      const word = s.words[s.wordIndex] ?? '';
      const input = s.inputs[s.wordIndex] ?? '';
      if (input.length >= word.length + MAX_EXTRA) return s;
      const startedAt = s.startedAt ?? a.now;
      // A keystroke after the time limit belongs to no test.
      if (s.limit.kind === 'time' && a.now - startedAt >= s.limit.seconds * 1000) {
        return finish(s, startedAt + s.limit.seconds * 1000);
      }
      const expected = word[input.length];
      const correct = a.char === expected;
      const inputs = s.inputs.slice();
      const nextInput = input + a.char;
      inputs[s.wordIndex] = nextInput;
      let bigramErrors = s.bigramErrors;
      if (!correct && expected !== undefined) {
        const key = (input.length ? word[input.length - 1] : ' ') + expected;
        bigramErrors = { ...bigramErrors, [key]: (bigramErrors[key] ?? 0) + 1 };
      }
      const next: EngineState = {
        ...s,
        startedAt,
        inputs,
        keystrokes: s.keystrokes + 1,
        correctKeystrokes: s.correctKeystrokes + (correct ? 1 : 0),
        charStats: expected !== undefined ? bump(s.charStats, expected, !correct) : s.charStats,
        bigramErrors,
      };
      if (s.limit.kind === 'words' && s.wordIndex === s.words.length - 1 && nextInput === word) {
        return finish(next, a.now);
      }
      return next;
    }
    case 'space': {
      if (s.finishedAt !== null || s.startedAt === null) return s;
      const input = s.inputs[s.wordIndex] ?? '';
      if (input.length === 0) return s;
      if (s.limit.kind === 'time' && a.now - s.startedAt >= s.limit.seconds * 1000) {
        return finish(s, s.startedAt + s.limit.seconds * 1000);
      }
      const correct = input === s.words[s.wordIndex];
      const wordIndex = s.wordIndex + 1;
      const inputs = s.inputs.slice();
      if (inputs.length <= wordIndex) inputs.push('');
      const next: EngineState = {
        ...s,
        inputs,
        wordIndex,
        keystrokes: s.keystrokes + 1,
        correctKeystrokes: s.correctKeystrokes + (correct ? 1 : 0),
      };
      if (s.limit.kind === 'words' && wordIndex >= s.words.length) {
        return finish(next, a.now);
      }
      return next;
    }
    case 'backspace': {
      if (s.finishedAt !== null) return s;
      const input = s.inputs[s.wordIndex] ?? '';
      const inputs = s.inputs.slice();
      if (input.length > 0) {
        inputs[s.wordIndex] = a.word ? '' : input.slice(0, -1);
        return { ...s, inputs };
      }
      const prev = s.wordIndex - 1;
      // Only allow stepping back into a word that has a mistake.
      if (prev >= 0 && inputs[prev] !== s.words[prev]) {
        if (a.word) inputs[prev] = '';
        return { ...s, inputs, wordIndex: prev };
      }
      return s;
    }
  }
}

export interface LiveStats {
  wpm: number;
  raw: number;
  accuracy: number;
  elapsedMs: number;
}

export function liveStats(s: EngineState, now: number): LiveStats {
  if (s.startedAt === null) return { wpm: 0, raw: 0, accuracy: 100, elapsedMs: 0 };
  const end = s.finishedAt ?? now;
  const elapsedMs = Math.max(0, end - s.startedAt);
  const c = countChars(s.words, s.inputs, s.wordIndex, true);
  return {
    wpm: elapsedMs < 500 ? 0 : calcWpm(c.wpmChars, elapsedMs),
    raw: elapsedMs < 500 ? 0 : calcWpm(c.rawChars, elapsedMs),
    accuracy: s.keystrokes ? calcAccuracy(s.correctKeystrokes, s.keystrokes) : 100,
    elapsedMs,
  };
}

export interface FinalStats {
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  durationMs: number;
  chars: { correct: number; incorrect: number; extra: number; missed: number };
  wordsTyped: number;
  valid: boolean;
  invalidReason?: string;
}

export function finalStats(s: EngineState): FinalStats {
  const durationMs = s.startedAt !== null && s.finishedAt !== null ? s.finishedAt - s.startedAt : 0;
  const c = countChars(s.words, s.inputs, s.wordIndex, true);
  const stats: FinalStats = {
    wpm: calcWpm(c.wpmChars, durationMs),
    raw: calcWpm(c.rawChars, durationMs),
    accuracy: calcAccuracy(s.correctKeystrokes, s.keystrokes),
    consistency: calcConsistency(s.samples.map((x) => x.raw)),
    durationMs,
    chars: { correct: c.correct, incorrect: c.incorrect, extra: c.extra, missed: c.missed },
    wordsTyped: c.correctWords,
    valid: true,
  };
  const reason = invalidReason(stats, s);
  if (reason) {
    stats.valid = false;
    stats.invalidReason = reason;
  }
  return stats;
}

/** Guards against timer bugs, AFK and implausible runs. Invalid tests are shown but never saved to stats. */
export function invalidReason(f: Pick<FinalStats, 'wpm' | 'raw' | 'accuracy' | 'durationMs'>, s: EngineState): string | undefined {
  if (f.durationMs < 1000) return 'Test too short';
  if (s.keystrokes < 5) return 'Too few keystrokes';
  if (f.raw > 350 || f.wpm > 300) return 'Unrealistic speed';
  if (f.accuracy < 50) return 'Accuracy below 50%';
  if (s.limit.kind === 'time' && Math.abs(f.durationMs - s.limit.seconds * 1000) > 1000) return 'Timer mismatch';
  const idle = s.samples.filter((x) => x.raw === 0).length;
  if (s.samples.length >= 5 && idle / s.samples.length > 0.5) return 'Inactive for most of the test';
  return undefined;
}
