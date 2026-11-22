import type { Progress, Settings, TestResult } from '../types';

export const SETTINGS_KEY = 'frogtype:settings';
export const PROGRESS_KEY = 'frogtype:progress';

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
  publicProfile: true,
  showOnLeaderboard: true,
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
    publicProfile: bool(r.publicProfile, d.publicProfile),
    showOnLeaderboard: bool(r.showOnLeaderboard, d.showOnLeaderboard),
  };
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export function isTestResult(v: unknown): v is TestResult {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.createdAt === 'string' &&
    !Number.isNaN(Date.parse(t.createdAt)) &&
    typeof t.mode === 'string' &&
    isNum(t.mode2) &&
    isNum(t.wpm) &&
    isNum(t.raw) &&
    isNum(t.accuracy) &&
    isNum(t.durationMs) &&
    typeof t.chars === 'object' &&
    t.chars !== null &&
    Array.isArray(t.samples) &&
    typeof t.charStats === 'object' &&
    typeof t.valid === 'boolean'
  );
}

export function sanitizeProgress(raw: unknown): Progress {
  const base = emptyProgress();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, never>) : {});
  return {
    version: 1,
    history: Array.isArray(r.history) ? r.history.filter(isTestResult).map((t) => ({ ...t, bigramErrors: obj(t.bigramErrors) })) : [],
    xp: Array.isArray(r.xp)
      ? r.xp.filter((x): x is Progress['xp'][number] => !!x && typeof x.key === 'string' && isNum(x.amount) && typeof x.reason === 'string')
      : [],
    achievements: obj(r.achievements),
    lessons: obj(r.lessons),
    daily: obj(r.daily),
    customTexts: Array.isArray(r.customTexts)
      ? r.customTexts.filter((c) => c && typeof c.id === 'string' && typeof c.text === 'string' && typeof c.title === 'string')
      : [],
    pendingSync: Array.isArray(r.pendingSync) ? r.pendingSync.filter((x): x is string => typeof x === 'string') : [],
  };
}

function read(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export const loadSettings = () => sanitizeSettings(read(SETTINGS_KEY));
export const loadProgress = () => sanitizeProgress(read(PROGRESS_KEY));

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode); settings stay in memory */
  }
}

/** On quota errors, drop per-second samples from the oldest half of history and retry once instead of losing the save. */
export function saveProgress(p: Progress): Progress {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    return p;
  } catch {
    const half = Math.floor(p.history.length / 2);
    const slim: Progress = {
      ...p,
      history: p.history.map((t, i) => (i < half ? { ...t, samples: [] } : t)),
    };
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(slim));
    } catch {
      /* still failing: keep in memory for this session */
    }
    return slim;
  }
}
