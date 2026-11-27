import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TypingTest } from '../components/TypingTest';
import { Notice, PlayerHeader } from '../components/ui';
import { dailyChallenge, meetsTarget } from '../domain/daily';
import { utcDay } from '../domain/dates';
import { saveResult } from '../services/results';
import { useProgress } from '../state/store';
import type { TestResult } from '../types';

export default function DailyChallengePage() {
  const today = utcDay(new Date());
  const challenge = useMemo(() => dailyChallenge(today), [today]);
  const record = useProgress().daily[today];
  const meta = useMemo(() => ({ mode: 'daily' as const, mode2: challenge.words.length, dailyDate: today }), [challenge, today]);
  const onComplete = useCallback((r: TestResult) => saveResult(r, { daily: challenge }), [challenge]);

  return (
    <div>
      <Link to="/lessons" className="mb-6 inline-flex items-center gap-1 text-sm text-sub hover:text-text">
        <ArrowLeft size={16} /> All lessons
      </Link>
      <PlayerHeader title="Daily challenge">
        {today} · target {challenge.targetWpm} wpm at {challenge.targetAccuracy}% accuracy
        {record && ` · best ${Math.round(record.bestWpm)} wpm, ${Math.floor(record.bestAccuracy)}%`}
        {record?.completed && <span className="text-brand"> · completed</span>}
      </PlayerHeader>
      <TypingTest
        source={{ kind: 'fixed', words: challenge.words, editable: true }}
        sourceKey={`daily-${today}`}
        meta={meta}
        onComplete={onComplete}
        resultExtra={(r) =>
          meetsTarget(challenge, r.wpm, r.accuracy) && r.valid ? (
            <Notice>Challenge complete! You beat today's target.</Notice>
          ) : (
            <Notice tone="warn">
              Target not met: needed {challenge.targetWpm} wpm and {challenge.targetAccuracy}% accuracy.
            </Notice>
          )
        }
      />
    </div>
  );
}
