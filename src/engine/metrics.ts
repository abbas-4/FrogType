import type { CharCounts } from '../types';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Standard WPM: 5 characters = 1 word. */
export function calcWpm(chars: number, ms: number): number {
  if (ms <= 0) return 0;
  return round2((chars / 5) / (ms / 60000));
}

/** Keystroke accuracy: correct keystrokes / total keystrokes (corrected errors still count against you). */
export function calcAccuracy(correctKeystrokes: number, keystrokes: number): number {
  if (keystrokes <= 0) return 0;
  return round2((correctKeystrokes / keystrokes) * 100);
}

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Consistency 0-100 from per-second raw WPM, mapping coefficient of variation through a tanh curve. */
export function calcConsistency(perSecondRaw: number[]): number {
  if (perSecondRaw.length < 2) return 0;
  const m = mean(perSecondRaw);
  if (m === 0) return 0;
  const cv = stdDev(perSecondRaw) / m;
  const k = 1 - Math.tanh(cv + cv ** 3 / 3 + cv ** 5 / 5);
  return round2(Math.max(0, Math.min(100, k * 100)));
}

export interface CharBreakdown extends CharCounts {
  /** characters that count toward WPM: chars of correct words + their trailing spaces */
  wpmChars: number;
  /** every typed character including spaces and errors */
  rawChars: number;
  correctWords: number;
}

/**
 * Character accounting over committed words (index < wordIndex) and the current partial word.
 * `finished` + partial word: counted if it is a correct prefix (time ran out mid-word).
 */
export function countChars(words: string[], inputs: string[], wordIndex: number, includePartial: boolean): CharBreakdown {
  const r: CharBreakdown = { correct: 0, incorrect: 0, extra: 0, missed: 0, wpmChars: 0, rawChars: 0, correctWords: 0 };
  const last = Math.min(wordIndex, words.length - 1);
  for (let i = 0; i <= last; i++) {
    const word = words[i] ?? '';
    const input = inputs[i] ?? '';
    const committed = i < wordIndex;
    if (!committed && !includePartial) break;
    for (let c = 0; c < Math.max(word.length, input.length); c++) {
      const typed = input[c];
      const expected = word[c];
      if (typed === undefined) {
        if (committed) r.missed++;
      } else if (expected === undefined) r.extra++;
      else if (typed === expected) r.correct++;
      else r.incorrect++;
    }
    r.rawChars += input.length + (committed ? 1 : 0);
    if (committed) {
      if (input === word) {
        r.correctWords++;
        r.wpmChars += word.length + 1;
      }
    } else if (input.length > 0 && word.startsWith(input)) {
      r.wpmChars += input.length;
      if (input === word) r.correctWords++;
    }
  }
  return r;
}
