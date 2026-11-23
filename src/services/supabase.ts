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
  hadCode: Boolean(landing?.searchParams.has('code') || landingHash.has('access_token')),
  error: landing?.searchParams.get('error_description') ?? landingHash.get('error_description') ?? landing?.searchParams.get('error') ?? landingHash.get('error'),
};

const config = checkSupabaseConfig(url, anonKey);
if (!config.ok && config.reason !== 'not configured') console.error(`FrogType: online features disabled. ${config.reason}.`);

/** Null when not configured: every online feature checks this and degrades to local-only. Only the public anon key belongs here. */
export const supabase: SupabaseClient | null = config.ok
  ? createClient(url!, anonKey!, {
      // PKCE: auth codes (incl. password-recovery links) only work in the browser that requested them.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
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
