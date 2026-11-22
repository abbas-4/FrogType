import type { TestResult } from '../types';

export function modeLabel(r: Pick<TestResult, 'mode' | 'mode2' | 'lessonId' | 'dailyDate'>): string {
  switch (r.mode) {
    case 'time':
      return `time ${r.mode2}s`;
    case 'words':
      return `words ${r.mode2}`;
    case 'custom':
      return `custom ${r.mode2} words`;
    case 'lesson':
      return `lesson ${r.lessonId ?? ''}`;
    case 'daily':
      return `daily ${r.dailyDate ?? ''}`;
  }
}
