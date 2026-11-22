import { describe, expect, it, vi } from 'vitest';
import { mergeSnapshot } from '../src/services/cloud';
import { emptyProgress } from '../src/persistence/storage';
import { makeResult } from './fixtures';

describe('without Supabase configuration', () => {
  it('reports online features as unavailable instead of pretending', async () => {
    const { isSupabaseConfigured, requireClient, NotConfiguredError } = await import('../src/services/supabase');
    expect(isSupabaseConfigured).toBe(false);
    expect(() => requireClient()).toThrow(NotConfiguredError);
    const social = await import('../src/services/social');
    await expect(social.getLeaderboard('global', 'time', 60)).rejects.toThrow(NotConfiguredError);
    await expect(social.sendFriendRequest('bob')).rejects.toThrow(NotConfiguredError);
  });

  it('keeps recording progress locally and never queues uploads when signed out', async () => {
    const { saveResult } = await import('../src/services/results');
    const { progressStore } = await import('../src/state/store');
    progressStore.set(emptyProgress());
    saveResult(makeResult());
    expect(progressStore.get().history).toHaveLength(1);
    expect(progressStore.get().pendingSync).toHaveLength(0);
  });

  it('sync is a no-op without a signed-in user', async () => {
    const { syncNow } = await import('../src/services/sync');
    const spy = vi.spyOn(globalThis, 'fetch');
    await syncNow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('validates usernames and passwords before contacting the server', async () => {
    const { signUp } = await import('../src/services/social');
    await expect(signUp('a@b.c', 'longenough', 'no spaces!')).rejects.toThrow(/Username/);
    await expect(signUp('a@b.c', 'short', 'valid_name')).rejects.toThrow(/Password/);
  });
});

describe('local/cloud merge', () => {
  it('never drops local or cloud data and keeps the best values', () => {
    const local = { ...emptyProgress(), history: [makeResult({ id: 'L' })], xp: [{ key: 'test:L', amount: 10, reason: '', at: '' }], lessons: { 'home-1': { attempts: 2, bestWpm: 30, bestAccuracy: 90, completed: false, firstWpm: 20, lastAt: '2026-01-01' } } };
    const cloud = {
      tests: [makeResult({ id: 'C' }), makeResult({ id: 'L' })],
      xp: [{ key: 'test:C', amount: 5, reason: '', at: '' }, { key: 'test:L', amount: 999, reason: '', at: '' }],
      achievements: { 'first-test': '2026-01-01' },
      lessons: { 'home-1': { attempts: 1, bestWpm: 40, bestAccuracy: 85, completed: true, firstWpm: 25, lastAt: '2026-02-01' } },
      daily: {},
    };
    const m = mergeSnapshot(local, cloud);
    expect(m.history.map((t) => t.id).sort()).toEqual(['C', 'L']);
    expect(m.xp.find((x) => x.key === 'test:L')!.amount).toBe(10);
    expect(m.xp).toHaveLength(2);
    expect(m.lessons['home-1']).toMatchObject({ attempts: 2, bestWpm: 40, bestAccuracy: 90, completed: true });
    expect(m.achievements['first-test']).toBeDefined();
  });
});
