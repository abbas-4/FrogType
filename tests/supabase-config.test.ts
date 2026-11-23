// FT-12: unsafe Supabase configuration is refused before a client is ever created.
import { describe, expect, it } from 'vitest';
import { checkSupabaseConfig } from '../src/services/supabase';

const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;

describe('checkSupabaseConfig', () => {
  it('accepts https project URLs and loopback http for local development', () => {
    expect(checkSupabaseConfig('https://abc.supabase.co', jwt('anon'))).toEqual({ ok: true });
    expect(checkSupabaseConfig('http://127.0.0.1:54321', jwt('anon'))).toEqual({ ok: true });
    expect(checkSupabaseConfig('http://localhost:54321', 'sb_publishable_abc')).toEqual({ ok: true });
  });
  it('refuses plain http to anything else', () => {
    expect(checkSupabaseConfig('http://abc.supabase.co', jwt('anon')).ok).toBe(false);
    expect(checkSupabaseConfig('http://192.168.1.5:54321', jwt('anon')).ok).toBe(false);
    expect(checkSupabaseConfig('http://localhost.evil.com', jwt('anon')).ok).toBe(false);
  });
  it('refuses other schemes, credentials in the URL and garbage', () => {
    for (const u of ['javascript:alert(1)', 'ftp://abc.supabase.co', 'https://user:pass@abc.supabase.co', 'not a url']) expect(checkSupabaseConfig(u, jwt('anon')).ok).toBe(false);
  });
  it('refuses service-role and secret keys', () => {
    expect(checkSupabaseConfig('https://abc.supabase.co', jwt('service_role'))).toMatchObject({ ok: false, reason: expect.stringMatching(/service-role/) });
    expect(checkSupabaseConfig('https://abc.supabase.co', 'sb_secret_abcdef')).toMatchObject({ ok: false, reason: expect.stringMatching(/secret/) });
  });
  it('treats missing values as not configured', () => {
    expect(checkSupabaseConfig(undefined, undefined)).toEqual({ ok: false, reason: 'not configured' });
  });
});
