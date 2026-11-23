// Account system over real HTTP against the local Supabase stack: profiles, username checks, auth flows (synthetic accounts only).
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { admin, anon, latestMail, linkIn, newUser, PASSWORD, sleep, type TestUser } from './env';

const created: string[] = [];
const user = async (meta: Record<string, unknown> = {}) => {
  const u = await newUser(meta);
  created.push(u.id);
  return u;
};
const freshEmail = (p: string) => `${p}-${randomBytes(5).toString('hex')}@frogtype.test`;
const profileOf = async (u: TestUser) => (await admin.from('profiles').select('*').eq('id', u.id).single()).data!;

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

describe('username_available', () => {
  it('anon: free -> true, taken (any case) -> false, invalid -> false', async () => {
    const u = await user();
    const a = anon();
    const check = async (name: string) => {
      const { data, error } = await a.rpc('username_available', { p_username: name });
      expect(error, name).toBeNull();
      return data;
    };
    expect(await check(`free_${randomBytes(4).toString('hex')}`)).toBe(true);
    expect(await check(u.username)).toBe(false);
    expect(await check(u.username.toUpperCase())).toBe(false);
    for (const bad of ['ab', 'a'.repeat(21), 'bad name', '<script>']) expect(await check(bad)).toBe(false);
  });

  it('signed in: your own name counts as available, someone else\'s does not', async () => {
    const [u, other] = [await user(), await user()];
    expect((await u.c.rpc('username_available', { p_username: u.username.toUpperCase() })).data).toBe(true);
    expect((await u.c.rpc('username_available', { p_username: other.username })).data).toBe(false);
  });
});

describe('profile updates', () => {
  it('a taken username (any case) is refused with 23505', async () => {
    const [a, b] = [await user(), await user()];
    const { error } = await b.c.from('profiles').update({ username: a.username.toUpperCase() }).eq('id', b.id);
    expect(error?.code).toBe('23505');
    expect((await profileOf(b)).username).toBe(b.username);
  });

  it('own avatar and bio are saved; the bio is trimmed and blank becomes null', async () => {
    const u = await user();
    expect((await u.c.from('profiles').update({ avatar: 'cat', bio: '   fast fingers  ' }).eq('id', u.id)).error).toBeNull();
    expect(await profileOf(u)).toMatchObject({ avatar: 'cat', bio: 'fast fingers' });
    expect((await u.c.from('profiles').update({ bio: '   ' }).eq('id', u.id)).error).toBeNull();
    expect((await profileOf(u)).bio).toBeNull();
  });

  it('invalid avatar or bio is refused with 23514', async () => {
    const u = await user();
    for (const patch of [{ avatar: 'dragon' }, { bio: 'x'.repeat(161) }, { bio: 'line one\nline two' }, { bio: 'bell\u0007' }]) {
      const { error } = await u.c.from('profiles').update(patch).eq('id', u.id);
      expect(error?.code, JSON.stringify(patch)).toBe('23514');
    }
    expect(await profileOf(u)).toMatchObject({ avatar: null, bio: null });
  });

  it('user A can neither read nor update user B\'s profile; anon reads nothing', async () => {
    const [a, b] = [await user(), await user({ public_profile: true })];
    expect((await a.c.from('profiles').select('*').eq('id', b.id)).data).toEqual([]);
    const upd = await a.c.from('profiles').update({ avatar: 'ghost', bio: 'pwned', username: `pw_${randomBytes(4).toString('hex')}` }).eq('id', b.id).select();
    expect(upd.data ?? []).toEqual([]);
    expect(await profileOf(b)).toMatchObject({ username: b.username, avatar: null, bio: null });
    const { data, error } = await anon().from('profiles').select('*').limit(1);
    expect(error ?? (data?.length === 0 ? null : 'rows')).not.toBeNull();
  });

  it('username changes are limited to 5 a day', async () => {
    const u = await user();
    const rename = () => u.c.from('profiles').update({ username: `r_${randomBytes(5).toString('hex')}` }).eq('id', u.id);
    for (let i = 0; i < 5; i++) expect((await rename()).error, `rename ${i + 1}`).toBeNull();
    expect((await rename()).error?.message).toMatch(/rate limited/);
    // non-username edits are not counted
    expect((await u.c.from('profiles').update({ bio: 'still fine' }).eq('id', u.id)).error).toBeNull();
  });
});

describe('get_public_profile', () => {
  it('public profiles (the default) include avatar and bio; a private one is visible only to the owner', async () => {
    const [owner, other] = [await user(), await user()];
    await owner.c.from('profiles').update({ avatar: 'frog', bio: 'hello' }).eq('id', owner.id);
    const shown = { username: owner.username, avatar: 'frog', bio: 'hello' };
    for (const c of [anon(), other.c, owner.c]) {
      const { data } = await c.rpc('get_public_profile', { p_username: owner.username });
      expect(data).toMatchObject(shown);
      expect(JSON.stringify(data)).not.toContain(owner.email); // never exposes the email
    }

    expect((await owner.c.from('profiles').update({ is_public: false }).eq('id', owner.id)).error).toBeNull();
    expect((await anon().rpc('get_public_profile', { p_username: owner.username })).data).toBeNull();
    expect((await other.c.rpc('get_public_profile', { p_username: owner.username })).data).toBeNull();
    expect((await owner.c.rpc('get_public_profile', { p_username: owner.username })).data).toMatchObject(shown);
  });
});

describe('privacy settings', () => {
  it('start on; only the owner turns each off and on, independently, and the choice survives sign-out and sign-in', async () => {
    const [owner, other] = [await user({ public_profile: false, show_on_leaderboard: false }), await user()];
    const flags = async (c: TestUser['c']) => (await c.from('profiles').select('is_public, show_on_leaderboard').eq('id', owner.id).single()).data;
    expect(await flags(owner.c)).toEqual({ is_public: true, show_on_leaderboard: true }); // sign-up metadata cannot opt out

    expect((await owner.c.from('profiles').update({ show_on_leaderboard: false }).eq('id', owner.id)).error).toBeNull();
    expect(await flags(owner.c)).toEqual({ is_public: true, show_on_leaderboard: false });
    expect((await owner.c.from('profiles').update({ is_public: false }).eq('id', owner.id)).error).toBeNull();

    // nobody else can flip them back, through the API directly
    const hijack = await other.c.from('profiles').update({ is_public: true, show_on_leaderboard: true }).eq('id', owner.id).select();
    expect(hijack.data ?? []).toEqual([]);
    expect((await anon().from('profiles').update({ is_public: true }).eq('id', owner.id)).error).not.toBeNull();

    await owner.c.auth.signOut();
    const again = anon();
    expect((await again.auth.signInWithPassword({ email: owner.email, password: PASSWORD })).error).toBeNull();
    expect(await flags(again)).toEqual({ is_public: false, show_on_leaderboard: false });
    expect((await again.from('profiles').update({ is_public: true, show_on_leaderboard: true }).eq('id', owner.id)).error).toBeNull();
    expect(await flags(again)).toEqual({ is_public: true, show_on_leaderboard: true });
  });
});

describe('sign-in and confirmation emails', () => {
  it('unconfirmed email: email_not_confirmed only with the right password', async () => {
    const email = freshEmail('unconf');
    const { data, error } = await anon().auth.signUp({ email, password: PASSWORD });
    expect(error).toBeNull();
    created.push(data.user!.id);
    expect((await anon().auth.signInWithPassword({ email, password: PASSWORD })).error?.code).toBe('email_not_confirmed');
    expect((await anon().auth.signInWithPassword({ email, password: 'Wrong-Passw0rd' })).error?.code).toBe('invalid_credentials');
  });

  it('resend does not reveal whether an email exists or is already confirmed', async () => {
    const u = await user();
    expect((await anon().auth.resend({ type: 'signup', email: freshEmail('nobody') })).error).toBeNull();
    expect((await anon().auth.resend({ type: 'signup', email: u.email })).error).toBeNull();
  });
});

describe('password change (reauth -> update -> sign out others)', () => {
  it('other sessions die, the new password works and the old one does not', async () => {
    const u = await user();
    const second = anon();
    expect((await second.auth.signInWithPassword({ email: u.email, password: PASSWORD })).error).toBeNull();

    const next = 'Changed-Passw0rd-9';
    expect((await u.c.auth.signInWithPassword({ email: u.email, password: PASSWORD })).error).toBeNull();
    expect((await u.c.auth.updateUser({ password: next })).error).toBeNull();
    expect((await u.c.auth.signOut({ scope: 'others' })).error).toBeNull();

    expect((await second.auth.refreshSession()).error).not.toBeNull();
    expect((await u.c.auth.getUser()).error).toBeNull(); // the session that made the change survives
    expect((await anon().auth.signInWithPassword({ email: u.email, password: PASSWORD })).error?.code).toBe('invalid_credentials');
    expect((await anon().auth.signInWithPassword({ email: u.email, password: next })).error).toBeNull();
  });
});

describe('email change (double confirm)', () => {
  it('mails both addresses; the email changes only after both links are visited', async () => {
    const u = await user();
    const newEmail = freshEmail('moved');
    await sleep(1100); // GoTrue max_frequency is 1s per address
    const t0 = Date.now();
    const { error } = await u.c.auth.updateUser({ email: newEmail }, { emailRedirectTo: 'http://localhost:4174/settings' });
    expect(error).toBeNull();

    const oldLink = linkIn(await latestMail(u.email, /new email/i, t0 - 1000));
    const newLink = linkIn(await latestMail(newEmail, /new email/i, t0 - 1000));
    const current = async () => (await admin.auth.admin.getUserById(u.id)).data.user!.email;
    expect(await current()).toBe(u.email);

    const first = await fetch(oldLink, { redirect: 'manual' });
    expect(first.headers.get('location') ?? '').not.toMatch(/error/);
    expect(await current()).toBe(u.email);

    const second = await fetch(newLink, { redirect: 'manual' });
    expect(second.headers.get('location') ?? '').not.toMatch(/error/);
    expect(await current()).toBe(newEmail);
  });
});
