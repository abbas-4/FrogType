import type { Progress, TestResult, XpTransaction } from '../types';
import { newlyUnlocked, type Achievement } from './achievements';
import { meetsTarget, type DailyChallenge } from './daily';
import { localDay } from './dates';
import type { Lesson } from './lessons';
import { addXp, levelFromXp, totalXp, XP, xpForTest } from './progression';
import { calcStreaks } from './streaks';

export const HISTORY_LIMIT = 1000;

export interface RecordContext {
  now: Date;
  lesson?: Lesson;
  daily?: DailyChallenge;
}

export interface RecordOutcome {
  progress: Progress;
  xpAdded: XpTransaction[];
  unlocked: Achievement[];
  personalBest: boolean;
  lessonPassed: boolean;
  dailyCompleted: boolean;
  levelBefore: number;
  levelAfter: number;
}

export function bestFor(history: TestResult[], mode: TestResult['mode'], mode2: number): number {
  return history.filter((t) => t.valid && t.mode === mode && t.mode2 === mode2).reduce((m, t) => Math.max(m, t.wpm), 0);
}

export function activityDays(history: TestResult[]): string[] {
  return history.filter((t) => t.valid).map((t) => localDay(t.createdAt));
}

/** Pure: applies one finished test to progress. Invalid tests change nothing. All XP is keyed, so replays never double-award. */
export function recordResult(progress: Progress, result: TestResult, ctx: RecordContext): RecordOutcome {
  const levelBefore = levelFromXp(totalXp(progress.xp)).level;
  const empty: RecordOutcome = { progress, xpAdded: [], unlocked: [], personalBest: false, lessonPassed: false, dailyCompleted: false, levelBefore, levelAfter: levelBefore };
  if (!result.valid || progress.history.some((t) => t.id === result.id)) return empty;

  const at = ctx.now.toISOString();
  const txs: XpTransaction[] = [{ key: `test:${result.id}`, amount: xpForTest(result), reason: 'Completed test', at }];

  const prevBest = bestFor(progress.history, result.mode, result.mode2);
  const personalBest = (result.mode === 'time' || result.mode === 'words') && prevBest > 0 && result.wpm > prevBest;
  if (personalBest) txs.push({ key: `pr:${result.id}`, amount: XP.personalBest, reason: 'New personal best', at });

  const history = [...progress.history, result].slice(-HISTORY_LIMIT);

  let lessons = progress.lessons;
  let lessonPassed = false;
  if (ctx.lesson) {
    const l = ctx.lesson;
    const prev = lessons[l.id];
    const passed = result.wpm >= l.targetWpm && result.accuracy >= l.targetAccuracy;
    lessonPassed = passed && !prev?.completed;
    lessons = {
      ...lessons,
      [l.id]: {
        attempts: (prev?.attempts ?? 0) + 1,
        bestWpm: Math.max(prev?.bestWpm ?? 0, result.wpm),
        bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, result.accuracy),
        completed: (prev?.completed ?? false) || passed,
        firstWpm: prev?.firstWpm ?? result.wpm,
        lastAt: at,
      },
    };
    if (passed) txs.push({ key: `lesson:${l.id}`, amount: XP.lesson, reason: `Passed lesson: ${l.title}`, at });
  }

  let daily = progress.daily;
  let dailyCompleted = false;
  if (ctx.daily) {
    const d = ctx.daily;
    const prev = daily[d.date];
    const met = meetsTarget(d, result.wpm, result.accuracy);
    dailyCompleted = met && !prev?.completed;
    daily = {
      ...daily,
      [d.date]: {
        date: d.date,
        bestWpm: Math.max(prev?.bestWpm ?? 0, result.wpm),
        bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, result.accuracy),
        completed: (prev?.completed ?? false) || met,
      },
    };
    if (met) txs.push({ key: `daily:${d.date}`, amount: XP.daily, reason: `Daily challenge ${d.date}`, at });
  }

  const today = localDay(ctx.now);
  const streaks = calcStreaks(activityDays(history), today);
  txs.push({
    key: `streak:${today}`,
    amount: XP.streakPerDay * Math.min(streaks.current, XP.streakCap),
    reason: `Daily streak (${streaks.current} day${streaks.current === 1 ? '' : 's'})`,
    at,
  });

  const { ledger, added } = addXp(progress.xp, txs);
  let next: Progress = {
    ...progress,
    history,
    lessons,
    daily,
    xp: ledger,
  };
  const unlocked = newlyUnlocked({ progress: next, currentStreak: streaks.current, longestStreak: streaks.longest });
  if (unlocked.length) {
    next = { ...next, achievements: { ...next.achievements, ...Object.fromEntries(unlocked.map((a) => [a.id, at])) } };
  }
  return {
    progress: next,
    xpAdded: added,
    unlocked,
    personalBest,
    lessonPassed,
    dailyCompleted,
    levelBefore,
    levelAfter: levelFromXp(totalXp(next.xp)).level,
  };
}
