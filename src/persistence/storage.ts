import type { DailyRecord, LessonProgress, Progress, Sample, Settings, TestResult, XpTransaction } from '../types';

export const SETTINGS_KEY = 'frogtype:settings';
/** Guest (signed-out) progress. Signed-in users each get their own key, see progressKey(). */
export const PROGRESS_KEY = 'frogtype:progress';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FT-03: one storage namespace per account so a shared browser never mixes users' progress or upload queues. */
export function progressKey(owner: string | null): string {
  if (owner === null) return PROGRESS_KEY;
  if (!UUID_RE.test(owner)) throw new Error('invalid account id');
  return `${PROGRESS_KEY}:u:${owner.toLowerCase()}`;
}

export const defaultSettings: Settings = {
  theme: 'frog',
  fontFamily: 'mono',
  fontSize: 1.75,
  caretStyle: 'line',
  sound: 'off',
  defaultMode: 'time',
  timeDuration: 30,
  wordCount: 25,
  punctuation: false,
  numbers: false,
  difficulty: 'normal',
  language: 'english',
  reducedMotion: 'system',
  showLiveWpm: true,
};

export const emptyProgress = (): Progress => ({
  version: 1,
  history: [],
  xp: [],
  achievements: {},
  lessons: {},
  daily: {},
  customTexts: [],
  pendingSync: [],
});

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;

/** Every field is checked; unknown or tampered values fall back to defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = defaultSettings;
  return {
    theme: oneOf(r.theme, ['frog', 'swamp', 'lily'], d.theme),
    fontFamily: oneOf(r.fontFamily, ['mono', 'sans', 'serif'], d.fontFamily),
    fontSize: num(r.fontSize, 1, 3.5, d.fontSize),
    caretStyle: oneOf(r.caretStyle, ['line', 'block', 'underline', 'off'], d.caretStyle),
    sound: oneOf(r.sound, ['off', 'click', 'soft'], d.sound),
    defaultMode: oneOf(r.defaultMode, ['time', 'words'], d.defaultMode),
    timeDuration: num(r.timeDuration, 5, 600, d.timeDuration),
    wordCount: num(r.wordCount, 5, 500, d.wordCount),
    punctuation: bool(r.punctuation, d.punctuation),
    numbers: bool(r.numbers, d.numbers),
    difficulty: oneOf(r.difficulty, ['easy', 'normal', 'hard'], d.difficulty),
    language: oneOf(r.language, ['english', 'spanish', 'german'], d.language),
    reducedMotion: oneOf(r.reducedMotion, ['system', 'on', 'off'], d.reducedMotion),
    showLiveWpm: bool(r.showLiveWpm, d.showLiveWpm),
  };
}

// ---------------------------------------------------------------- FT-11: bounded, nested validation
const isNum = (v: unknown, min = -Infinity, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isDate = (v: unknown) => str(v, 40) && !Number.isNaN(Date.parse(v));
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Rebuilds an object from at most `max` safe entries whose value passes `ok`; anything else is dropped. */
function record<T>(v: unknown, max: number, ok: (key: string, value: unknown) => T | null): Record<string, T> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: [string, T][] = [];
  for (const [k, val] of Object.entries(v)) {
    if (out.length >= max) break;
    if (UNSAFE_KEYS.has(k) || k.length > 64) continue;
    const clean = ok(k, val);
    if (clean !== null) out.push([k, clean]);
  }
  return Object.fromEntries(out);
}

const MODES = ['time', 'words', 'custom', 'lesson', 'daily'] as const;

function sanitizeSample(v: unknown): Sample | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  return isNum(s.t, 0, 4000) && isNum(s.wpm, 0, 1000) && isNum(s.raw, 0, 2000) && isNum(s.errors, 0, 10000) ? { t: s.t, wpm: s.wpm, raw: s.raw, errors: s.errors } : null;
}

/** Returns a cleaned copy of a stored/cloud test, or null when its core fields are missing or out of range. */
export function sanitizeTest(v: unknown): TestResult | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const t = v as Record<string, unknown>;
  const c = (t.chars && typeof t.chars === 'object' ? t.chars : null) as Record<string, unknown> | null;
  if (
    !str(t.id, 64) || !t.id ||
    !isDate(t.createdAt) ||
    !MODES.includes(t.mode as TestResult['mode']) ||
    !isNum(t.mode2, 1, 2000) ||
    !isNum(t.wpm, 0, 400) ||
    !isNum(t.raw, 0, 500) ||
    !isNum(t.accuracy, 0, 100) ||
    !isNum(t.durationMs, 0, 3_600_000) ||
    !c || !isNum(c.correct, 0, 1e6) || !isNum(c.incorrect, 0, 1e6) || !isNum(c.extra, 0, 1e6) || !isNum(c.missed, 0, 1e6) ||
    !Array.isArray(t.samples) ||
    typeof t.valid !== 'boolean'
  ) return null;
  const out: TestResult = {
    id: t.id,
    createdAt: t.createdAt as string,
    mode: t.mode as TestResult['mode'],
    mode2: t.mode2,
    wpm: t.wpm,
    raw: t.raw,
    accuracy: t.accuracy,
    consistency: isNum(t.consistency, 0, 100) ? t.consistency : 0,
    chars: { correct: c.correct as number, incorrect: c.incorrect as number, extra: c.extra as number, missed: c.missed as number },
    durationMs: t.durationMs,
    wordsTyped: isNum(t.wordsTyped, 0, 1e6) ? t.wordsTyped : 0,
    language: oneOf(t.language, ['english', 'spanish', 'german'], 'english'),
    punctuation: bool(t.punctuation, false),
    numbers: bool(t.numbers, false),
    difficulty: oneOf(t.difficulty, ['easy', 'normal', 'hard'], 'normal'),
    samples: t.samples.slice(0, 3700).map(sanitizeSample).filter((s): s is Sample => s !== null),
    charStats: record(t.charStats, 300, (_k, x) =>
      Array.isArray(x) && x.length === 2 && isNum(x[0], 0, 1e6) && isNum(x[1], 0, 1e6) ? ([x[0], x[1]] as [number, number]) : null,
    ),
    bigramErrors: record(t.bigramErrors, 1000, (_k, x) => (isNum(x, 0, 1e6) ? x : null)),
    valid: t.valid,
  };
  if (str(t.invalidReason, 120)) out.invalidReason = t.invalidReason;
  if (str(t.lessonId, 40) && t.lessonId) out.lessonId = t.lessonId;
  if (str(t.dailyDate, 10) && /^\d{4}-\d{2}-\d{2}$/.test(t.dailyDate)) out.dailyDate = t.dailyDate;
  if (str(t.challengeId, 36) && UUID_RE.test(t.challengeId)) out.challengeId = t.challengeId;
  const kl = t.keylog as { k?: unknown; t?: unknown } | undefined;
  if (kl && str(kl.k, 8000) && Array.isArray(kl.t) && kl.t.length === kl.k.length && kl.t.every((x) => isNum(x, 0, 3_600_000))) {
    out.keylog = { k: kl.k, t: kl.t as number[] };
  }
  if (typeof t.verified === 'boolean') out.verified = t.verified;
  return out;
}

export const isTestResult = (v: unknown): v is TestResult => sanitizeTest(v) !== null;

const HISTORY_MAX = 1000;

function sanitizeXp(v: unknown): XpTransaction | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  return str(x.key, 80) && x.key && isNum(x.amount, 0, 1000) && str(x.reason, 120) ? { key: x.key, amount: x.amount, reason: x.reason, at: str(x.at, 40) ? x.at : '' } : null;
}

function sanitizeLesson(_k: string, v: unknown): LessonProgress | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Record<string, unknown>;
  if (!isNum(l.attempts, 0, 1e6) || !isNum(l.bestWpm, 0, 400) || !isNum(l.bestAccuracy, 0, 100) || typeof l.completed !== 'boolean') return null;
  return { attempts: l.attempts, bestWpm: l.bestWpm, bestAccuracy: l.bestAccuracy, completed: l.completed, firstWpm: isNum(l.firstWpm, 0, 400) ? l.firstWpm : 0, lastAt: str(l.lastAt, 40) ? l.lastAt : '' };
}

function sanitizeDaily(k: string, v: unknown): DailyRecord | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  return isNum(d.bestWpm, 0, 400) && isNum(d.bestAccuracy, 0, 100) && typeof d.completed === 'boolean' ? { date: k, bestWpm: d.bestWpm, bestAccuracy: d.bestAccuracy, completed: d.completed } : null;
}

export function sanitizeProgress(raw: unknown): Progress {
  const base = emptyProgress();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;
  const history = Array.isArray(r.history)
    ? r.history.slice(-HISTORY_MAX * 2).map(sanitizeTest).filter((t): t is TestResult => t !== null).slice(-HISTORY_MAX)
    : [];
  const ids = new Set(history.map((t) => t.id));
  return {
    version: 1,
    history,
    xp: Array.isArray(r.xp) ? r.xp.slice(-20000).map(sanitizeXp).filter((x): x is XpTransaction => x !== null) : [],
    achievements: record(r.achievements, 100, (_k, v) => (str(v, 40) ? v : null)),
    lessons: record(r.lessons, 200, sanitizeLesson),
    daily: record(r.daily, 4000, sanitizeDaily),
    customTexts: Array.isArray(r.customTexts)
      ? r.customTexts
          .filter((c): c is { id: string; title: string; text: string } => !!c && str(c.id, 64) && str(c.title, 60) && str(c.text, 20000))
          .map((c) => ({ id: c.id, title: c.title, text: c.text }))
          .slice(-30)
      : [],
    // only ids of tests that still exist locally can be queued
    pendingSync: Array.isArray(r.pendingSync) ? [...new Set(r.pendingSync.filter((x): x is string => typeof x === 'string' && ids.has(x)))] : [],
  };
}

function read(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    if (!s || s.length > 8_000_000) return null; // corrupted/oversized storage: don't parse megabytes of junk
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const loadSettings = () => sanitizeSettings(read(SETTINGS_KEY));
export const loadProgress = (owner: string | null = null) => sanitizeProgress(read(progressKey(owner)));

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode); settings stay in memory */
  }
}

/** On quota errors, drop per-second samples from the oldest half of history and retry once instead of losing the save. */
export function saveProgress(p: Progress, owner: string | null = null): Progress {
  const key = progressKey(owner);
  try {
    localStorage.setItem(key, JSON.stringify(p));
    return p;
  } catch {
    const half = Math.floor(p.history.length / 2);
    const slim: Progress = {
      ...p,
      history: p.history.map((t, i) => (i < half ? { ...t, samples: [] } : t)),
    };
    try {
      localStorage.setItem(key, JSON.stringify(slim));
    } catch {
      /* still failing: keep in memory for this session */
    }
    return slim;
  }
}

/** Removes an account's local copy (used on "sign out and forget this browser" and account deletion). */
export function removeProgress(owner: string): void {
  try {
    localStorage.removeItem(progressKey(owner));
  } catch {
    /* ignore */
  }
}
