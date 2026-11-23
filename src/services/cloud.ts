import type { SupabaseClient } from '@supabase/supabase-js';
import type { Progress, TestResult } from '../types';
import { sanitizeTest } from '../persistence/storage';
import { requireClient } from './supabase';

/** Fields sent to the server. The server re-validates every one (see supabase/migrations). */
export function toPayload(t: TestResult) {
  return {
    id: t.id,
    created_at: t.createdAt,
    mode: t.mode,
    mode2: t.mode2,
    wpm: t.wpm,
    raw: t.raw,
    accuracy: t.accuracy,
    consistency: t.consistency,
    chars: t.chars,
    duration_ms: t.durationMs,
    words_typed: t.wordsTyped,
    language: t.language,
    punctuation: t.punctuation,
    numbers: t.numbers,
    difficulty: t.difficulty,
    samples: t.samples,
    char_stats: t.charStats,
    bigram_errors: t.bigramErrors,
    lesson_id: t.lessonId ?? null,
    daily_date: t.dailyDate ?? null,
    // ranked attempts: the server replays this keylog against its own passage and recomputes every metric
    ...(t.challengeId && t.keylog ? { challenge_id: t.challengeId, keylog: t.keylog } : {}),
  };
}

type Row = Omit<ReturnType<typeof toPayload>, 'keylog' | 'challenge_id'> & { verified?: boolean };

export function fromRow(r: Row): TestResult | null {
  const t: TestResult = {
    id: r.id,
    createdAt: r.created_at,
    mode: r.mode,
    mode2: Number(r.mode2),
    wpm: Number(r.wpm),
    raw: Number(r.raw),
    accuracy: Number(r.accuracy),
    consistency: Number(r.consistency),
    chars: r.chars,
    durationMs: r.duration_ms,
    wordsTyped: r.words_typed,
    language: r.language,
    punctuation: r.punctuation,
    numbers: r.numbers,
    difficulty: r.difficulty,
    samples: r.samples ?? [],
    charStats: r.char_stats ?? {},
    bigramErrors: r.bigram_errors ?? {},
    valid: true,
    lessonId: r.lesson_id ?? undefined,
    dailyDate: r.daily_date ?? undefined,
    verified: Boolean(r.verified),
  };
  return sanitizeTest(t);
}

export interface SubmitOutcome {
  accepted: boolean;
  duplicate: boolean;
  ranked: boolean;
  verified: boolean;
  flags: string[];
}

/** Submits one live test through the validating, rate-limited RPC. */
export async function submitTest(t: TestResult, client: SupabaseClient = requireClient()): Promise<SubmitOutcome> {
  const { data, error } = await client.rpc('submit_test', { payload: toPayload(t) });
  if (error) throw error;
  const d = (data ?? {}) as Partial<SubmitOutcome>;
  return { accepted: Boolean(d.accepted), duplicate: Boolean(d.duplicate), ranked: Boolean(d.ranked), verified: Boolean(d.verified), flags: d.flags ?? [] };
}

export interface Challenge {
  id: string;
  words: string[];
  expiresAt: string;
}

/** FT-01: asks the server for a single-use passage. Only standard English boards can be ranked. */
export async function issueChallenge(mode: 'time' | 'words', mode2: number): Promise<Challenge> {
  const { data, error } = await requireClient().rpc('issue_challenge', { p_mode: mode, p_mode2: mode2 });
  if (error) throw error;
  const d = data as { id: string; words: string[]; expires_at: string };
  return { id: d.id, words: d.words, expiresAt: d.expires_at };
}

/** Bulk import of pre-account local history. Imported tests are stored but never ranked. Idempotent by id. */
export async function importTests(tests: TestResult[], client: SupabaseClient = requireClient()): Promise<number> {
  let imported = 0;
  for (let i = 0; i < tests.length; i += 200) {
    const chunk = tests.slice(i, i + 200).map((t) => toPayload({ ...t, challengeId: undefined, keylog: undefined }));
    const { data, error } = await client.rpc('import_tests', { payloads: chunk });
    if (error) throw error;
    imported += Number(data ?? 0);
  }
  return imported;
}

/** FT-02: asks the server to (re)derive XP and achievements from its own records. No client claims are sent. */
export async function syncProgress(client: SupabaseClient = requireClient()): Promise<void> {
  const { error } = await client.rpc('sync_progress');
  if (error) throw error;
}

export interface CloudSnapshot {
  tests: TestResult[];
  xp: Progress['xp'];
  achievements: Progress['achievements'];
  lessons: Progress['lessons'];
  daily: Progress['daily'];
}

export async function pullCloud(userId: string, c: SupabaseClient = requireClient()): Promise<CloudSnapshot> {
  const [tests, xp, ach, les, daily] = await Promise.all([
    c.from('typing_tests').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1000),
    c.from('xp_transactions').select('key, amount, reason, created_at').eq('user_id', userId).limit(5000),
    c.from('user_achievements').select('achievement_id, unlocked_at').eq('user_id', userId),
    c.from('lesson_progress').select('*').eq('user_id', userId),
    c.from('challenge_submissions').select('challenge_date, best_wpm, best_accuracy, completed').eq('user_id', userId),
  ]);
  for (const r of [tests, xp, ach, les, daily]) if (r.error) throw r.error;
  return {
    tests: (tests.data as Row[]).map(fromRow).filter((t): t is TestResult => t !== null).reverse(),
    xp: (xp.data ?? []).map((x) => ({ key: x.key, amount: x.amount, reason: x.reason, at: x.created_at })),
    achievements: Object.fromEntries((ach.data ?? []).map((a) => [a.achievement_id, a.unlocked_at])),
    lessons: Object.fromEntries(
      (les.data ?? []).map((l) => [
        l.lesson_id,
        { attempts: l.attempts, bestWpm: Number(l.best_wpm), bestAccuracy: Number(l.best_accuracy), completed: l.completed, firstWpm: Number(l.first_wpm), lastAt: l.updated_at },
      ]),
    ),
    daily: Object.fromEntries(
      (daily.data ?? []).map((d) => [d.challenge_date, { date: d.challenge_date, bestWpm: Number(d.best_wpm), bestAccuracy: Number(d.best_accuracy), completed: d.completed }]),
    ),
  };
}

/** Union merge: local and cloud items are combined; numeric bests take the max. Nothing is dropped from either side. */
export function mergeSnapshot(local: Progress, cloud: CloudSnapshot): Progress {
  const ids = new Set(local.history.map((t) => t.id));
  const history = [...local.history, ...cloud.tests.filter((t) => !ids.has(t.id))].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-1000);
  const keys = new Set(local.xp.map((x) => x.key));
  const xp = [...local.xp, ...cloud.xp.filter((x) => !keys.has(x.key))];
  const lessons = { ...cloud.lessons };
  for (const [id, l] of Object.entries(local.lessons)) {
    const c = lessons[id];
    lessons[id] = c
      ? { attempts: Math.max(c.attempts, l.attempts), bestWpm: Math.max(c.bestWpm, l.bestWpm), bestAccuracy: Math.max(c.bestAccuracy, l.bestAccuracy), completed: c.completed || l.completed, firstWpm: c.firstWpm || l.firstWpm, lastAt: c.lastAt > l.lastAt ? c.lastAt : l.lastAt }
      : l;
  }
  const daily = { ...cloud.daily };
  for (const [d, r] of Object.entries(local.daily)) {
    const c = daily[d];
    daily[d] = c ? { date: d, bestWpm: Math.max(c.bestWpm, r.bestWpm), bestAccuracy: Math.max(c.bestAccuracy, r.bestAccuracy), completed: c.completed || r.completed } : r;
  }
  return { ...local, history, xp, achievements: { ...cloud.achievements, ...local.achievements }, lessons, daily };
}

/** FT-10: everything the account holds, read through the user's own RLS-scoped access (no privileged keys). */
export async function exportMyData(userId: string): Promise<Record<string, unknown>> {
  const c = requireClient();
  const page = async (table: string) => {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await c.from(table).select('*').eq('user_id', userId).range(from, from + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) return rows;
    }
  };
  const [profile, friends] = await Promise.all([c.from('profiles').select('*').eq('id', userId).maybeSingle(), c.rpc('list_friends')]);
  if (profile.error) throw profile.error;
  if (friends.error) throw friends.error;
  return {
    exported_at: new Date().toISOString(),
    format: 'frogtype-export-v1',
    profile: profile.data,
    typing_tests: await page('typing_tests'),
    xp_transactions: await page('xp_transactions'),
    user_achievements: await page('user_achievements'),
    lesson_progress: await page('lesson_progress'),
    challenge_submissions: await page('challenge_submissions'),
    leaderboard_entries: await page('leaderboard_entries'),
    friends: friends.data,
  };
}
