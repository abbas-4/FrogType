// FT-04 / account enumeration: auth helpers with a mocked Supabase client.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as { fn: string; args: unknown[] }[], next: {} as Record<string, unknown> }));
vi.mock('../src/services/supabase', () => {
  const rec = (fn: string) => async (...args: unknown[]) => {
    h.calls.push({ fn, args });
    return h.next[fn] ?? { data: {}, error: null };
  };
  const client = {
    auth: { signUp: rec('signUp'), signInWithPassword: rec('signInWithPassword'), resetPasswordForEmail: rec('resetPasswordForEmail'), updateUser: rec('updateUser'), signOut: rec('signOut') },
    rpc: rec('rpc'),
  };
  return { requireClient: () => client, supabase: client, errorMessage: (e: Error) => e.message, setRememberSession: (v: boolean) => h.calls.push({ fn: 'setRememberSession', args: [v] }), chooseSessionPersistence: () => {} };
});

const social = await import('../src/services/social');

beforeEach(() => {
  h.calls = [];
  h.next = {};
});

describe('password policy', () => {
  it('matches the server policy', () => {
    expect(social.passwordProblem('Short1A')).toMatch(/10 characters/);
    expect(social.passwordProblem('alllowercase1')).toMatch(/uppercase/);
    expect(social.passwordProblem('NoDigitsHereAtAll')).toMatch(/number/);
    expect(social.passwordProblem('x'.repeat(73) + 'A1')).toMatch(/72/);
    expect(social.passwordProblem('Good-Passw0rd')).toBeNull();
  });
});

describe('no account enumeration in the UI', () => {
  it('sign-up of an existing email looks like a normal sign-up', async () => {
    h.next.signUp = { data: { session: null }, error: { code: 'user_already_exists', message: 'User already registered', status: 422 } };
    await expect(social.signUp('a@b.co', 'Good-Passw0rd', 'valid_name')).resolves.toEqual({ needsConfirmation: true });
  });
  it('reset request never says whether the email exists', async () => {
    h.next.resetPasswordForEmail = { error: { message: 'User not found', status: 400 } };
    await expect(social.resetPassword('ghost@b.co')).resolves.toBeUndefined();
    h.next.resetPasswordForEmail = { error: { message: 'email rate limit exceeded', status: 429 } };
    await expect(social.resetPassword('a@b.co')).rejects.toThrow(/Too many attempts/);
  });
  it('sign-in failures use one generic message', async () => {
    h.next.signInWithPassword = { error: { message: 'Invalid login credentials', status: 400 } };
    await expect(social.signIn('a@b.co', 'x')).rejects.toThrow(/Incorrect email or password/);
  });
  it('a failed sign-in never changes the saved "keep me signed in" preference; a successful one does', async () => {
    h.next.signInWithPassword = { error: { message: 'Invalid login credentials', status: 400 } };
    await expect(social.signIn('a@b.co', 'x', false)).rejects.toThrow();
    expect(h.calls.some((c) => c.fn === 'setRememberSession')).toBe(false);
    h.next.signInWithPassword = { data: {}, error: null };
    await social.signIn('a@b.co', 'Good-Passw0rd', false);
    expect(h.calls.filter((c) => c.fn === 'setRememberSession')).toEqual([{ fn: 'setRememberSession', args: [false] }]);
  });
});

describe('recovery and sign-up requests', () => {
  it('reset links land on /reset-password on this origin', async () => {
    await social.resetPassword(' a@b.co ');
    expect(h.calls[0]).toEqual({ fn: 'resetPasswordForEmail', args: ['a@b.co', { redirectTo: `${window.location.origin}/reset-password` }] });
  });
  it('updatePassword validates first, then signs out other sessions', async () => {
    await expect(social.updatePassword('weak')).rejects.toThrow();
    expect(h.calls).toEqual([]);
    await social.updatePassword('Good-Passw0rd');
    expect(h.calls.map((c) => c.fn)).toEqual(['updateUser', 'signOut']);
    expect(h.calls[1]!.args).toEqual([{ scope: 'others' }]);
  });
  it('sign-up sends only the username; privacy comes from the server defaults (public, on leaderboards)', async () => {
    await social.signUp('a@b.co', 'Good-Passw0rd', 'valid_name');
    expect((h.calls[0]!.args[0] as { options: { data: unknown } }).options.data).toEqual({ username: 'valid_name' });
  });
  it('account deletion re-authenticates before calling the server', async () => {
    await social.deleteAccount('a@b.co', 'pw', 'me');
    expect(h.calls.map((c) => c.fn)).toEqual(['signInWithPassword', 'rpc', 'signOut']);
    expect(h.calls[1]!.args).toEqual(['delete_my_account', { p_confirm: 'me' }]);
    h.calls = [];
    h.next.signInWithPassword = { error: { message: 'bad' } };
    await expect(social.deleteAccount('a@b.co', 'wrong', 'me')).rejects.toThrow(/Password is incorrect/);
    expect(h.calls.map((c) => c.fn)).toEqual(['signInWithPassword']);
  });
});
