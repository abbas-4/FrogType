import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null when not configured: every online feature checks this and degrades to local-only. Only the public anon key belongs here. */
export const supabase: SupabaseClient | null =
  url && anonKey && /^https?:\/\//.test(url) ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

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

/** Turns Supabase/network errors into a short user-facing message. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') return (e as { message: string }).message;
  return 'Something went wrong. Please try again.';
}
