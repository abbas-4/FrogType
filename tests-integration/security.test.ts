// Realistic attacks over HTTP against a local Supabase stack with real GoTrue users (synthetic accounts only).
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { toPayload } from '../src/services/cloud';
import { admin, anon, env, latestMail, linkIn, newUser, PASSWORD, payloadFor, psql, simulateTyping, sleep } from './helpers';

const unverified = (wpm = 60) =>
  toPayload({ ...simulateTyping(['alpha', 'beta', 'gamma', 'delta', 'omega']), wpm, raw: wpm + 1, durationMs: 30000, mode: 'time', mode2: 30, chars: { correct: Math.ceil(wpm * 2.5), incorrect: 0, extra: 0, missed: 0 }, keylog: undefined });

async function rankedRun(u: Awaited<ReturnType<typeof newUser>>, opts: { typos?: boolean } = {}) {
  const { data: ch, error } = await u.c.rpc('issue_challenge', { p_mode: 'words', p_mode2: 10 });
  if (error) throw error;
  const r = simulateTyping(ch.words, { msPerKey: 95, ...opts });
  await sleep(r.durationMs + 300); // the server refuses results that finish faster than real time
  return { ch, r };
}

describe('1. anonymous attacker', () => {
  it('cannot call protected RPCs or read tables', async () => {
    const a = anon();
    for (const [fn, args] of [
      ['submit_test', { payload: unverified() }],
      ['issue_challenge', { p_mode: 'words', p_mode2: 10 }],
      ['import_tests', { payloads: [] }],
      ['sync_progress', {}],
      ['delete_my_account', { p_confirm: 'x' }],
      ['ft_award', { p_user: '00000000-0000-0000-0000-000000000000' }],
      ['ft_replay', { p_words: ['a'], p_mode: 'words', p_mode2: 1, p_keys: 'a', p_times: [0] }],
    ] as const) {
      const { error } = await a.rpc(fn, args);
      expect(error, fn).not.toBeNull();
    }
    for (const table of ['profiles', 'typing_tests', 'xp_transactions', 'friendships', 'test_challenges', 'rate_limits']) {
      const { data, error } = await a.from(table).select('*').limit(1);
      expect(error ?? (data?.length === 0 ? null : 'rows'), table).not.toBeNull();
    }
  });
});

describe('3/5. score integrity (real engine -> server replay)', () => {
  it('server-recomputed metrics match the client engine exactly for an honest run with typos', async () => {
    const u = await newUser(); // new accounts are on leaderboards by default
    const { ch, r } = await rankedRun(u, { typos: true });
    const { data, error } = await u.c.rpc('submit_test', { payload: payloadFor(r, ch.id) });
    expect(error).toBeNull();
    expect(data).toMatchObject({ accepted: true, verified: true, ranked: true, flags: [] });
    expect(Math.abs(Number(data.wpm) - r.wpm)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(Number(data.accuracy) - r.accuracy)).toBeLessThanOrEqual(0.01);
    const onBoard = async () => {
      const { data: board } = await anon().rpc('get_leaderboard', { p_scope: 'global', p_mode: 'words', p_mode2: 10, p_limit: 100 });
      return board.some((row: { username: string }) => row.username === u.username);
    };
    expect(await onBoard()).toBe(true);
    // the owner's opt-out removes them from the public board on the very next request, and opting back in restores them
    expect((await u.c.from('profiles').update({ show_on_leaderboard: false }).eq('id', u.id)).error).toBeNull();
    expect(await onBoard()).toBe(false);
    expect((await u.c.from('profiles').update({ show_on_leaderboard: true }).eq('id', u.id)).error).toBeNull();
    expect(await onBoard()).toBe(true);
  });

  it('rejects inflated metrics, replays and another user\'s challenge', async () => {
    const u = await newUser();
    const { ch, r } = await rankedRun(u);
    const forged = { ...payloadFor(r, ch.id), wpm: 240, raw: 245, chars: { correct: 5000, incorrect: 0, extra: 0, missed: 0 } };
    const first = await u.c.rpc('submit_test', { payload: forged });
    expect(first.data).toMatchObject({ verified: false, ranked: false, flags: ['metric_mismatch'] });
    expect(Number(first.data.wpm)).toBeCloseTo(r.wpm, 1); // stored value is the server's, not the claim

    const replay = await u.c.rpc('submit_test', { payload: { ...payloadFor(r, ch.id), id: crypto.randomUUID() } });
    expect(replay.data).toMatchObject({ verified: false, flags: ['challenge_invalid'] });

    const thief = await newUser();
    const { data: ch2 } = await u.c.rpc('issue_challenge', { p_mode: 'words', p_mode2: 10 });
    const r2 = simulateTyping(ch2.words, { msPerKey: 95 });
    await sleep(r2.durationMs + 300);
    const stolen = await thief.c.rpc('submit_test', { payload: payloadFor(r2, ch2.id) });
    expect(stolen.data).toMatchObject({ verified: false, flags: ['challenge_invalid'] });
  });

  it('a challenge raced by parallel submissions verifies at most once', async () => {
    const u = await newUser();
    const { ch, r } = await rankedRun(u);
    const results = await Promise.all(Array.from({ length: 6 }, () => u.c.rpc('submit_test', { payload: { ...payloadFor(r, ch.id), id: crypto.randomUUID() } })));
    expect(results.filter((x) => x.data?.verified).length).toBe(1);
  });
});

describe('6. concurrency and abuse limits', () => {
  it('parallel submissions cannot bypass the per-minute limit', async () => {
    const u = await newUser();
    const results = await Promise.all(Array.from({ length: 40 }, () => u.c.rpc('submit_test', { payload: { ...unverified(), id: crypto.randomUUID() } })));
    const ok = results.filter((x) => !x.error).length;
    expect(ok).toBe(30);
    expect(results.filter((x) => /rate limited/.test(x.error?.message ?? '')).length).toBe(10);
  });

  it('7. oversized and malformed payloads are refused', async () => {
    const u = await newUser();
    const big = await u.c.rpc('submit_test', { payload: { ...unverified(), bigram_errors: { x: 'y'.repeat(400_000) } } });
    expect(big.error).not.toBeNull();
    const bad = await u.c.rpc('submit_test', { payload: { ...unverified(), wpm: 'NaN' } });
    expect(bad.error?.message).toMatch(/invalid field/);
    const imp = await u.c.rpc('import_tests', { payloads: Array.from({ length: 201 }, () => unverified()) });
    expect(imp.error?.message).toMatch(/at most 200/);
  });
});

describe('2. cross-account access over REST', () => {
  it('user A can neither read nor modify user B\'s rows', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await b.c.rpc('submit_test', { payload: unverified() });
    expect((await a.c.from('typing_tests').select('*').eq('user_id', b.id)).data).toEqual([]);
    expect((await a.c.from('profiles').select('*').eq('id', b.id)).data).toEqual([]);
    await a.c.from('profiles').update({ username: 'pwned_by_a' }).eq('id', b.id);
    await a.c.from('typing_tests').delete().eq('user_id', b.id);
    const ins = await a.c.from('typing_tests').insert({ ...unverified(), user_id: b.id });
    expect(ins.error).not.toBeNull();
    const upd = await a.c.from('profiles').update({ created_at: new Date().toISOString() } as never).eq('id', a.id);
    expect(upd.error).not.toBeNull();
    const { data: prof } = await admin.from('profiles').select('username').eq('id', b.id).single();
    expect(prof!.username).toBe(b.username);
    expect((await admin.from('typing_tests').select('id').eq('user_id', b.id)).data).toHaveLength(1);
  });
});

describe('4/15. forged progression and imports', () => {
  it('merge_progress claims and forged imports award nothing authoritative', async () => {
    const u = await newUser({ public_profile: true });
    await u.c.rpc('merge_progress', {
      p_xp: [{ key: 'daily:2026-01-01', amount: 100, reason: 'x' }, { key: 'streak:2026-01-01', amount: 70, reason: 'x' }],
      p_achievements: { 'wpm-100': 'x', 'all-lessons': 'x' },
      p_lessons: { 'speed-2': { completed: true, bestWpm: 300 } },
    });
    const forged = toPayload({ ...simulateTyping(['a', 'b', 'c', 'd', 'e']), mode: 'time', mode2: 60, durationMs: 60000, wpm: 240, raw: 241, chars: { correct: 1300, incorrect: 0, extra: 0, missed: 0 }, keylog: undefined });
    expect((await u.c.rpc('import_tests', { payloads: [forged] })).data).toBe(1);
    expect((await u.c.from('xp_transactions').select('*')).data).toEqual([]);
    expect((await u.c.from('user_achievements').select('*')).data).toEqual([]);
    expect((await u.c.from('lesson_progress').select('*')).data).toEqual([]);
    const { data: pub } = await anon().rpc('get_public_profile', { p_username: u.username });
    expect(pub).toMatchObject({ best_wpm: 0, total_xp: 0, achievements: [] });
  });
});

describe('10/13. friends and privacy', () => {
  it('third parties cannot accept requests; private profiles stay private', async () => {
    const [a, b, eve] = [await newUser(), await newUser(), await newUser()];
    expect((await a.c.rpc('send_friend_request', { p_username: b.username })).error).toBeNull();
    expect((await a.c.rpc('send_friend_request', { p_username: 'nobody_here_123' })).error).toBeNull(); // same response: no enumeration
    const { data: incoming } = await b.c.rpc('list_friends');
    const reqId = incoming[0].id;
    expect((await eve.c.rpc('respond_friend_request', { p_id: reqId, p_accept: true })).error?.message).toMatch(/not found/);
    expect((await a.c.rpc('respond_friend_request', { p_id: reqId, p_accept: true })).error?.message).toMatch(/not found/);
    expect((await a.c.from('profiles').update({ is_public: false }).eq('id', a.id)).error).toBeNull(); // a chose a private profile
    expect((await anon().rpc('get_public_profile', { p_username: a.username })).data).toBeNull();
    expect((await eve.c.rpc('get_public_profile', { p_username: a.username })).data).toBeNull();
    expect((await a.c.rpc('get_public_profile', { p_username: a.username })).data).not.toBeNull();
  });

  it('12. hostile usernames are rejected everywhere', async () => {
    const u = await newUser();
    for (const name of ['<script>alert(1)</script>', "x'; drop table profiles; --", 'a'.repeat(21), 'ab', 'émoji😀']) {
      const { error } = await u.c.from('profiles').update({ username: name }).eq('id', u.id);
      expect(error, name).not.toBeNull();
    }
    const { data: created } = await admin.auth.admin.createUser({ email: `hostile-${Date.now()}@frogtype.test`, password: PASSWORD, email_confirm: true, user_metadata: { username: '<img src=x onerror=alert(1)>' } });
    const { data: p } = await admin.from('profiles').select('username').eq('id', created.user!.id).single();
    expect(p!.username).toMatch(/^frog_[0-9a-f]{8}$/);
  });
});

describe('FT-10. export and deletion', () => {
  it('a re-authenticated user can export their data and delete the account; everything cascades', async () => {
    const u = await newUser();
    await u.c.rpc('submit_test', { payload: unverified() });
    const { data: mine } = await u.c.from('typing_tests').select('user_id');
    expect(mine!.every((t) => t.user_id === u.id)).toBe(true);
    expect((await u.c.rpc('delete_my_account', { p_confirm: 'someone_else' })).error?.message).toMatch(/did not match/);
    expect((await u.c.rpc('delete_my_account', { p_confirm: u.username })).error).toBeNull(); // fresh sign-in => recent amr
    expect((await admin.auth.admin.getUserById(u.id)).error).not.toBeNull();
    expect((await admin.from('typing_tests').select('id').eq('user_id', u.id)).data).toEqual([]);
    expect((await admin.from('profiles').select('id').eq('id', u.id)).data).toEqual([]);
  });
});

describe('11. password recovery (GoTrue + mailpit)', () => {
  const pkceClient = () => {
    const mem = new Map<string, string>();
    return createClient(env.url, env.anon, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) } },
    });
  };
  const redirectTo = 'http://localhost:4174/reset-password';

  it('valid link sets a new password once; reuse, tampering and expiry fail', async () => {
    const u = await newUser();
    const c = pkceClient();
    const t0 = Date.now();
    expect((await c.auth.resetPasswordForEmail(u.email, { redirectTo })).error).toBeNull();
    const link = linkIn(await latestMail(u.email, /reset/i, t0 - 1000));
    const res = await fetch(link, { redirect: 'manual' });
    const loc = new URL(res.headers.get('location')!);
    expect(`${loc.origin}${loc.pathname}`).toBe(redirectTo); // only allow-listed redirect
    const code = loc.searchParams.get('code')!;
    const ex = await c.auth.exchangeCodeForSession(code);
    expect(ex.error).toBeNull();
    expect((ex.data as { redirectType?: string | null }).redirectType).toBe('recovery');
    expect((await c.auth.updateUser({ password: 'weak' })).error).not.toBeNull(); // policy enforced server-side
    expect((await c.auth.updateUser({ password: 'Brand-New-Passw0rd' })).error).toBeNull();
    expect((await anon().auth.signInWithPassword({ email: u.email, password: PASSWORD })).error).not.toBeNull();
    expect((await anon().auth.signInWithPassword({ email: u.email, password: 'Brand-New-Passw0rd' })).error).toBeNull();

    // reuse: the same email link a second time
    const again = new URL((await fetch(link, { redirect: 'manual' })).headers.get('location')!);
    expect(`${again.search}${again.hash}`).toMatch(/error/);
    // the code can't be exchanged twice either
    expect((await pkceClient().auth.exchangeCodeForSession(code)).error).not.toBeNull();
    // tampered token
    const bad = new URL((await fetch(link.replace(/token=[^&]+/, 'token=deadbeef'), { redirect: 'manual' })).headers.get('location')!);
    expect(`${bad.search}${bad.hash}`).toMatch(/error/);
  });

  it('expired links are refused', async () => {
    const u = await newUser();
    const t0 = Date.now();
    await pkceClient().auth.resetPasswordForEmail(u.email, { redirectTo });
    const link = linkIn(await latestMail(u.email, /reset/i, t0 - 1000));
    psql(`update auth.users set recovery_sent_at = now() - interval '2 hours' where id = '${u.id}'`);
    const loc = new URL((await fetch(link, { redirect: 'manual' })).headers.get('location')!);
    expect(`${loc.search}${loc.hash}`).toMatch(/error/);
  });

  it('does not reveal whether an email has an account', async () => {
    const unknown = await pkceClient().auth.resetPasswordForEmail(`nobody-${Date.now()}@frogtype.test`, { redirectTo });
    expect(unknown.error).toBeNull();
    // Canary for a documented upstream residual: GoTrue (v2.198) answers 422 user_already_exists for confirmed emails
    // even with confirmations on. The FrogType UI masks it (tests/auth-recovery.test.ts); the raw API still leaks it.
    // If this starts failing, Supabase changed the behaviour: update SECURITY-AUDIT.md (N-6).
    const u = await newUser();
    const dup = await anon().auth.signUp({ email: u.email, password: 'Another-Passw0rd' });
    expect(dup.error?.code).toBe('user_already_exists');
  });
});
