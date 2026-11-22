import { useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { authStore, onSignedIn } from '../state/auth';
import { progressStore } from '../state/store';
import { importTests, mergeSnapshot, pullCloud, pushProgress, submitTest } from './cloud';
import { errorMessage, supabase } from './supabase';

export interface SyncState {
  status: 'idle' | 'syncing' | 'error' | 'offline';
  message: string | null;
  lastSyncAt: string | null;
  /** local tests that exist only on this device and could be added to the account */
  migrationOffer: number | null;
}

let state: SyncState = { status: 'idle', message: null, lastSyncAt: null, migrationOffer: null };
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

let localOnlyIds: string[] = [];
let running = false;

/** Uploads tests recorded while signed in, merges progress, pulls cloud. Safe to call repeatedly. */
export async function syncNow(): Promise<void> {
  const user = authStore.get().user;
  if (!supabase || !user || running) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return set({ status: 'offline', message: 'Offline — results are saved locally and will sync later.' });
  running = true;
  set({ status: 'syncing', message: null });
  try {
    const p = progressStore.get();
    const done: string[] = [];
    for (const id of p.pendingSync) {
      const t = p.history.find((h) => h.id === id);
      if (t) await submitTest(t);
      done.push(id);
    }
    if (done.length) progressStore.set((cur) => ({ ...cur, pendingSync: cur.pendingSync.filter((id) => !done.includes(id)) }));
    await pushProgress(progressStore.get());
    const cloud = await pullCloud(user.id);
    progressStore.set((cur) => mergeSnapshot(cur, cloud));
    set({ status: 'idle', lastSyncAt: new Date().toISOString() });
  } catch (e) {
    set({ status: 'error', message: `Sync failed: ${errorMessage(e)}. Your data is safe on this device.` });
  } finally {
    running = false;
  }
}

async function handleSignIn(user: User) {
  try {
    set({ status: 'syncing' });
    const cloud = await pullCloud(user.id);
    const cloudIds = new Set(cloud.tests.map((t) => t.id));
    const local = progressStore.get();
    const pending = new Set(local.pendingSync);
    localOnlyIds = local.history.filter((t) => !cloudIds.has(t.id) && !pending.has(t.id)).map((t) => t.id);
    const decision = getDecision(user.id);
    if (localOnlyIds.length > 0 && decision === null) {
      // Ask first. Nothing is uploaded until the user agrees.
      set({ status: 'idle', migrationOffer: localOnlyIds.length });
      return;
    }
    set({ status: 'idle' });
    await syncNow();
  } catch (e) {
    set({ status: 'error', message: `Could not reach your account: ${errorMessage(e)}` });
  }
}

export async function acceptMigration(): Promise<void> {
  const user = authStore.get().user;
  if (!user) return;
  set({ status: 'syncing', migrationOffer: null });
  try {
    const p = progressStore.get();
    const ids = new Set(localOnlyIds.length ? localOnlyIds : p.history.map((t) => t.id));
    await importTests(p.history.filter((t) => ids.has(t.id)));
    setDecision(user.id, 'done');
    localOnlyIds = [];
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
  await syncNow();
}

/** Re-open the offer later from the profile page. */
export function offerMigrationAgain(): void {
  const user = authStore.get().user;
  if (!user) return;
  try {
    localStorage.removeItem(decisionKey(user.id));
  } catch {
    /* ignore */
  }
  void handleSignIn(user);
}

if (supabase) {
  onSignedIn((u) => void handleSignIn(u));
  if (typeof window !== 'undefined') window.addEventListener('online', () => void syncNow());
}
