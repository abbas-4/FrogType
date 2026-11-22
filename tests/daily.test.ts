import { describe, expect, it } from 'vitest';
import { dailyChallenge, meetsTarget } from '../src/domain/daily';
import { utcDay } from '../src/domain/dates';

describe('daily challenge', () => {
  it('is identical for the same UTC date', () => {
    expect(dailyChallenge('2026-11-22')).toEqual(dailyChallenge('2026-11-22'));
  });
  it('differs between dates', () => {
    expect(dailyChallenge('2026-11-22').words).not.toEqual(dailyChallenge('2026-11-23').words);
  });
  it('matches the server-side target formula (see supabase tests)', () => {
    expect(dailyChallenge('2026-11-22')).toMatchObject({ targetWpm: 55, targetAccuracy: 96 });
    expect(dailyChallenge('2025-01-01')).toMatchObject({ targetWpm: 40, targetAccuracy: 93 });
  });
  it('uses the UTC calendar date regardless of local time', () => {
    expect(utcDay(new Date('2026-11-22T23:30:00-05:00'))).toBe('2026-11-23');
  });
  it('requires both targets', () => {
    const c = dailyChallenge('2026-11-22');
    expect(meetsTarget(c, c.targetWpm, c.targetAccuracy)).toBe(true);
    expect(meetsTarget(c, c.targetWpm + 50, c.targetAccuracy - 1)).toBe(false);
  });
});
