import { addDays } from './dates';

export interface Streaks {
  current: number;
  longest: number;
}

/** days: YYYY-MM-DD values (any order, duplicates ok). Current streak survives until the end of the day after the last activity. */
export function calcStreaks(days: string[], today: string): Streaks {
  const set = new Set(days);
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}
