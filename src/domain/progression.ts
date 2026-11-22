import type { TestResult, XpTransaction } from '../types';

/** Cumulative XP needed to reach `level` (level 1 = 0, 2 = 100, 3 = 300, 4 = 600 ...). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function levelFromXp(xp: number): { level: number; into: number; needed: number; progress: number } {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const base = xpForLevel(level);
  const needed = xpForLevel(level + 1) - base;
  const into = xp - base;
  return { level, into, needed, progress: into / needed };
}

export function totalXp(xp: XpTransaction[]): number {
  return xp.reduce((a, t) => a + t.amount, 0);
}

/** About one XP per correct word, scaled by accuracy, plus a small completion bonus. */
export function xpForTest(r: TestResult): number {
  if (!r.valid) return 0;
  const words = (r.chars.correct) / 5;
  const accFactor = Math.max(0, (r.accuracy - 50) / 50);
  return Math.min(300, Math.round(5 + words * accFactor));
}

export const XP = {
  lesson: 50,
  daily: 100,
  personalBest: 25,
  streakPerDay: 10,
  streakCap: 7,
} as const;

/** Appends transactions whose key is not already present. Returns the list of newly added ones. */
export function addXp(ledger: XpTransaction[], txs: XpTransaction[]): { ledger: XpTransaction[]; added: XpTransaction[] } {
  const seen = new Set(ledger.map((t) => t.key));
  const added: XpTransaction[] = [];
  for (const t of txs) {
    if (t.amount <= 0 || seen.has(t.key)) continue;
    seen.add(t.key);
    added.push(t);
  }
  return { ledger: added.length ? [...ledger, ...added] : ledger, added };
}
