// FT-01: the engine records exactly what the server needs to replay a test.
import { describe, expect, it } from 'vitest';
import { engineReducer, initEngine, KEY_BACKSPACE, KEY_DELETE_WORD, type EngineAction, type EngineState } from '../src/engine/core';

const run = (s: EngineState, actions: EngineAction[]) => actions.reduce(engineReducer, s);

describe('keylog', () => {
  it('records applied keys relative to the first keystroke', () => {
    const s = run(initEngine(['ab', 'cd'], { kind: 'words' }, 'c-1'), [
      { type: 'space', now: 900 }, // before start: ignored
      { type: 'char', char: 'a', now: 1000 },
      { type: 'char', char: 'x', now: 1100.4 },
      { type: 'backspace', word: false, now: 1200.6 },
      { type: 'char', char: 'b', now: 1300 },
      { type: 'space', now: 1400 },
      { type: 'char', char: 'c', now: 1500 },
      { type: 'backspace', word: true, now: 1550 },
      { type: 'char', char: 'c', now: 1600 },
      { type: 'char', char: 'd', now: 1700 },
    ]);
    expect(s.challengeId).toBe('c-1');
    expect(s.finishedAt).toBe(1700);
    expect(s.keylog.k).toBe(`ax${KEY_BACKSPACE}b c${KEY_DELETE_WORD}cd`);
    expect(s.keylog.t).toEqual([0, 100, 201, 300, 400, 500, 550, 600, 700]);
  });
  it('drops keys after the time limit and keeps timestamps monotonic', () => {
    const s = run(initEngine(['abc'], { kind: 'time', seconds: 1 }), [
      { type: 'char', char: 'a', now: 0 },
      { type: 'char', char: 'b', now: 999 },
      { type: 'char', char: 'c', now: 1001 },
    ]);
    expect(s.keylog.k).toBe('ab');
    expect(s.keylog.t).toEqual([0, 999]);
  });
  it('a plain reset never carries a challenge over', () => {
    const s = engineReducer(initEngine(['a'], { kind: 'words' }, 'c-1'), { type: 'reset', words: ['b'], limit: { kind: 'words' } });
    expect(s.challengeId).toBeNull();
    expect(s.keylog).toEqual({ k: '', t: [] });
  });
});
