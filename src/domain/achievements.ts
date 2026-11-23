import type { Progress } from '../types';
import { lessons } from './lessons';

export interface AchievementContext {
  progress: Progress;
  currentStreak: number;
  longestStreak: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: 'doc-check' | 'docs-10' | 'trophy-100' | 'speed-50' | 'speed-75' | 'speed-100' | 'target-check' | 'flame-7' | 'calendar-30' | 'crown' | 'calendar-check' | 'book' | 'diploma';
  check: (c: AchievementContext) => boolean;
}

const valid = (p: Progress) => p.history.filter((t) => t.valid);
const wpmClub = (n: number) => (c: AchievementContext) => valid(c.progress).some((t) => t.wpm >= n && t.durationMs >= 10000);
const dailyDone = (p: Progress) => Object.values(p.daily).filter((d) => d.completed).length;

export const achievements: Achievement[] = [
  { id: 'first-test', title: 'First Test Completed', description: 'Finish your first valid test.', icon: 'doc-check', check: (c) => valid(c.progress).length >= 1 },
  { id: 'tests-10', title: '10 Tests Completed', description: 'Finish 10 valid tests.', icon: 'docs-10', check: (c) => valid(c.progress).length >= 10 },
  { id: 'tests-100', title: '100 Tests Completed', description: 'Finish 100 valid tests.', icon: 'trophy-100', check: (c) => valid(c.progress).length >= 100 },
  { id: 'wpm-50', title: '50 WPM Club', description: 'Reach 50 WPM in a test of 10s or longer.', icon: 'speed-50', check: wpmClub(50) },
  { id: 'wpm-75', title: '75 WPM Club', description: 'Reach 75 WPM in a test of 10s or longer.', icon: 'speed-75', check: wpmClub(75) },
  { id: 'wpm-100', title: '100 WPM Club', description: 'Reach 100 WPM in a test of 10s or longer.', icon: 'speed-100', check: wpmClub(100) },
  { id: 'perfect', title: 'Perfect Accuracy', description: '100% accuracy on a test with at least 50 correct characters.', icon: 'target-check', check: (c) => valid(c.progress).some((t) => t.accuracy === 100 && t.chars.correct >= 50) },
  { id: 'streak-7', title: '7-Day Streak', description: 'Practice 7 days in a row.', icon: 'flame-7', check: (c) => c.longestStreak >= 7 },
  { id: 'streak-30', title: '30-Day Streak', description: 'Practice 30 days in a row.', icon: 'calendar-30', check: (c) => c.longestStreak >= 30 },
  { id: 'daily-champion', title: 'Daily Challenge Champion', description: 'Beat a daily challenge target.', icon: 'crown', check: (c) => dailyDone(c.progress) >= 1 },
  { id: 'daily-7', title: 'Daily Regular', description: 'Beat 7 daily challenges.', icon: 'calendar-check', check: (c) => dailyDone(c.progress) >= 7 },
  { id: 'first-lesson', title: 'Student', description: 'Pass your first lesson.', icon: 'book', check: (c) => Object.values(c.progress.lessons).some((l) => l.completed) },
  { id: 'all-lessons', title: 'Graduate', description: 'Pass every lesson.', icon: 'diploma', check: (c) => lessons.every((l) => c.progress.lessons[l.id]?.completed) },
];

export function newlyUnlocked(c: AchievementContext): Achievement[] {
  return achievements.filter((a) => !c.progress.achievements[a.id] && a.check(c));
}
