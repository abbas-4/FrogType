import { getWordList } from '../data/wordlists';
import type { Difficulty, Language } from '../types';
import { createRng } from './random';

export interface WordOptions {
  language: Language;
  difficulty: Difficulty;
  punctuation: boolean;
  numbers: boolean;
}

const PUNCT_END = ['.', '.', '.', ',', ',', ',', '?', '!', ';', ':'];

/** Generates `count` words starting at word position `offset` (so appended batches keep sentence state sane). */
export function generateWords(count: number, opts: WordOptions, rng: () => number, prev?: string): string[] {
  const list = getWordList(opts.language, opts.difficulty);
  const out: string[] = [];
  let last = prev ?? '';
  let capitalizeNext = !prev || /[.?!]$/.test(prev);
  for (let i = 0; i < count; i++) {
    let w: string;
    if (opts.numbers && rng() < 0.1) {
      w = String(Math.floor(rng() * 10 ** (1 + Math.floor(rng() * 4))));
    } else {
      // avoid immediate repeats
      do {
        w = list[Math.floor(rng() * list.length)] ?? 'the';
      } while (w === last && list.length > 1);
    }
    if (opts.punctuation) {
      if (capitalizeNext) w = w.charAt(0).toUpperCase() + w.slice(1);
      capitalizeNext = false;
      if (rng() < 0.15) {
        const p = PUNCT_END[Math.floor(rng() * PUNCT_END.length)] ?? '.';
        w += p;
        if (p === '.' || p === '?' || p === '!') capitalizeNext = true;
      } else if (rng() < 0.03) {
        w = `"${w}"`;
      }
    }
    out.push(w);
    last = w;
  }
  return out;
}

export function generateSeededWords(count: number, opts: WordOptions, seed: number): string[] {
  return generateWords(count, opts, createRng(seed));
}

/** Splits user-provided text into words; collapses whitespace and strips control chars. */
export function textToWords(text: string): string[] {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2000);
}
