import { describe, expect, it } from 'vitest';
import { engineReducer, finalStats, initEngine, liveStats, type EngineAction, type EngineState } from '../src/engine/core';

function run(s: EngineState, actions: EngineAction[]) {
  return actions.reduce(engineReducer, s);
}
const typeWord = (w: string, t0: number, step = 100): EngineAction[] => [...w].map((char, i) => ({ type: 'char', char, now: t0 + i * step }));

describe('typing engine', () => {
  it('zen: typed text is the passage, every key is correct, and it ends only on finish', () => {
    let s = run(initEngine([''], { kind: 'zen' }), [...typeWord('hi', 0), { type: 'space', now: 200 }, ...typeWord('yo', 300)]);
    expect(s.words).toEqual(['hi', 'yo']);
    expect(s.correctKeystrokes).toBe(s.keystrokes);
    s = run(s, [{ type: 'backspace', word: true }, { type: 'backspace', word: false }]);
    expect(s.wordIndex).toBe(0); // free to edit earlier words
    s = run(s, [{ type: 'space', now: 500 }, ...typeWord('ok', 600), { type: 'tick', now: 1500 }]);
    expect(s.finishedAt).toBeNull();
    s = engineReducer(s, { type: 'finish', now: 2000 });
    expect(s.finishedAt).toBe(2000);
    expect(finalStats(s)).toMatchObject({ accuracy: 100, wordsTyped: 2, valid: true });
  });

  it('does not start the timer until the first keystroke', () => {
    let s = initEngine(['hello'], { kind: 'time', seconds: 15 });
    expect(s.startedAt).toBeNull();
    s = engineReducer(s, { type: 'tick', now: 5000 });
    expect(s.startedAt).toBeNull();
    s = engineReducer(s, { type: 'space', now: 5000 });
    expect(s.startedAt).toBeNull();
    s = engineReducer(s, { type: 'char', char: 'h', now: 7000 });
    expect(s.startedAt).toBe(7000);
  });

  it('tracks correct and incorrect keystrokes per character', () => {
    const s = run(initEngine(['abc', 'def'], { kind: 'words' }), [
      { type: 'char', char: 'a', now: 0 },
      { type: 'char', char: 'x', now: 100 },
      { type: 'backspace', word: false },
      { type: 'char', char: 'b', now: 200 },
    ]);
    expect(s.inputs[0]).toBe('ab');
    expect(s.keystrokes).toBe(3);
    expect(s.correctKeystrokes).toBe(2);
    expect(s.charStats.b).toEqual([2, 1]);
    expect(s.bigramErrors.ab).toBe(1);
  });

  it('editable passages (lessons) let Backspace delete any space, keeping position, stats and completion right', () => {
    let s = run(initEngine(['ab', 'c.', 'de'], { kind: 'words', editable: true }), [...typeWord('ab', 0), { type: 'space', now: 200 }]);
    s = engineReducer(s, { type: 'backspace', word: false });
    expect([s.wordIndex, s.inputs[0]]).toEqual([0, 'ab']); // space deleted, back at the end of a correct word
    s = run(s, [{ type: 'backspace', word: false }, { type: 'char', char: 'b', now: 300 }, { type: 'space', now: 400 }, ...typeWord('c.', 500)]);
    s = run(s, [{ type: 'space', now: 700 }, { type: 'backspace', word: false }, { type: 'backspace', word: false }]);
    expect([s.wordIndex, s.inputs[1]]).toEqual([1, 'c']); // space then punctuation removed
    expect(liveStats(s, 800).accuracy).toBe(100); // deleting is not a keystroke
    s = run(s, [{ type: 'char', char: '.', now: 800 }, { type: 'space', now: 900 }, ...typeWord('de', 1000)]);
    expect(s.finishedAt).toBe(1100);
    expect(finalStats(s)).toMatchObject({ wordsTyped: 3, chars: { correct: 6, incorrect: 0, extra: 0, missed: 0 } });
  });

  it('only allows backspacing into a previous word that has an error', () => {
    let s = run(initEngine(['ab', 'cd', 'ef'], { kind: 'words' }), [...typeWord('ab', 0), { type: 'space', now: 300 }]);
    s = engineReducer(s, { type: 'backspace', word: false });
    expect(s.wordIndex).toBe(1); // "ab" was correct: locked
    s = run(s, [...typeWord('cx', 400), { type: 'space', now: 700 }]);
    s = engineReducer(s, { type: 'backspace', word: false });
    expect(s.wordIndex).toBe(1); // back into "cx"
    s = engineReducer(s, { type: 'backspace', word: true });
    expect(s.inputs[1]).toBe('');
  });

  it('ignores space on an empty word', () => {
    const s = run(initEngine(['ab', 'cd'], { kind: 'words' }), [{ type: 'char', char: 'a', now: 0 }, { type: 'space', now: 50 }, { type: 'space', now: 60 }]);
    expect(s.wordIndex).toBe(1);
    expect(s.keystrokes).toBe(2);
  });

  it('completes words mode when the last word is typed correctly', () => {
    const s = run(initEngine(['ab', 'cd'], { kind: 'words' }), [...typeWord('ab', 0), { type: 'space', now: 300 }, ...typeWord('cd', 400)]);
    expect(s.finishedAt).toBe(500);
  });

  it('completes words mode on space after an incorrect last word', () => {
    const s = run(initEngine(['ab', 'cd'], { kind: 'words' }), [...typeWord('ab', 0), { type: 'space', now: 300 }, ...typeWord('cx', 400), { type: 'space', now: 600 }]);
    expect(s.finishedAt).toBe(600);
    expect(finalStats(s).chars.incorrect).toBe(1);
  });

  it('finishes time mode exactly at the limit, even when the tick is late', () => {
    let s = run(initEngine(['ab', 'cd', 'ef'], { kind: 'time', seconds: 2 }), typeWord('ab', 1000));
    s = engineReducer(s, { type: 'tick', now: 4500 }); // tab throttled: tick arrives late
    expect(s.finishedAt).toBe(3000);
    expect(s.samples.map((x) => x.t)).toEqual([1, 2]);
    expect(finalStats(s).durationMs).toBe(2000);
  });

  it('ignores keystrokes after the time limit', () => {
    let s = run(initEngine(['ab', 'cd'], { kind: 'time', seconds: 1 }), [{ type: 'char', char: 'a', now: 0 }]);
    s = engineReducer(s, { type: 'char', char: 'b', now: 1500 });
    expect(s.inputs[0]).toBe('a');
    expect(s.finishedAt).toBe(1000);
    const after = engineReducer(s, { type: 'char', char: 'c', now: 1600 });
    expect(after).toBe(s);
  });

  it('reset restores a pristine state', () => {
    const s = run(initEngine(['ab'], { kind: 'words' }), [{ type: 'char', char: 'a', now: 0 }]);
    const r = engineReducer(s, { type: 'reset', words: ['xy'], limit: { kind: 'time', seconds: 15 } });
    expect(r).toEqual(initEngine(['xy'], { kind: 'time', seconds: 15 }));
  });

  it('computes realistic final stats for a steady typist', () => {
    // 60 wpm = 5 chars/sec -> one char every 200ms across 10 five-letter words
    const words = Array.from({ length: 10 }, () => 'abcde');
    let s = initEngine(words, { kind: 'words' });
    let t = 0;
    words.forEach((w, i) => {
      for (const ch of w) s = engineReducer(engineReducer(s, { type: 'tick', now: t }), { type: 'char', char: ch, now: (t += 200) });
      if (i < words.length - 1) s = engineReducer(s, { type: 'space', now: (t += 200) });
    });
    const f = finalStats(s);
    expect(f.valid).toBe(true);
    expect(f.accuracy).toBe(100);
    expect(f.wpm).toBeGreaterThan(55);
    expect(f.wpm).toBeLessThan(62);
    expect(f.consistency).toBeGreaterThan(80);
  });

  it('marks implausible tests invalid', () => {
    const s = run(initEngine(['ab', 'cd'], { kind: 'words' }), [...typeWord('ab', 0, 10), { type: 'space', now: 30 }, ...typeWord('cd', 40, 10)]);
    const f = finalStats(s);
    expect(f.valid).toBe(false);
    expect(f.invalidReason).toBe('Test too short');
  });

  it('never marks a completed test invalid for low accuracy', () => {
    // every letter wrong, at a human pace over several seconds; ticks each second as the UI clock does, so samples are not idle
    const s = run(initEngine(['abc', 'def', 'ghi'], { kind: 'words' }), [
      ...typeWord('xyz', 0, 400), { type: 'tick', now: 1000 }, { type: 'space', now: 1300 },
      ...typeWord('xyz', 1500, 200), { type: 'tick', now: 2000 }, { type: 'space', now: 2400 },
      ...typeWord('xyz', 2600, 200), { type: 'tick', now: 3000 }, { type: 'space', now: 3400 },
    ]);
    const f = finalStats(s);
    expect(f.accuracy).toBeLessThan(50);
    expect(f.invalidReason).toBeUndefined();
    expect(f.valid).toBe(true);
  });

  it('live stats never divide by a tiny elapsed time', () => {
    const s = run(initEngine(['ab'], { kind: 'words' }), [{ type: 'char', char: 'a', now: 0 }]);
    expect(liveStats(s, 10).wpm).toBe(0);
  });
});
