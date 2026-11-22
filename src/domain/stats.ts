import type { TestResult } from '../types';
import { addDays, localDay } from './dates';
import { calcStreaks } from './streaks';

export type Range = '7d' | '30d' | '90d' | 'all';

export function filterRange(history: TestResult[], range: Range, now: Date): TestResult[] {
  const valid = history.filter((t) => t.valid);
  if (range === 'all') return valid;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[range];
  const cutoff = now.getTime() - days * 86400000;
  return valid.filter((t) => Date.parse(t.createdAt) >= cutoff);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface Summary {
  tests: number;
  avgWpm: number;
  bestWpm: number;
  avgAccuracy: number;
  totalMs: number;
  totalWords: number;
  currentStreak: number;
  longestStreak: number;
  /** avg wpm of the last 10 tests minus the first 10 (in range); null when < 10 tests */
  improvement: number | null;
}

export function summarize(tests: TestResult[], allHistory: TestResult[], now: Date): Summary {
  const streaks = calcStreaks(allHistory.filter((t) => t.valid).map((t) => localDay(t.createdAt)), localDay(now));
  const n = Math.min(10, Math.floor(tests.length / 2));
  return {
    tests: tests.length,
    avgWpm: avg(tests.map((t) => t.wpm)),
    bestWpm: tests.reduce((m, t) => Math.max(m, t.wpm), 0),
    avgAccuracy: avg(tests.map((t) => t.accuracy)),
    totalMs: tests.reduce((a, t) => a + t.durationMs, 0),
    totalWords: tests.reduce((a, t) => a + t.wordsTyped, 0),
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    improvement: tests.length >= 10 ? avg(tests.slice(-n).map((t) => t.wpm)) - avg(tests.slice(0, n).map((t) => t.wpm)) : null,
  };
}

/** One row per calendar day in range (including empty days) for the activity chart. */
export function dailyActivity(tests: TestResult[], now: Date, days: number) {
  const byDay = new Map<string, { tests: number; minutes: number }>();
  for (const t of tests) {
    const d = localDay(t.createdAt);
    const cur = byDay.get(d) ?? { tests: 0, minutes: 0 };
    byDay.set(d, { tests: cur.tests + 1, minutes: cur.minutes + t.durationMs / 60000 });
  }
  const today = localDay(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const v = byDay.get(d) ?? { tests: 0, minutes: 0 };
    out.push({ day: d.slice(5), tests: v.tests, minutes: Math.round(v.minutes * 10) / 10 });
  }
  return out;
}

function isoWeek(d: Date): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((x.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${x.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Average wpm/accuracy grouped by ISO week or calendar month. */
export function groupProgress(tests: TestResult[], by: 'week' | 'month') {
  const groups = new Map<string, TestResult[]>();
  for (const t of tests) {
    const d = new Date(t.createdAt);
    const k = by === 'week' ? isoWeek(d) : localDay(d).slice(0, 7);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, ts]) => ({
      period,
      wpm: Math.round(avg(ts.map((t) => t.wpm)) * 10) / 10,
      accuracy: Math.round(avg(ts.map((t) => t.accuracy)) * 10) / 10,
      tests: ts.length,
    }));
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
