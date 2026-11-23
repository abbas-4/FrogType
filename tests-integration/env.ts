// Supabase/test-account helpers with no app imports (shared by integration tests and Playwright).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Local stack only: refuses to run against anything that is not loopback. */
function resolveEnv() {
  let { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service, MAILPIT_URL: mail } = process.env;
  if (!url || !anon || !service) {
    const s = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    url ??= s.API_URL;
    anon ??= s.ANON_KEY;
    service ??= s.SERVICE_ROLE_KEY;
    mail ??= s.MAILPIT_URL ?? s.INBUCKET_URL;
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url!)) throw new Error(`refusing to run integration tests against ${url}`);
  return { url: url!, anon: anon!, service: service!, mail: mail ?? 'http://127.0.0.1:55324' };
}

export const env = resolveEnv();
export const admin = createClient(env.url, env.service, { auth: { persistSession: false, autoRefreshToken: false } });
export const anon = () => createClient(env.url, env.anon, { auth: { persistSession: false, autoRefreshToken: false } });
export const PASSWORD = 'Integr4tion-Pass'; // gitleaks:allow (synthetic password for throwaway local test users)

export interface TestUser {
  id: string;
  email: string;
  username: string;
  c: SupabaseClient;
}

export async function newUser(meta: Record<string, unknown> = {}): Promise<TestUser> {
  const tag = randomBytes(5).toString('hex');
  const email = `int-${tag}@frogtype.test`;
  const username = `i_${tag}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { username, ...meta } });
  if (error) throw error;
  const c = anon();
  const { error: e2 } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return { id: data.user.id, email, username, c };
}

export function psql(sql: string): string {
  const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_frogtype';
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function latestMail(to: string, subjectRe: RegExp, after = 0): Promise<string> {
  for (let tries = 0; tries < 40; tries++) {
    const list = await (await fetch(`${env.mail}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const msg = (list.messages ?? []).find((m: { Subject: string; Created: string }) => subjectRe.test(m.Subject) && Date.parse(m.Created) > after);
    if (msg) return (await (await fetch(`${env.mail}/api/v1/message/${msg.ID}`)).json()).HTML as string;
    await sleep(250);
  }
  throw new Error(`no email matching ${subjectRe} for ${to}`);
}

export const linkIn = (html: string) => html.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)![1]!.replace(/&amp;/g, '&');
