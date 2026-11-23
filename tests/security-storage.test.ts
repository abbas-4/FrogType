// FT-03 / FT-11: per-account namespaces and hostile localStorage contents.
import { describe, expect, it, vi } from 'vitest';
import { createRng } from '../src/engine/random';
import { emptyProgress, loadProgress, PROGRESS_KEY, progressKey, sanitizeProgress, sanitizeTest, saveProgress } from '../src/persistence/storage';
import { makeResult } from './fixtures';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('account namespaces', () => {
  it('keeps guest and each account in separate keys', () => {
    expect(progressKey(null)).toBe(PROGRESS_KEY);
    expect(progressKey(A)).toBe(`${PROGRESS_KEY}:u:${A}`);
    saveProgress({ ...emptyProgress(), history: [makeResult({ id: 'guest' })] }, null);
    saveProgress({ ...emptyProgress(), history: [makeResult({ id: 'a' })], pendingSync: ['a'] }, A);
    expect(loadProgress(null).history.map((t) => t.id)).toEqual(['guest']);
    expect(loadProgress(A).history.map((t) => t.id)).toEqual(['a']);
    expect(loadProgress(B)).toEqual(emptyProgress());
    expect(loadProgress(B).pendingSync).toEqual([]);
  });
  it('rejects malformed account ids instead of building arbitrary keys', () => {
    expect(() => progressKey('../../etc')).toThrow();
    expect(() => progressKey('')).toThrow();
  });
});

describe('hostile local storage', () => {
  it('rejects non-finite and out-of-range numbers', () => {
    for (const bad of [{ wpm: Infinity }, { wpm: -1 }, { wpm: 1e9 }, { accuracy: 101 }, { durationMs: NaN }, { mode2: 0 }, { mode: 'hacked' }, { createdAt: 'not a date' }]) {
      expect(sanitizeTest({ ...makeResult(), ...bad })).toBeNull();
    }
  });
  it('repairs nested junk instead of dropping the whole test', () => {
    const t = sanitizeTest({
      ...makeResult(),
      samples: [{ t: 1, wpm: 50, raw: 52, errors: 0 }, { t: 'x' }, null, { t: 2, wpm: Infinity, raw: 1, errors: 0 }],
      charStats: { a: [3, 1], b: 'nope', c: [1, 2, 3] },
      bigramErrors: { th: 2, xx: -1 },
      keylog: { k: 'abc', t: [0, 1] }, // length mismatch -> dropped
      challengeId: 'not-a-uuid',
    })!;
    expect(t.samples).toHaveLength(1);
    expect(t.charStats).toEqual({ a: [3, 1] });
    expect(t.bigramErrors).toEqual({ th: 2 });
    expect(t.keylog).toBeUndefined();
    expect(t.challengeId).toBeUndefined();
  });
  it('does not allow prototype pollution through stored objects', () => {
    const raw = JSON.parse('{"achievements":{"__proto__":{"polluted":"yes"},"first-test":"2026-01-01"},"lessons":{"constructor":{"attempts":1}}}');
    const p = sanitizeProgress(raw);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(p.achievements)).toEqual(['first-test']);
    expect(Object.getPrototypeOf(p.achievements)).toBe(Object.prototype);
    expect(p.lessons).toEqual({});
  });
  it('bounds arrays, strings and queue entries', () => {
    const many = Array.from({ length: 1500 }, (_, i) => makeResult({ id: `t${i}` }));
    const p = sanitizeProgress({
      history: many,
      customTexts: [...Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, title: 't', text: 'x' })), { id: 'big', title: 't', text: 'x'.repeat(30000) }],
      pendingSync: ['t1499', 't1499', 'ghost', 5],
    });
    expect(p.history).toHaveLength(1000);
    expect(p.customTexts.length).toBeLessThanOrEqual(30);
    expect(p.customTexts.some((c) => c.id === 'big')).toBe(false);
    expect(p.pendingSync).toEqual(['t1499']); // no duplicates, no ids that are not in history
  });
  it('ignores oversized or corrupt storage without throwing', () => {
    localStorage.setItem(PROGRESS_KEY, '{"history": [' + '1,'.repeat(10) + ']');
    expect(loadProgress(null)).toEqual(emptyProgress());
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(`[${'1,'.repeat(4_000_000)}1]`);
    expect(loadProgress(null)).toEqual(emptyProgress());
    spy.mockRestore();
  });
  it('keeps valid existing progress intact', () => {
    const p = { ...emptyProgress(), history: [makeResult()], xp: [{ key: 'test:x', amount: 30, reason: 'r', at: '2026-01-01' }], achievements: { 'first-test': '2026-01-01T00:00:00Z' } };
    saveProgress(p);
    expect(loadProgress()).toEqual(p);
  });
  it('never throws and always returns a well-formed object for random input (fuzz)', () => {
    const rng = createRng(1234);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)]!;
    const atoms = [null, true, 0, -1, 1e308, NaN, Infinity, '', 'x', '__proto__', '2026-01-01', [], {}];
    const gen = (depth: number): unknown => {
      if (depth <= 0 || rng() < 0.3) return pick(atoms);
      if (rng() < 0.5) return Array.from({ length: Math.floor(rng() * 5) }, () => gen(depth - 1));
      const keys = ['history', 'xp', 'achievements', 'lessons', 'daily', 'customTexts', 'pendingSync', 'id', 'wpm', 'chars', 'samples', '__proto__'];
      return Object.fromEntries(Array.from({ length: Math.floor(rng() * 6) }, () => [pick(keys), gen(depth - 1)]));
    };
    for (let i = 0; i < 2000; i++) {
      const p = sanitizeProgress(gen(5));
      expect(Array.isArray(p.history) && Array.isArray(p.xp) && Array.isArray(p.pendingSync)).toBe(true);
      for (const t of p.history) expect(Number.isFinite(t.wpm)).toBe(true);
    }
  });
});
