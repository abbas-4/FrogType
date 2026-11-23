import { requireClient } from './supabase';

export interface LeaderboardRow {
  rank: number;
  username: string;
  wpm: number;
  accuracy: number;
  mode: string;
  mode2: number;
  duration_ms: number;
  created_at: string;
}

export async function getLeaderboard(scope: 'global' | 'friends', mode: 'time' | 'words', mode2: number): Promise<LeaderboardRow[]> {
  const { data, error } = await requireClient().rpc('get_leaderboard', { p_scope: scope, p_mode: mode, p_mode2: mode2, p_limit: 50 });
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

export interface Friend {
  id: number;
  username: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
}

export async function listFriends(): Promise<Friend[]> {
  const { data, error } = await requireClient().rpc('list_friends');
  if (error) throw error;
  return (data ?? []) as Friend[];
}

export async function sendFriendRequest(username: string): Promise<void> {
  const { error } = await requireClient().rpc('send_friend_request', { p_username: username.trim() });
  if (error) throw error;
}

export async function respondFriendRequest(id: number, accept: boolean): Promise<void> {
  const { error } = await requireClient().rpc('respond_friend_request', { p_id: id, p_accept: accept });
  if (error) throw error;
}

export async function removeFriend(id: number): Promise<void> {
  const { error } = await requireClient().from('friendships').delete().eq('id', id);
  if (error) throw error;
}

export interface PublicProfile {
  username: string;
  created_at: string;
  total_xp: number;
  best_wpm: number;
  avg_accuracy: number;
  total_tests: number;
  achievements: string[];
  current_streak: number;
}

export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const { data, error } = await requireClient().rpc('get_public_profile', { p_username: username });
  if (error) throw error;
  return (data as PublicProfile | null) ?? null;
}

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export async function updateProfile(userId: string, patch: { username?: string; is_public?: boolean; show_on_leaderboard?: boolean }): Promise<void> {
  if (patch.username !== undefined && !USERNAME_RE.test(patch.username)) throw new Error('Username must be 3–20 letters, numbers or underscores.');
  const { error } = await requireClient().from('profiles').update(patch).eq('id', userId);
  if (error) throw error.code === '23505' ? new Error('That username is taken.') : error;
}

/** Mirrors supabase/config.toml (minimum_password_length = 10, lower_upper_letters_digits). Set the same in the hosted project. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters.';
  if (password.length > 72) return 'Password must be at most 72 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) return 'Password needs an uppercase letter, a lowercase letter and a number.';
  return null;
}

/** Turns auth errors into messages that never reveal whether an email has an account. */
function authError(e: { message?: string; code?: string; status?: number }): Error {
  if (e.status === 429 || /rate limit|too many/i.test(e.message ?? '')) return new Error('Too many attempts. Please wait a few minutes and try again.');
  if (e.code === 'weak_password') return new Error(e.message ?? 'Password is too weak.');
  return new Error(e.message ?? 'Something went wrong. Please try again.');
}

export async function signUp(email: string, password: string, username: string, consent: { publicProfile: boolean; showOnLeaderboard: boolean } = { publicProfile: false, showOnLeaderboard: false }) {
  if (!USERNAME_RE.test(username)) throw new Error('Username must be 3–20 letters, numbers or underscores.');
  const bad = passwordProblem(password);
  if (bad) throw new Error(bad);
  const { data, error } = await requireClient().auth.signUp({
    email: email.trim(),
    password,
    // FT-07: visibility is opt-in; the server treats anything but literal true as private
    options: { data: { username, public_profile: consent.publicProfile, show_on_leaderboard: consent.showOnLeaderboard }, emailRedirectTo: `${window.location.origin}/profile` },
  });
  // Same answer as a fresh sign-up, so the form never confirms that an email is registered (see SECURITY-AUDIT residual N-6).
  if (error?.code === 'user_already_exists') return { needsConfirmation: true };
  if (error) throw authError(error);
  return { needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string) {
  const { error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error.status === 429 ? authError(error) : new Error('Incorrect email or password, or the email is not confirmed yet.');
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

/** FT-04: the link lands on /reset-password, which asks for the new password. Same message whether or not the email exists. */
export async function resetPassword(email: string) {
  const { error } = await requireClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
  if (error && (error.status === 429 || /rate limit/i.test(error.message))) throw authError(error);
  // other errors are swallowed on purpose: reporting them would reveal which emails have accounts
}

/** Sets a new password for the current (recovery) session, then signs out every other session. */
export async function updatePassword(password: string) {
  const bad = passwordProblem(password);
  if (bad) throw new Error(bad);
  const c = requireClient();
  const { error } = await c.auth.updateUser({ password });
  if (error) throw authError(error);
  await c.auth.signOut({ scope: 'others' });
}

/** FT-10: re-authenticate with the password, then delete the account server-side (cascades every user row). */
export async function deleteAccount(email: string, password: string, confirmUsername: string) {
  const c = requireClient();
  const { error: authErr } = await c.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error('Password is incorrect.');
  const { error } = await c.rpc('delete_my_account', { p_confirm: confirmUsername });
  if (error) throw error;
  await c.auth.signOut({ scope: 'local' }); // the server user (and its refresh tokens) no longer exist
}
