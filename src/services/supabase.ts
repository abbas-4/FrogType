import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * FT-12: only HTTPS project URLs, except loopback HTTP for local development. Refuses anything that looks like a
 * service-role / secret key, because every VITE_ variable ships to every visitor's browser.
 */
export function checkSupabaseConfig(u: string | undefined, key: string | undefined): { ok: true } | { ok: false; reason: string } {
  if (!u || !key) return { ok: false, reason: 'not configured' };
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return { ok: false, reason: 'VITE_SUPABASE_URL is not a valid URL' };
  }
  if (parsed.username || parsed.password) return { ok: false, reason: 'VITE_SUPABASE_URL must not contain credentials' };
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname))) {
    return { ok: false, reason: 'VITE_SUPABASE_URL must use https:// (plain http is only allowed for localhost)' };
  }
  if (key.startsWith('sb_secret_')) return { ok: false, reason: 'VITE_SUPABASE_ANON_KEY is a secret key; use the public anon/publishable key' };
  try {
    const role = JSON.parse(atob(key.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).role;
    if (role === 'service_role') return { ok: false, reason: 'VITE_SUPABASE_ANON_KEY is the service-role key; use the public anon key' };
  } catch {
    /* not a JWT (e.g. sb_publishable_...) */
  }
  return { ok: true };
}

/** Captured before supabase-js consumes the URL, so /reset-password can tell a broken link from a direct visit. */
const landing = typeof window !== 'undefined' ? new URL(window.location.href) : null;
const landingHash = new URLSearchParams(landing?.hash.slice(1) ?? '');
export const landingAuth = {
  path: landing?.pathname ?? '/',
  hadCode: Boolean(landing?.searchParams.has('code') || landingHash.has('access_token')),
  error: landing?.searchParams.get('error_description') ?? landingHash.get('error_description') ?? landing?.searchParams.get('error') ?? landingHash.get('error'),
  /** GoTrue's note after the first half of a double-confirmed email change ("…confirm link sent to the other email"). */
  message: landing?.searchParams.get('message') ?? landingHash.get('message'),
};

// ---------------------------------------------------------------- "Keep me signed in"
// Sessions live in localStorage (survive restarts) or, when the user opts out, in sessionStorage (this tab only, gone
// when it closes). A session stays in the store it was first written to, so token refreshes never move it; only this
// tab's own sign-in decides where a NEW session goes (the saved preference is just the checkbox default).
// PKCE code verifiers always use localStorage: confirmation and reset links open in a new tab and need them.
const REMEMBER_KEY = 'frogtype:remember-session';
const tryStore = (fn: () => void) => {
  try {
    fn();
  } catch {
    /* storage blocked (private mode): the session simply is not persisted */
  }
};
const read = (s: () => Storage, k: string) => {
  try {
    return s().getItem(k);
  } catch {
    return null;
  }
};
export const rememberSession = () => read(() => localStorage, REMEMBER_KEY) !== '0';
export const setRememberSession = (remember: boolean) => tryStore(() => localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'));

/** Set by this tab's sign-in form for the session it is about to create; null otherwise. */
let choice: boolean | null = null;
export function chooseSessionPersistence(remember: boolean | null) {
  choice = remember;
}

export const authStorage = {
  getItem: (k: string) => read(() => sessionStorage, k) ?? read(() => localStorage, k),
  setItem(k: string, v: string) {
    const durable = k.endsWith('-code-verifier')
      ? true
      : choice !== null
        ? choice
        : read(() => sessionStorage, k) !== null
          ? false // pinned to this tab
          : read(() => localStorage, k) !== null || rememberSession();
    tryStore(() => (durable ? localStorage : sessionStorage).setItem(k, v));
    // Drop this tab's own tab-only copy when the session becomes durable. Never delete from localStorage for a
    // tab-only write: that copy is shared and may be another tab's remembered session.
    if (durable) tryStore(() => sessionStorage.removeItem(k));
  },
  /** Removes this tab's copy: the tab-only one if it has one, otherwise the shared one (sign-out, expired session). */
  removeItem(k: string) {
    if (read(() => sessionStorage, k) !== null) tryStore(() => sessionStorage.removeItem(k));
    else tryStore(() => localStorage.removeItem(k));
  },
};

const config = checkSupabaseConfig(url, anonKey);
if (!config.ok && config.reason !== 'not configured') console.error(`FrogType: online features disabled. ${config.reason}.`);

// Same value supabase-js derives by default, made explicit so existing sessions keep working and so the auth
// listener can read the session this tab actually holds.
export const AUTH_STORAGE_KEY = config.ok ? `sb-${new URL(url!).hostname.split('.')[0]}-auth-token` : 'sb-auth-token';

/**
 * User id of the session stored for THIS tab (its sessionStorage copy, else the shared localStorage one).
 * supabase-js broadcasts SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT to other tabs without touching their storage, so
 * the listener compares events against this before trusting them.
 */
export function storedSessionUserId(): string | null {
  try {
    const raw = authStorage.getItem(AUTH_STORAGE_KEY);
    const id = raw ? (JSON.parse(raw) as { user?: { id?: unknown } }).user?.id : null;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** Null when not configured: every online feature checks this and degrades to local-only. Only the public anon key belongs here. */
export const supabase: SupabaseClient | null = config.ok
  ? createClient(url!, anonKey!, {
      // PKCE: auth codes (incl. password-recovery links) only work in the browser that requested them.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storage: authStorage, storageKey: AUTH_STORAGE_KEY },
    })
  : null;

export const isSupabaseConfigured = supabase !== null;

export class NotConfiguredError extends Error {
  constructor() {
    super('Online features are not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README).');
  }
}

export function requireClient(): SupabaseClient {
  if (!supabase) throw new NotConfiguredError();
  return supabase;
}

/**
 * FT-03: a client bound to one access token. Sync uses it so a sign-out or account switch mid-sync can never send
 * one account's queued data with another account's session.
 */
export function pinnedClient(accessToken: string): SupabaseClient {
  if (!supabase) throw new NotConfiguredError();
  return createClient(url!, anonKey!, { accessToken: async () => accessToken });
}

/** Turns Supabase/network errors into a short user-facing message. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') return (e as { message: string }).message;
  return 'Something went wrong. Please try again.';
}
