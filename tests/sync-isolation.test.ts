// FT-03: two accounts sharing one browser. The network is mocked; every upload records which access token carried it.
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProgress, loadProgress, saveProgress } from '../src/persistence/storage';
import type { TestResult } from '../src/types';
import { makeResult } from './fixtures';

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string }; access_token: string },
  uploads: [] as { id: string; token: string }[],
  imports: [] as { ids: string[]; token: string }[],
  gate: null as null | Promise<void>,
}));

vi.mock('../src/services/supabase', () => {
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
  return {
    supabase,
    isSupabaseConfigured: true,
    requireClient: () => supabase,
    pinnedClient: (token: string) => ({ token }),
    errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    landingAuth: { hadCode: false, error: null },
  };
});

vi.mock('../src/services/cloud', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/cloud')>();
  return {
    ...real,
    submitTest: vi.fn(async (t: TestResult, api: { token: string }) => {
      h.uploads.push({ id: t.id, token: api.token });
      if (h.gate) await h.gate;
      return { accepted: true, duplicate: false, ranked: false, verified: false, flags: [] };
    }),
    importTests: vi.fn(async (tests: TestResult[], api: { token: string }) => {
      h.imports.push({ ids: tests.map((t) => t.id), token: api.token });
      return tests.length;
    }),
    syncProgress: vi.fn(async () => {}),
    pullCloud: vi.fn(async () => ({ tests: [], xp: [], achievements: {}, lessons: {}, daily: {} })),
  };
});

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = (id: string) => ({ id }) as User;

async function load() {
  vi.resetModules();
  const auth = await import('../src/state/auth');
  const store = await import('../src/state/store');
  const sync = await import('../src/services/sync');
  const results = await import('../src/services/results');
  const signIn = (id: string) => {
    h.session = { user: { id }, access_token: `token-${id}` };
    auth.applyIdentity(user(id), 'SIGNED_IN');
  };
  const signOut = () => {
    h.session = null;
    auth.applyIdentity(null, 'SIGNED_OUT');
  };
  return { ...auth, ...store, ...sync, ...results, signIn, signOut };
}

const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => v });

beforeEach(() => {
  h.session = null;
  h.uploads = [];
  h.imports = [];
  h.gate = null;
  setOnline(true);
});

describe('two accounts in one browser', () => {
  it('shows each account only its own history and swaps immediately on sign-out', async () => {
    saveProgress({ ...emptyProgress(), history: [makeResult({ id: 'a-test' })] }, A);
    const m = await load();
    expect(m.progressStore.get().history).toEqual([]); // guest
    m.signIn(A);
    expect(m.progressStore.get().history.map((t) => t.id)).toEqual(['a-test']);
    m.signOut();
    expect(m.progressStore.get().history).toEqual([]);
    m.signIn(B);
    expect(m.progressStore.get().history).toEqual([]);
  });

  it('keeps each account\'s completed lessons through sign-out and sign-in', async () => {
    const done = { attempts: 1, bestWpm: 30, bestAccuracy: 99, completed: true, firstWpm: 30, lastAt: '2026-11-24T00:00:00.000Z' };
    saveProgress({ ...emptyProgress(), lessons: { 'home-1': done } }, A);
    const m = await load();
    m.signIn(A);
    expect(m.progressStore.get().lessons['home-1']).toMatchObject({ completed: true });
    m.signOut();
    expect(m.progressStore.get().lessons).toEqual({});
    m.signIn(B);
    expect(m.progressStore.get().lessons).toEqual({});
    m.signOut();
    m.signIn(A);
    expect(m.progressStore.get().lessons['home-1']).toMatchObject({ completed: true });
  });

  it('never uploads A\'s offline queue under B', async () => {
    const m = await load();
    m.signIn(A);
    setOnline(false);
    m.saveResult(makeResult({ id: 'a-offline' }));
    await Promise.resolve();
    expect(loadProgress(A).pendingSync).toEqual(['a-offline']);
    m.signOut();
    m.signIn(B);
    setOnline(true);
    await m.syncNow();
    expect(h.uploads).toEqual([]);
    expect(loadProgress(B).history).toEqual([]);
    m.signOut();
    m.signIn(A);
    await m.syncNow();
    expect(h.uploads).toEqual([{ id: 'a-offline', token: `token-${A}` }]);
    expect(loadProgress(A).pendingSync).toEqual([]);
  });

  it('abandons a sync when the account switches mid-flight', async () => {
    saveProgress({ ...emptyProgress(), history: [makeResult({ id: 'a1' }), makeResult({ id: 'a2' })], pendingSync: ['a1', 'a2'] }, A);
    const m = await load();
    m.signIn(A);
    let release!: () => void;
    h.gate = new Promise((r) => (release = r));
    const running = m.syncNow();
    await vi.waitFor(() => expect(h.uploads).toHaveLength(1));
    m.signOut();
    m.signIn(B);
    release();
    await running;
    expect(h.uploads.every((u) => u.token === `token-${A}`)).toBe(true);
    expect(h.uploads.map((u) => u.id)).toEqual(['a1']); // a2 was never sent once A was gone
    expect(m.progressStore.get().history).toEqual([]); // B's view untouched
    expect(loadProgress(B)).toEqual(emptyProgress());
    expect(loadProgress(A).pendingSync).toEqual(['a1', 'a2']); // kept for A (server dedupes a1 by id)
  });

  it('only moves guest data into an account after explicit consent', async () => {
    saveProgress({ ...emptyProgress(), history: [makeResult({ id: 'g1' }), makeResult({ id: 'g2', valid: false })] }, null);
    const m = await load();
    m.signIn(A);
    m.offerMigrationAgain(); // production runs this from the SIGNED_IN listener, which is mocked out here
    expect(m.getSyncState().migrationOffer).toBe(1); // only valid guest tests are offered
    expect(h.imports).toEqual([]);
    expect(m.progressStore.get().history).toEqual([]);
    await m.declineMigration();
    expect(loadProgress(null).history).toHaveLength(2); // still guest data
    m.offerMigrationAgain();
    await m.acceptMigration();
    expect(h.imports).toEqual([{ ids: ['g1'], token: `token-${A}` }]);
    expect(m.progressStore.get().history.map((t) => t.id).sort()).toEqual(['g1', 'g2']);
    expect(loadProgress(null)).toEqual(emptyProgress());
    // B signing in later is not offered A's former guest data
    m.signOut();
    m.signIn(B);
    m.offerMigrationAgain();
    expect(m.getSyncState().migrationOffer).toBeNull();
  });

  it('a stale profile response cannot overwrite the next account\'s profile', async () => {
    const m = await load();
    m.signIn(A);
    m.authStore.set({ profile: { id: A, username: 'alice', is_public: false, show_on_leaderboard: false, avatar: null, bio: null, created_at: '' } });
    m.signIn(B);
    expect(m.authStore.get().profile).toBeNull();
  });
});
