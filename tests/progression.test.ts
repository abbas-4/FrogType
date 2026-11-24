import { describe, expect, it } from 'vitest';
import { addXp, levelFromXp, xpForLevel, xpForTest } from '../src/domain/progression';
import { recordResult } from '../src/domain/recordResult';
import { calcStreaks } from '../src/domain/streaks';
import { getLesson } from '../src/domain/lessons';
import { dailyChallenge } from '../src/domain/daily';
import { emptyProgress } from '../src/persistence/storage';
import { makeResult } from './fixtures';

const now = new Date('2026-11-22T12:00:00Z');

describe('levels', () => {
  it('has increasing thresholds', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(300);
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(350)).toMatchObject({ level: 3, into: 50, needed: 300 });
  });
});

describe('xp', () => {
  it('awards nothing for invalid tests and scales with accuracy', () => {
    expect(xpForTest(makeResult({ valid: false }))).toBe(0);
    expect(xpForTest(makeResult({ accuracy: 100 }))).toBeGreaterThan(xpForTest(makeResult({ accuracy: 80 })));
  });
  it('dedupes by key', () => {
    const a = addXp([], [{ key: 'k', amount: 10, reason: '', at: '' }]);
    const b = addXp(a.ledger, [{ key: 'k', amount: 10, reason: '', at: '' }, { key: 'z', amount: 0, reason: '', at: '' }]);
    expect(b.added).toHaveLength(0);
    expect(b.ledger).toBe(a.ledger);
  });
});

describe('recordResult', () => {
  it('ignores invalid tests entirely', () => {
    const p = emptyProgress();
    const out = recordResult(p, makeResult({ valid: false }), { now });
    expect(out.progress).toBe(p);
    expect(out.xpAdded).toHaveLength(0);
  });

  it('never awards XP twice for the same test', () => {
    const r = makeResult();
    const first = recordResult(emptyProgress(), r, { now });
    const again = recordResult(first.progress, r, { now });
    expect(again.progress).toBe(first.progress);
    expect(again.xpAdded).toHaveLength(0);
  });

  it('unlocks first-test and gives one streak bonus per day', () => {
    const a = recordResult(emptyProgress(), makeResult(), { now });
    expect(a.unlocked.map((x) => x.id)).toContain('first-test');
    expect(a.xpAdded.some((t) => t.key === 'streak:2026-11-22')).toBe(true);
    const b = recordResult(a.progress, makeResult(), { now });
    expect(b.xpAdded.some((t) => t.key.startsWith('streak:'))).toBe(false);
    expect(b.unlocked.map((x) => x.id)).not.toContain('first-test');
  });

  it('awards a personal best only when beating a previous record', () => {
    const a = recordResult(emptyProgress(), makeResult({ wpm: 50 }), { now });
    expect(a.personalBest).toBe(false);
    const b = recordResult(a.progress, makeResult({ wpm: 55 }), { now });
    expect(b.personalBest).toBe(true);
    const c = recordResult(b.progress, makeResult({ wpm: 54 }), { now });
    expect(c.personalBest).toBe(false);
  });

  it('unlocks speed clubs', () => {
    const out = recordResult(emptyProgress(), makeResult({ wpm: 101 }), { now });
    expect(out.unlocked.map((x) => x.id)).toEqual(expect.arrayContaining(['wpm-50', 'wpm-75', 'wpm-100']));
  });

  it('passes a lesson and rewards it once', () => {
    const lesson = getLesson('home-1')!;
    const fail = recordResult(emptyProgress(), makeResult({ mode: 'lesson', wpm: 5 }), { now, lesson });
    expect(fail.lessonPassed).toBe(false);
    expect(fail.progress.lessons['home-1']).toMatchObject({ attempts: 1, completed: false });
    const pass = recordResult(fail.progress, makeResult({ mode: 'lesson', wpm: 30, accuracy: 99 }), { now, lesson });
    expect(pass.lessonPassed).toBe(true);
    expect(pass.xpAdded.some((t) => t.key === 'lesson:home-1')).toBe(true);
    const again = recordResult(pass.progress, makeResult({ mode: 'lesson', wpm: 35, accuracy: 99 }), { now, lesson });
    expect(again.lessonPassed).toBe(false);
    expect(again.xpAdded.some((t) => t.key === 'lesson:home-1')).toBe(false);
    expect(again.progress.lessons['home-1']).toMatchObject({ attempts: 3, bestWpm: 35, firstWpm: 5 });
  });

  it('completes a lesson only when both speed and accuracy targets are met', () => {
    const lesson = getLesson('home-1')!;
    const run = (wpm: number, accuracy: number, valid = true) =>
      recordResult(emptyProgress(), makeResult({ mode: 'lesson', wpm, accuracy, valid }), { now, lesson }).progress.lessons['home-1'];
    expect(run(lesson.targetWpm + 20, lesson.targetAccuracy - 1)).toMatchObject({ completed: false });
    expect(run(lesson.targetWpm - 1, 100)).toMatchObject({ completed: false });
    expect(run(lesson.targetWpm, lesson.targetAccuracy)).toMatchObject({ completed: true });
    expect(run(lesson.targetWpm + 20, 100, false)).toBeUndefined();
  });

  it('completes the daily challenge once', () => {
    const daily = dailyChallenge('2026-11-22');
    const r1 = recordResult(emptyProgress(), makeResult({ mode: 'daily', wpm: 100, accuracy: 99 }), { now, daily });
    expect(r1.dailyCompleted).toBe(true);
    expect(r1.unlocked.map((a) => a.id)).toContain('daily-champion');
    const r2 = recordResult(r1.progress, makeResult({ mode: 'daily', wpm: 110, accuracy: 99 }), { now, daily });
    expect(r2.dailyCompleted).toBe(false);
    expect(r2.xpAdded.some((t) => t.key.startsWith('daily:'))).toBe(false);
  });
});

describe('streaks', () => {
  it('counts consecutive days ending today or yesterday', () => {
    expect(calcStreaks(['2026-11-20', '2026-11-21', '2026-11-22'], '2026-11-22')).toEqual({ current: 3, longest: 3 });
    expect(calcStreaks(['2026-11-20', '2026-11-21'], '2026-11-22')).toEqual({ current: 2, longest: 2 });
    expect(calcStreaks(['2026-11-19', '2026-11-20'], '2026-11-22').current).toBe(0);
  });
  it('tracks the longest run across gaps and month boundaries', () => {
    const days = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-10', '2026-11-10'];
    expect(calcStreaks(days, '2026-11-22')).toEqual({ current: 0, longest: 4 });
  });
});
