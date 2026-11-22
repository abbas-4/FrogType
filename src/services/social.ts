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

export async function signUp(email: string, password: string, username: string) {
  if (!USERNAME_RE.test(username)) throw new Error('Username must be 3–20 letters, numbers or underscores.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  const { data, error } = await requireClient().auth.signUp({ email: email.trim(), password, options: { data: { username } } });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string) {
  const { error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email: string) {
  const { error } = await requireClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/profile` });
  if (error) throw error;
}
