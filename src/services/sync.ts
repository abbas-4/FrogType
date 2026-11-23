import { useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { authStore, onSignedIn } from '../state/auth';
import { progressOwner, progressStore } from '../state/store';
import { emptyProgress, loadProgress, saveProgress } from '../persistence/storage';
import type { TestResult } from '../types';
import { importTests, mergeSnapshot, pullCloud, submitTest, syncProgress } from './cloud';
import { errorMessage, pinnedClient, supabase } from './supabase';

export interface SyncState {
  status: 'idle' | 'syncing' | 'error' | 'offline';
  message: string | null;
  lastSyncAt: string | null;
  /** guest tests in this browser that the signed-in user may choose to move into their account */
  migrationOffer: number | null;
}

const initial: SyncState = { status: 'idle', message: null, lastSyncAt: null, migrationOffer: null };
let state: SyncState = initial;
const listeners = new Set<() => void>();
const set = (p: Partial<SyncState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};
export const useSync = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
export const getSyncState = () => state;

const decisionKey = (uid: string) => `frogtype:migration:${uid}`;
export const getDecision = (uid: string) => {
  try {
    return localStorage.getItem(decisionKey(uid));
  } catch {
    return null;
  }
};
const setDecision = (uid: string, v: 'done' | 'declined') => {
  try {
    localStorage.setItem(decisionKey(uid), v);
  } catch {
    /* ignore */
  }
};
export const clearDecision = (uid: string) => {
  try {
    localStorage.removeItem(decisionKey(uid));
  } catch {
    /* ignore */
  }
};

// ---------------------------------------------------------------- FT-03: identity generations
// Every session identity change bumps the generation. Async work captures (generation, user id) when it starts and
// re-checks both before each cloud mutation and before touching local state, so a sign-out or account switch
// mid-sync abandons the old run instead of mixing accounts.
let generation = 0;
let lastUserId: string | null = null;
let runningGen = -1;
authStore.subscribe(() => {
  const id = authStore.get().user?.id ?? null;
  if (id === lastUserId) return;
  lastUserId = id;
  generation++;
  set(initial);
});

interface Run {
  uid: string;
  current: () => boolean;
  api: ReturnType<typeof pinnedClient>;
}

async function beginRun(user: User): Promise<Run | null> {
  if (!supabase) return null;
  const gen = generation;
  const current = () => gen === generation && authStore.get().user?.id === user.id && progressOwner() === user.id;
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session || session.user.id !== user.id || !current()) return null;
  return { uid: user.id, current, api: pinnedClient(session.access_token) };
}

const isRateLimit = (e: unknown) => /rate limited/i.test(errorMessage(e));

/** Uploads this account's queued tests, refreshes server-derived progression and merges the cloud copy. Safe to call repeatedly. */
export async function syncNow(): Promise<void> {
  const user = authStore.get().user;
  if (!supabase || !user || runningGen === generation) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return set({ status: 'offline', message: 'Offline — results are saved locally and will sync later.' });
  runningGen = generation;
  const myGen = generation;
  try {
    const run = await beginRun(user);
    if (!run) return;
    set({ status: 'syncing', message: null });
    for (const id of [...progressStore.get().pendingSync]) {
      if (!run.current()) return;
      const t = progressStore.get().history.find((h) => h.id === id);
      const out = t ? await submitTest(t, run.api) : null;
      if (!run.current()) return; // never write one account's result into another account's local store
      // persist per item so a later failure never re-submits tests that already landed
      progressStore.set((cur) => ({
        ...cur,
        pendingSync: cur.pendingSync.filter((x) => x !== id),
        history: out ? cur.history.map((h): TestResult => (h.id === id ? { ...h, keylog: undefined, verified: out.verified || h.verified } : h)) : cur.history,
      }));
    }
    await syncProgress(run.api);
    if (!run.current()) return;
    const cloud = await pullCloud(run.uid, run.api);
    if (!run.current()) return;
    progressStore.set((cur) => mergeSnapshot(cur, cloud));
    set({ status: 'idle', lastSyncAt: new Date().toISOString() });
  } catch (e) {
    if (myGen !== generation) return;
    set(
      isRateLimit(e)
        ? { status: 'idle', message: 'Syncing paused for a minute (rate limit). Your results are safe on this device.' }
        : { status: 'error', message: `Sync failed: ${errorMessage(e)}. Your data is safe on this device.` },
    );
    if (isRateLimit(e)) setTimeout(() => void syncNow(), 65_000);
  } finally {
    if (runningGen === myGen) runningGen = -1;
  }
}

/** Guest tests recorded while signed out in this browser. They belong to whoever played as guest, so moving them needs consent. */
const guestTests = () => loadProgress(null).history.filter((t) => t.valid);

function refreshOffer(uid: string) {
  const n = guestTests().length;
  set({ migrationOffer: n > 0 && getDecision(uid) === null ? n : null });
}

async function handleSignIn(user: User) {
  if (authStore.get().user?.id !== user.id) return;
  refreshOffer(user.id);
  await syncNow();
}

/** Moves this browser's guest progress into the signed-in account (cloud: imported + unverified) and clears the guest copy. */
export async function acceptMigration(): Promise<void> {
  const user = authStore.get().user;
  if (!user) return;
  set({ status: 'syncing', migrationOffer: null });
  try {
    const run = await beginRun(user);
    if (!run) return;
    const guest = loadProgress(null);
    await importTests(guest.history.filter((t) => t.valid), run.api);
    if (!run.current()) return;
    progressStore.set((cur) => {
      const merged = mergeSnapshot(cur, { tests: guest.history, xp: guest.xp, achievements: guest.achievements, lessons: guest.lessons, daily: guest.daily });
      return { ...merged, customTexts: [...merged.customTexts, ...guest.customTexts.filter((g) => !merged.customTexts.some((c) => c.id === g.id))].slice(-30) };
    });
    saveProgress(emptyProgress(), null);
    setDecision(run.uid, 'done');
    set({ status: 'idle' });
    await syncNow();
  } catch (e) {
    set({ status: 'error', message: `Upload failed: ${errorMessage(e)}. Nothing was removed locally; you can retry from your profile.` });
  }
}

export async function declineMigration(): Promise<void> {
  const user = authStore.get().user;
  if (!user) return;
  setDecision(user.id, 'declined');
  set({ migrationOffer: null });
}

/** Re-open the offer later from the profile page. */
export function offerMigrationAgain(): void {
  const user = authStore.get().user;
  if (!user) return;
  clearDecision(user.id);
  refreshOffer(user.id);
}

if (supabase) {
  onSignedIn((u) => void handleSignIn(u));
  if (typeof window !== 'undefined') window.addEventListener('online', () => void syncNow());
}
