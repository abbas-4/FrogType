import { describe, expect, it } from 'vitest';
import { defaultSettings, emptyProgress, loadProgress, loadSettings, PROGRESS_KEY, sanitizeProgress, sanitizeSettings, saveProgress, saveSettings, SETTINGS_KEY } from '../src/persistence/storage';
import { makeResult } from './fixtures';

describe('settings persistence', () => {
  it('round-trips through localStorage', () => {
    saveSettings({ ...defaultSettings, theme: 'lily', fontSize: 2.5, punctuation: true });
    expect(loadSettings()).toMatchObject({ theme: 'lily', fontSize: 2.5, punctuation: true });
  });
  it('falls back to defaults for tampered or corrupt values', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: '<script>', fontSize: 999, sound: 'click', timeDuration: 'abc' }));
    expect(loadSettings()).toMatchObject({ theme: 'frog', fontSize: defaultSettings.fontSize, sound: 'click', timeDuration: 30 });
    localStorage.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings()).toEqual(defaultSettings);
    expect(sanitizeSettings(null)).toEqual(defaultSettings);
  });
});

describe('progress persistence', () => {
  it('round-trips tests and xp', () => {
    const p = { ...emptyProgress(), history: [makeResult()], xp: [{ key: 'a', amount: 5, reason: 'r', at: 'x' }] };
    saveProgress(p);
    expect(loadProgress()).toEqual(p);
  });
  it('drops malformed entries instead of crashing', () => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ history: [makeResult(), { id: 1 }, null, { ...makeResult(), wpm: 'fast' }], xp: [{ key: 'ok', amount: 1, reason: '' }, { amount: 'x' }] }));
    const p = loadProgress();
    expect(p.history).toHaveLength(1);
    expect(p.xp).toHaveLength(1);
    expect(sanitizeProgress('garbage')).toEqual(emptyProgress());
  });
});
