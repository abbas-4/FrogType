import type { TestResult } from '../types';
import { lessons, type Lesson } from './lessons';

export const MIN_TESTS_FOR_ANALYSIS = 3;
export const MIN_CHARS_FOR_ANALYSIS = 500;
const MIN_ATTEMPTS_PER_KEY = 15;

export interface WeakKey {
  char: string;
  attempts: number;
  errorRate: number;
}

export interface Analysis {
  enoughData: boolean;
  testsAnalyzed: number;
  charsAnalyzed: number;
  overallErrorRate: number;
  weakKeys: WeakKey[];
  weakBigrams: { bigram: string; errors: number }[];
  avgWpm: number;
  avgAccuracy: number;
  pattern: 'accuracy' | 'speed' | 'balanced' | null;
  recommendations: { lesson: Lesson; reason: string }[];
}

/** Uses the latest 50 valid tests. Returns enoughData=false rather than guessing when there is too little data. */
export function analyze(history: TestResult[]): Analysis {
  const recent = history.filter((t) => t.valid).slice(-50);
  const agg: Record<string, [number, number]> = {};
  const bigrams: Record<string, number> = {};
  let chars = 0;
  let errs = 0;
  for (const t of recent) {
    for (const [ch, [a, e]] of Object.entries(t.charStats)) {
      const k = ch.toLowerCase();
      const prev = agg[k] ?? [0, 0];
      agg[k] = [prev[0] + a, prev[1] + e];
      chars += a;
      errs += e;
    }
    for (const [b, n] of Object.entries(t.bigramErrors)) bigrams[b.toLowerCase()] = (bigrams[b.toLowerCase()] ?? 0) + n;
  }
  const avgWpm = recent.length ? recent.reduce((a, t) => a + t.wpm, 0) / recent.length : 0;
  const avgAccuracy = recent.length ? recent.reduce((a, t) => a + t.accuracy, 0) / recent.length : 0;
  const overallErrorRate = chars ? errs / chars : 0;
  const enoughData = recent.length >= MIN_TESTS_FOR_ANALYSIS && chars >= MIN_CHARS_FOR_ANALYSIS;

  const base: Analysis = {
    enoughData,
    testsAnalyzed: recent.length,
    charsAnalyzed: chars,
    overallErrorRate,
    weakKeys: [],
    weakBigrams: [],
    avgWpm,
    avgAccuracy,
    pattern: null,
    recommendations: [],
  };
  if (!enoughData) return base;

  const threshold = Math.max(overallErrorRate * 1.5, 0.03);
  const weakKeys = Object.entries(agg)
    .filter(([ch, [a]]) => a >= MIN_ATTEMPTS_PER_KEY && ch.trim() !== '')
    .map(([char, [attempts, e]]) => ({ char, attempts, errorRate: e / attempts }))
    .filter((k) => k.errorRate >= threshold)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 6);
  const weakBigrams = Object.entries(bigrams)
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([bigram, errors]) => ({ bigram: bigram.replace(' ', '␣'), errors }));

  const pattern = avgAccuracy < 92 ? 'accuracy' : avgAccuracy >= 96 ? 'speed' : 'balanced';

  const recs: { lesson: Lesson; reason: string }[] = [];
  const add = (lesson: Lesson | undefined, reason: string) => {
    if (lesson && !recs.some((r) => r.lesson.id === lesson.id)) recs.push({ lesson, reason });
  };
  if (weakKeys.length) {
    const scored = lessons
      .filter((l) => l.category !== 'accuracy' && l.category !== 'speed')
      .map((l) => ({ l, hits: weakKeys.filter((k) => l.keys.includes(k.char)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    for (const { l } of scored.slice(0, 2)) {
      const hit = weakKeys.filter((k) => l.keys.includes(k.char)).map((k) => k.char.toUpperCase());
      add(l, `Trains ${hit.join(', ')} — your highest-error keys.`);
    }
  }
  if (pattern === 'accuracy') add(lessons.find((l) => l.id === 'accuracy-1'), `Your average accuracy is ${avgAccuracy.toFixed(1)}%. Slowing down will raise your real speed.`);
  if (pattern === 'speed') add(lessons.find((l) => l.id === 'speed-1'), `Accuracy is strong (${avgAccuracy.toFixed(1)}%). You can push the tempo.`);
  return { ...base, weakKeys, weakBigrams, pattern, recommendations: recs };
}

/** Builds a drill text from words containing the user's weak keys. */
export function weakKeyDrill(weak: string[], wordList: string[], count = 30): string[] {
  const pool = wordList.filter((w) => weak.some((c) => w.includes(c)));
  if (pool.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(pool[(i * 7919) % pool.length] ?? pool[0]!);
  return out;
}
