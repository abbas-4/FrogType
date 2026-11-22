import { generateSeededWords } from '../engine/words';
import { hashString } from '../engine/random';

export interface DailyChallenge {
  date: string; // UTC YYYY-MM-DD
  words: string[];
  targetWpm: number;
  targetAccuracy: number;
}

/**
 * Deterministic: every client computes the same challenge for a UTC date.
 * Bump CHALLENGE_VERSION if the word list or generator changes, so dates never silently change content mid-day.
 */
export const CHALLENGE_VERSION = 1;

export function dailyChallenge(date: string): DailyChallenge {
  const seed = hashString(`frogtype-daily-v${CHALLENGE_VERSION}-${date}`);
  const words = generateSeededWords(30, { language: 'english', difficulty: 'normal', punctuation: true, numbers: false }, seed);
  return {
    date,
    words,
    targetWpm: 35 + (seed % 6) * 5, // 35..60
    targetAccuracy: 92 + ((seed >>> 8) % 5), // 92..96
  };
}

export function meetsTarget(c: DailyChallenge, wpm: number, accuracy: number): boolean {
  return wpm >= c.targetWpm && accuracy >= c.targetAccuracy;
}
