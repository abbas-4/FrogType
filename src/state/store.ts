import { useSyncExternalStore } from 'react';
import type { Progress, Settings } from '../types';
import {
  loadProgress,
  loadSettings,
  progressKey,
  saveProgress,
  saveSettings,
  SETTINGS_KEY,
} from '../persistence/storage';

function createStore<T>(initial: T, persist: (v: T) => T | void) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T | ((prev: T) => T), save = true) {
      state = typeof next === 'function' ? (next as (p: T) => T)(state) : next;
      if (save) state = persist(state) ?? state;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** Account whose progress is active: null = guest. Changed only by the auth layer when the session identity changes. */
let owner: string | null = null;

export const settingsStore = createStore<Settings>(loadSettings(), saveSettings);
export const progressStore = createStore<Progress>(loadProgress(null), (p) => saveProgress(p, owner));

export const progressOwner = () => owner;

/** FT-03: swap the in-memory progress to another account's namespace immediately (sign-in, sign-out, account switch). */
export function activateProgressOwner(next: string | null) {
  if (next === owner) return;
  owner = next;
  progressStore.set(loadProgress(owner), false);
}

// Keep multiple tabs in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === SETTINGS_KEY) settingsStore.set(loadSettings(), false);
    if (e.key === progressKey(owner)) progressStore.set(loadProgress(owner), false);
  });
}

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
}

export function useProgress(): Progress {
  return useSyncExternalStore(progressStore.subscribe, progressStore.get);
}

export function updateSettings(patch: Partial<Settings>) {
  settingsStore.set((s) => ({ ...s, ...patch }));
}
