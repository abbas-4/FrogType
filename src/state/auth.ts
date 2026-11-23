import { useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { activateProgressOwner } from './store';

export interface Profile {
  id: string;
  username: string;
  is_public: boolean;
  show_on_leaderboard: boolean;
  created_at: string;
}

export interface AuthState {
  ready: boolean;
  user: User | null;
  profile: Profile | null;
  /** true while the session came from a password-recovery link and a new password has not been set yet */
  recovery: boolean;
}

let state: AuthState = { ready: !supabase, user: null, profile: null, recovery: false };
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
  const { data } = await supabase.from('profiles').select('id, username, is_public, show_on_leaderboard, created_at').eq('id', uid).maybeSingle();
  if (state.user?.id === uid) set({ profile: (data as Profile | null) ?? null }); // ignore a stale response after an account switch
}

const signedInHandlers = new Set<(u: User) => void>();
export function onSignedIn(fn: (u: User) => void) {
  signedInHandlers.add(fn);
  return () => signedInHandlers.delete(fn);
}

/** Applies a session identity change. Exported for tests; the Supabase listener below is the only production caller. */
export function applyIdentity(user: User | null, event: string) {
  const changed = user?.id !== state.user?.id;
  if (changed) activateProgressOwner(user?.id ?? null); // swap local data before anything renders with the new identity
  set({
    user,
    ready: true,
    profile: changed ? null : state.profile,
    recovery: event === 'PASSWORD_RECOVERY' ? true : user && !changed && event !== 'SIGNED_OUT' ? state.recovery : false,
  });
  return changed;
}

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    const changed = applyIdentity(user, event);
    if (changed) {
      // Defer: supabase-js warns against awaiting client calls inside this callback.
      setTimeout(() => {
        void loadProfile();
        if (user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) signedInHandlers.forEach((h) => h(user));
      }, 0);
    }
  });
}
