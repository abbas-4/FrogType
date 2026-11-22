import { useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

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
}

let state: AuthState = { ready: !supabase, user: null, profile: null };
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
  if (!supabase || !state.user) return set({ profile: null });
  const { data } = await supabase.from('profiles').select('id, username, is_public, show_on_leaderboard, created_at').eq('id', state.user.id).maybeSingle();
  set({ profile: (data as Profile | null) ?? null });
}

const signedInHandlers = new Set<(u: User) => void>();
export function onSignedIn(fn: (u: User) => void) {
  signedInHandlers.add(fn);
  return () => signedInHandlers.delete(fn);
}

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    const changed = user?.id !== state.user?.id;
    set({ user, ready: true });
    if (changed) {
      // Defer: supabase-js warns against awaiting client calls inside this callback.
      setTimeout(() => {
        void loadProfile();
        if (user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) signedInHandlers.forEach((h) => h(user));
      }, 0);
    }
  });
}
