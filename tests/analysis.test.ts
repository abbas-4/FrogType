import { describe, expect, it } from 'vitest';
import { analyze } from '../src/domain/analysis';
import { filterRange, summarize } from '../src/domain/stats';
import { makeResult } from './fixtures';

describe('personalized analysis', () => {
  it('refuses to personalize with too little data', () => {
    const a = analyze([makeResult({ charStats: { a: [100, 50] } })]);
    expect(a.enoughData).toBe(false);
    expect(a.recommendations).toHaveLength(0);
    expect(a.weakKeys).toHaveLength(0);
  });

  it('finds the keys with unusually high error rates and recommends matching lessons', () => {
    const charStats = { a: [200, 4], s: [200, 4], e: [200, 2], q: [60, 15], z: [40, 10] } as Record<string, [number, number]>;
    const history = Array.from({ length: 4 }, () => makeResult({ charStats, bigramErrors: { aq: 3 } }));
    const a = analyze(history);
    expect(a.enoughData).toBe(true);
    expect(a.weakKeys.map((k) => k.char)).toEqual(expect.arrayContaining(['q', 'z']));
    expect(a.weakKeys.map((k) => k.char)).not.toContain('e');
    expect(a.recommendations.length).toBeGreaterThan(0);
    expect(a.recommendations[0]!.lesson.keys).toMatch(/[qz]/);
  });

  it('recommends accuracy work when accuracy is low', () => {
    const history = Array.from({ length: 4 }, () => makeResult({ accuracy: 85, charStats: { a: [200, 10] } }));
    expect(analyze(history).recommendations.map((r) => r.lesson.category)).toContain('accuracy');
  });
});

describe('stats', () => {
  it('filters by range and summarizes', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    const old = makeResult({ createdAt: '2026-08-01T12:00:00Z', wpm: 40 });
    const recent = makeResult({ createdAt: '2026-11-21T12:00:00Z', wpm: 80 });
    const invalid = makeResult({ valid: false, wpm: 999 });
    const all = [old, recent, invalid];
    expect(filterRange(all, '7d', now)).toEqual([recent]);
    expect(filterRange(all, 'all', now)).toHaveLength(2);
    const s = summarize(filterRange(all, 'all', now), all, now);
    expect(s).toMatchObject({ tests: 2, avgWpm: 60, bestWpm: 80, currentStreak: 1 });
  });
});
