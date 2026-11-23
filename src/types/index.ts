export type TestMode = 'time' | 'words' | 'custom' | 'lesson' | 'daily';
export type Language = 'english' | 'spanish' | 'german';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type CaretStyle = 'line' | 'block' | 'underline' | 'off';
export type SoundMode = 'off' | 'click' | 'soft';
export type ThemeName = 'frog' | 'swamp' | 'lily';
export type FontFamily = 'mono' | 'sans' | 'serif';
export type ReducedMotion = 'system' | 'on' | 'off';

export interface Settings {
  theme: ThemeName;
  fontFamily: FontFamily;
  fontSize: number; // rem
  caretStyle: CaretStyle;
  sound: SoundMode;
  defaultMode: 'time' | 'words';
  timeDuration: number; // seconds
  wordCount: number;
  punctuation: boolean;
  numbers: boolean;
  difficulty: Difficulty;
  language: Language;
  reducedMotion: ReducedMotion;
  showLiveWpm: boolean;
}

/** One second of a test. */
export interface Sample {
  t: number; // second index, 1-based
  wpm: number;
  raw: number;
  errors: number;
}

export interface CharCounts {
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
}

/** expected char -> [attempts, errors] */
export type CharStats = Record<string, [number, number]>;

export interface TestResult {
  id: string;
  createdAt: string; // ISO
  mode: TestMode;
  /** seconds for time mode, word count otherwise */
  mode2: number;
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  chars: CharCounts;
  durationMs: number;
  wordsTyped: number;
  language: Language;
  punctuation: boolean;
  numbers: boolean;
  difficulty: Difficulty;
  samples: Sample[];
  charStats: CharStats;
  bigramErrors: Record<string, number>;
  valid: boolean;
  invalidReason?: string;
  lessonId?: string;
  dailyDate?: string;
  /** server-issued challenge this test was typed against (ranked attempts only) */
  challengeId?: string;
  /** keystroke log for server replay: k = one char per event (\b backspace, \x17 delete word), t = ms since first key. Dropped after upload. */
  keylog?: { k: string; t: number[] };
  /** set after upload: true when the server replayed and verified the result */
  verified?: boolean;
}

export interface XpTransaction {
  /** dedupe key, e.g. "test:<id>", "lesson:<id>", "daily:<date>" */
  key: string;
  amount: number;
  reason: string;
  at: string;
}

export interface LessonProgress {
  attempts: number;
  bestWpm: number;
  bestAccuracy: number;
  completed: boolean;
  firstWpm: number;
  lastAt: string;
}

export interface DailyRecord {
  date: string;
  bestWpm: number;
  bestAccuracy: number;
  completed: boolean;
}

export interface Progress {
  version: 1;
  history: TestResult[];
  xp: XpTransaction[];
  achievements: Record<string, string>; // id -> unlockedAt ISO
  lessons: Record<string, LessonProgress>;
  daily: Record<string, DailyRecord>;
  customTexts: { id: string; title: string; text: string }[];
  /** ids of tests not yet uploaded to the cloud */
  pendingSync: string[];
}
