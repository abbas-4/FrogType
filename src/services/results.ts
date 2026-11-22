import type { DailyChallenge } from '../domain/daily';
import type { Lesson } from '../domain/lessons';
import { recordResult, type RecordOutcome } from '../domain/recordResult';
import { authStore } from '../state/auth';
import { progressStore } from '../state/store';
import { pushToast } from '../state/toasts';
import type { TestResult } from '../types';
import { syncNow } from './sync';

/** Records a finished test locally (always), then syncs if signed in. */
export function saveResult(r: TestResult, ctx: { lesson?: Lesson; daily?: DailyChallenge } = {}): RecordOutcome {
  const out = recordResult(progressStore.get(), r, { now: new Date(), ...ctx });
  if (out.progress === progressStore.get()) return out;
  const signedIn = authStore.get().user !== null;
  progressStore.set(signedIn ? { ...out.progress, pendingSync: [...out.progress.pendingSync, r.id] } : out.progress);
  for (const a of out.unlocked) pushToast('Achievement unlocked', a.title);
  if (out.levelAfter > out.levelBefore) pushToast(`Level ${out.levelAfter}`, 'Keep it up.');
  if (signedIn) void syncNow();
  return out;
}
