import { useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { storedSessionUserId, supabase } from '../services/supabase';
import { activateProgressOwner } from './store';
import { takeExpectedSignOut } from './signOutIntent';

export { expectSignOut } from './signOutIntent';

export interface Profile {
  id: string;
  username: string;
  is_public: boolean;
  show_on_leaderboard: boolean;
  created_at: string;
  avatar: string | null;
  bio: string | null;
}

export interface AuthState {
  ready: boolean;
  user: User | null;
  profile: Profile | null;
  /** true while the session came from a password-recovery link and a new password has not been set yet */
  recovery: boolean;
  /** the session ended without the user asking (refresh token expired or revoked, signed out in another tab) */
  sessionEnded: boolean;
}

let state: AuthState = { ready: !supabase, user: null, profile: null, recovery: false, sessionEnded: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<AuthState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const authStore = {
  get: () => state,
  set,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useAuth(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.get);
}

export async function loadProfile(): Promise<void> {
  const uid = state.user?.id;
  if (!supabase || !uid) return set({ profile: null });
  const { data } = await supabase.from('profiles').select('id, username, is_public, show_on_leaderboard, created_at, avatar, bio').eq('id', uid).maybeSingle();
  if (state.user?.id === uid) set({ profile: (data as Profile | null) ?? null }); // ignore a stale response after an account switch
}

const signedInHandlers = new Set<(u: User) => void>();
export function onSignedIn(fn: (u: User) => void) {
  signedInHandlers.add(fn);
  return () => signedInHandlers.delete(fn);
}

export function dismissSessionEnded() {
  set({ sessionEnded: false });
}

/** Applies a session identity change. Exported for tests; the Supabase listener below is the only production caller. */
export function applyIdentity(user: User | null, event: string) {
  const changed = user?.id !== state.user?.id;
  const ended = !user && Boolean(state.user) && !takeExpectedSignOut();
  if (changed) activateProgressOwner(user?.id ?? null); // swap local data before anything renders with the new identity
  set({
    user,
    ready: true,
    profile: changed ? null : state.profile,
    recovery: event === 'PASSWORD_RECOVERY' ? true : user && !changed && event !== 'SIGNED_OUT' ? state.recovery : false,
    sessionEnded: user ? false : ended || state.sessionEnded,
  });
  return changed;
}

/** Applies an identity and, when it changed, loads the profile and runs sign-in handlers (deferred out of the callback). */
function follow(user: User | null, event: string) {
  const changed = applyIdentity(user, event);
  if (changed) {
    // Defer: supabase-js warns against awaiting client calls inside this callback.
    setTimeout(() => {
      void loadProfile();
      if (user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) signedInHandlers.forEach((h) => h(user));
    }, 0);
  }
}

if (supabase) {
  const client = supabase;
  client.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    // supabase-js broadcasts SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT to every tab without touching their storage, and
    // a tab may hold a tab-only session (sessionStorage) that differs from the shared one. The identity always follows
    // the session THIS tab holds: if the event disagrees with it, re-read the session instead of trusting the event.
    // INITIAL_SESSION is never broadcast (it is this tab's own start-up) and must always mark auth as ready.
    const stored = storedSessionUserId();
    if (event !== 'INITIAL_SESSION' && (user ? stored !== user.id : stored !== null)) {
      if (!user) takeExpectedSignOut(); // this tab's own sign-out revealed the browser's shared session: not an expiry
      setTimeout(() => {
        void client.auth.getSession().then(({ data }) => follow(data.session?.user ?? null, data.session ? 'SIGNED_IN' : 'SIGNED_OUT'));
      }, 0);
      return;
    }
    follow(user, event);
  });
}
