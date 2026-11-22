import type { TestResult } from '../src/types';

let n = 0;
export function makeResult(over: Partial<TestResult> = {}): TestResult {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    createdAt: '2026-11-22T12:00:00.000Z',
    mode: 'time',
    mode2: 30,
    wpm: 60,
    raw: 62,
    accuracy: 96,
    consistency: 80,
    chars: { correct: 150, incorrect: 3, extra: 0, missed: 0 },
    durationMs: 30000,
    wordsTyped: 30,
    language: 'english',
    punctuation: false,
    numbers: false,
    difficulty: 'normal',
    samples: [],
    charStats: {},
    bigramErrors: {},
    valid: true,
    ...over,
  };
}
