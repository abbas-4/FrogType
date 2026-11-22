import { describe, expect, it } from 'vitest';
import { calcAccuracy, calcConsistency, calcWpm, countChars } from '../src/engine/metrics';

describe('calcWpm', () => {
  it('uses 5 chars per word', () => {
    expect(calcWpm(250, 60000)).toBe(50);
    expect(calcWpm(125, 30000)).toBe(50);
  });
  it('returns 0 for zero or negative time instead of Infinity', () => {
    expect(calcWpm(100, 0)).toBe(0);
    expect(calcWpm(100, -5)).toBe(0);
  });
});

describe('calcAccuracy', () => {
  it('is correct keystrokes over total', () => {
    expect(calcAccuracy(95, 100)).toBe(95);
    expect(calcAccuracy(2, 3)).toBe(66.67);
  });
  it('is 0 with no keystrokes', () => expect(calcAccuracy(0, 0)).toBe(0));
});

describe('calcConsistency', () => {
  it('is 100 for perfectly steady speed', () => expect(calcConsistency([60, 60, 60, 60])).toBe(100));
  it('drops as variation grows', () => {
    const steady = calcConsistency([58, 60, 62, 60]);
    const erratic = calcConsistency([20, 100, 30, 90]);
    expect(steady).toBeGreaterThan(erratic);
    expect(erratic).toBeGreaterThanOrEqual(0);
  });
  it('needs at least two samples', () => expect(calcConsistency([60])).toBe(0));
});

describe('countChars', () => {
  const words = ['the', 'cat', 'sat'];
  it('counts correct words plus spaces toward wpm', () => {
    const c = countChars(words, ['the', 'cat', ''], 2, false);
    expect(c.wpmChars).toBe(8); // "the " + "cat "
    expect(c.correct).toBe(6);
    expect(c.correctWords).toBe(2);
  });
  it('classifies incorrect, extra and missed characters', () => {
    const c = countChars(words, ['thx', 'cats', 's'], 2, false);
    expect(c.incorrect).toBe(1);
    expect(c.extra).toBe(1);
    expect(c.missed).toBe(0);
    expect(c.wpmChars).toBe(0);
    const skipped = countChars(words, ['t', 'cat', ''], 2, false);
    expect(skipped.missed).toBe(2);
  });
  it('counts a correct partial last word when included', () => {
    const c = countChars(words, ['the', 'cat', 'sa'], 2, true);
    expect(c.wpmChars).toBe(10);
    expect(c.missed).toBe(0);
  });
});
