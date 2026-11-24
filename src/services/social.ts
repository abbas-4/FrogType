import { chooseSessionPersistence, errorMessage, requireClient, setRememberSession } from './supabase';
import { pushToast } from '../state/toasts';
import { BIO_MAX, isAvatar, normalizeBio, type AvatarKey } from '../domain/avatars';
import { expectSignOut } from '../state/signOutIntent';

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
  avatar: string | null;
  bio: string | null;
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

/** Usernames are unique case-insensitively (unique index on lower(username)). */
export const USERNAME_TAKEN = 'This username is already taken. Please choose another one.';

/** Describes what is wrong with a username, or null when the format is fine (availability is checked separately). */
export function usernameProblem(name: string): string | null {
  if (name.length < 3) return 'Username must be at least 3 characters.';
  if (name.length > 20) return 'Username must be at most 20 characters.';
  if (!USERNAME_RE.test(name)) return 'Use only letters, numbers and underscores.';
  return null;
}

/** Real-time hint for forms. 'unknown' (offline, rate-limited) never blocks: the server still guarantees uniqueness. */
export async function checkUsername(name: string): Promise<'available' | 'taken' | 'invalid' | 'unknown'> {
  if (usernameProblem(name)) return 'invalid';
  try {
    const { data, error } = await requireClient().rpc('username_available', { p_username: name });
    if (error) return 'unknown';
    return data === true ? 'available' : 'taken';
  } catch {
    return 'unknown';
  }
}

export interface ProfilePatch {
  username?: string;
  is_public?: boolean;
  show_on_leaderboard?: boolean;
  avatar?: AvatarKey | null;
  bio?: string | null;
}

/** Only the owner's row can change (RLS + column grants); the server re-checks every value. */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  if (patch.username !== undefined) {
    const bad = usernameProblem(patch.username);
    if (bad) throw new Error(bad);
  }
  if (patch.avatar !== undefined && patch.avatar !== null && !isAvatar(patch.avatar)) throw new Error('Pick one of the built-in avatars.');
  if (typeof patch.bio === 'string') {
    const bio = normalizeBio(patch.bio);
    if (bio.length > BIO_MAX) throw new Error(`Bio must be at most ${BIO_MAX} characters.`);
    patch = { ...patch, bio: bio || null };
  }
  const { error } = await requireClient().from('profiles').update(patch).eq('id', userId);
  if (!error) return;
  if (error.code === '23505') throw new Error(USERNAME_TAKEN); // profiles_username_lower: the database is the final check
  if (/rate limited/i.test(error.message)) throw new Error('You have changed your username too often today. Try again tomorrow.');
  throw error;
}

/** Mirrors supabase/config.toml minimum_password_length. Set the same in the hosted project (Auth > Providers > Email). */
export const MIN_PASSWORD_LENGTH = 8;

/** Mirrors supabase/config.toml (minimum_password_length, lower_upper_letters_digits). */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
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

export async function signUp(email: string, password: string, username: string) {
  if (!USERNAME_RE.test(username)) throw new Error('Username must be 3–20 letters, numbers or underscores.');
  const bad = passwordProblem(password);
  if (bad) throw new Error(bad);
  const { data, error } = await requireClient().auth.signUp({
    email: email.trim(),
    password,
    // Privacy is not chosen at sign-up: new accounts start public and on leaderboards (column defaults), changeable in Settings.
    options: { data: { username }, emailRedirectTo: `${window.location.origin}/profile` },
  });
  // Same answer as a fresh sign-up, so the form never confirms that an email is registered (see SECURITY-AUDIT residual N-6).
  if (error?.code === 'user_already_exists') return { needsConfirmation: true };
  if (error) throw authError(error);
  return { needsConfirmation: !data.session };
}

/**
 * GoTrue only reports an unconfirmed email after the password matched, so saying so reveals nothing to someone who
 * does not already know the password.
 */
export class EmailNotConfirmedError extends Error {
  /** the account's address, so a username sign-in can still offer to resend the confirmation */
  constructor(readonly email = '') {
    super('Your email address is not confirmed yet. Open the link we emailed you, or send a new one.');
  }
}

export const SIGN_IN_FAILED = 'Incorrect email, username or password.';

/**
 * `login` is an email address or a username (usernames never contain "@"). A username is traded for the account's
 * email by email_for_sign_in, which answers only when the password matches. `remember: false` keeps the session in
 * this tab only (sessionStorage), for shared computers.
 */
export async function signIn(login: string, password: string, remember = true) {
  let email = login.trim();
  if (!email.includes('@')) {
    const { data, error } = await requireClient().rpc('email_for_sign_in', { p_username: email, p_password: password });
    if (error) throw /rate limited/i.test(error.message) ? new Error('Too many attempts. Please wait a few minutes and try again.') : error;
    if (typeof data !== 'string' || !data) throw new Error(SIGN_IN_FAILED);
    email = data;
  }
  chooseSessionPersistence(remember); // applies only to the session this attempt creates, in this tab
  let error;
  try {
    ({ error } = await requireClient().auth.signInWithPassword({ email, password }));
  } finally {
    chooseSessionPersistence(null);
  }
  if (!error) return setRememberSession(remember); // the checkbox default for next time; never set by a failed attempt
  if (error.status === 429) throw authError(error);
  if (error.code === 'email_not_confirmed') throw new EmailNotConfirmedError(email);
  throw new Error(SIGN_IN_FAILED);
}

/** Signs out of this browser. Local progress stays (namespaced to the account) unless the user removes it in Settings. */
export async function signOutWithToast() {
  try {
    await signOut();
    pushToast('Signed out', 'Your synced progress is safe. Tests you take now are saved in this browser as a guest.');
  } catch (e) {
    pushToast('Sign out failed', errorMessage(e));
  }
}

export async function signOut() {
  const cancel = expectSignOut();
  const { error } = await requireClient().auth.signOut();
  if (error) {
    cancel(); // still signed in: a later, real session end must be reported
    throw error;
  }
}

/**
 * Sends the sign-up confirmation email again. Always the same silent success: GoTrue's per-address cooldown answers
 * 429 only for addresses with an unconfirmed account, so reporting it would reveal which addresses signed up. The
 * button's own cooldown paces honest users; GoTrue's per-address and hourly limits still apply server-side.
 */
export async function resendConfirmation(email: string) {
  await requireClient().auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/profile` } });
}

/** Proves the person at the keyboard knows the current password before a sensitive change. */
async function reauthenticate(email: string, password: string) {
  const { error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error.status === 429 ? authError(error) : new Error('Current password is incorrect.');
}

/** Both the old and the new address must click their link (double_confirm_changes); nothing changes until then. */
export async function changeEmail(currentEmail: string, password: string, newEmail: string) {
  const next = newEmail.trim();
  if (!EMAIL_RE.test(next)) throw new Error('Enter a valid email address.');
  if (next.toLowerCase() === currentEmail.toLowerCase()) throw new Error('That is already your email address.');
  await reauthenticate(currentEmail, password);
  const { error } = await requireClient().auth.updateUser({ email: next }, { emailRedirectTo: `${window.location.origin}/settings` });
  if (error) throw authError(error);
}

/** Re-checks the current password, sets the new one, then signs out every other session. */
export async function changePassword(email: string, current: string, next: string) {
  const bad = passwordProblem(next);
  if (bad) throw new Error(bad);
  if (next === current) throw new Error('Choose a password different from your current one.');
  await reauthenticate(email, current);
  await updatePassword(next);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  expectSignOut();
  await c.auth.signOut({ scope: 'local' }); // the server user (and its refresh tokens) no longer exist
}
