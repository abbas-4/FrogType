// Guest-data import: failure keeps everything and lets the user retry; success happens once; declining uploads nothing.
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProgress, loadProgress, saveProgress } from '../src/persistence/storage';
import type { TestResult } from '../src/types';
import { makeResult } from './fixtures';

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string }; access_token: string },
  imports: [] as string[][],
  failImport: false,
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
    submitTest: vi.fn(async () => ({ accepted: true, duplicate: false, ranked: false, verified: false, flags: [] })),
    importTests: vi.fn(async (tests: TestResult[]) => {
      h.imports.push(tests.map((t) => t.id));
      if (h.gate) await h.gate;
      if (h.failImport) throw new Error('network down');
      return tests.length;
    }),
    syncProgress: vi.fn(async () => {}),
    pullCloud: vi.fn(async () => ({ tests: [], xp: [], achievements: {}, lessons: {}, daily: {} })),
  };
});

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function load() {
  vi.resetModules();
  const auth = await import('../src/state/auth');
  const store = await import('../src/state/store');
  const sync = await import('../src/services/sync');
  const signIn = (id: string) => {
    h.session = { user: { id }, access_token: `token-${id}` };
    auth.applyIdentity({ id } as User, 'SIGNED_IN');
  };
  const signOut = () => {
    h.session = null;
    auth.applyIdentity(null, 'SIGNED_OUT');
  };
  return { ...store, ...sync, signIn, signOut };
}

/** Guest data with one valid test, signed in as A, offer shown (production does this from the SIGNED_IN listener). */
async function offered() {
  saveProgress({ ...emptyProgress(), history: [makeResult({ id: 'g1' })] }, null);
  const m = await load();
  m.signIn(A);
  m.offerMigrationAgain();
  expect(m.getSyncState().migrationOffer).toBe(1);
  return m;
}

beforeEach(() => {
  h.session = null;
  h.imports = [];
  h.failImport = false;
  h.gate = null;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

describe('guest import', () => {
  it('a failed import keeps the guest data, reports the error and offers the import again', async () => {
    const m = await offered();
    h.failImport = true;
    await m.acceptMigration();

    expect(h.imports).toEqual([['g1']]);
    expect(loadProgress(null).history.map((t) => t.id)).toEqual(['g1']);
    expect(m.progressStore.get().history).toEqual([]); // nothing merged into the account
    expect(m.getSyncState()).toMatchObject({ status: 'error', migrationOffer: 1 });
    expect(m.getSyncState().message).toMatch(/Upload failed: network down\. Nothing was removed/);
    expect(m.getDecision(A)).toBeNull();
  });

  it('a retry after a failure imports once, then never again', async () => {
    const m = await offered();
    h.failImport = true;
    await m.acceptMigration();
    h.failImport = false;
    await m.acceptMigration();

    expect(m.getDecision(A)).toBe('done');
    expect(m.getSyncState().migrationOffer).toBeNull();
    expect(loadProgress(null)).toEqual(emptyProgress());
    expect(m.progressStore.get().history.map((t) => t.id)).toEqual(['g1']);

    await m.acceptMigration(); // e.g. a double click or a stale button
    expect(h.imports.flat()).toEqual(['g1', 'g1']); // the failed attempt and the successful one; nothing more
    expect(m.getSyncState().migrationOffer).toBeNull();
  });

  it('does not restore the offer when the user signed out during a failing import', async () => {
    const m = await offered();
    h.failImport = true;
    let release!: () => void;
    h.gate = new Promise((r) => (release = r));
    const running = m.acceptMigration();
    await vi.waitFor(() => expect(h.imports).toHaveLength(1));
    m.signOut();
    release();
    await running;

    expect(m.getSyncState()).toMatchObject({ status: 'idle', migrationOffer: null, message: null });
    expect(loadProgress(null).history.map((t) => t.id)).toEqual(['g1']); // guest copy untouched
  });

  it('declining never uploads and keeps the data as guest data', async () => {
    const m = await offered();
    await m.declineMigration();

    expect(h.imports).toEqual([]);
    expect(m.getDecision(A)).toBe('declined');
    expect(m.getSyncState().migrationOffer).toBeNull();
    expect(loadProgress(null).history.map((t) => t.id)).toEqual(['g1']);
    expect(m.progressStore.get().history).toEqual([]);
  });
});
