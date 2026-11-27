import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TypingTest } from '../components/TypingTest';
import { PlayerHeader } from '../components/ui';
import { analyze, weakKeyDrill } from '../domain/analysis';
import { getWordList } from '../data/wordlists';
import { saveResult } from '../services/results';
import { useProgress, useSettings } from '../state/store';
import type { TestResult } from '../types';

export default function WeakKeyDrillPage() {
  const progress = useProgress();
  const settings = useSettings();
  const analysis = useMemo(() => analyze(progress.history), [progress.history]);
  // joined so the drill is only rebuilt when the weak keys themselves change (keys are single characters)
  const weakKeys = analysis.enoughData ? analysis.weakKeys.map((k) => k.char).join('') : '';
  const weak = [...weakKeys];
  const words = useMemo(() => (weakKeys ? weakKeyDrill([...weakKeys], getWordList(settings.language, 'normal')) : []), [weakKeys, settings.language]);
  const meta = useMemo(() => ({ mode: 'custom' as const, mode2: words.length }), [words.length]);
  const onComplete = useCallback((r: TestResult) => saveResult(r), []);

  return (
    <div>
      <Link to="/lessons" className="mb-6 inline-flex items-center gap-1 text-sm text-sub hover:text-text">
        <ArrowLeft size={16} /> All lessons
      </Link>
      {words.length === 0 ? (
        <PlayerHeader title="Weak-key drill">No weak keys to drill yet. Take a few more tests and check back.</PlayerHeader>
      ) : (
        <>
          <PlayerHeader title="Weak-key drill">
            Built from your last {analysis.testsAnalyzed} tests. Highest-error keys:{' '}
            {weak.map((k) => (
              <kbd key={k} className="mx-0.5 rounded bg-surface-2 px-1.5 text-text">
                {k}
              </kbd>
            ))}
          </PlayerHeader>
          <TypingTest source={{ kind: 'fixed', words, editable: true }} sourceKey="drill" meta={meta} onComplete={onComplete} />
        </>
      )}
    </div>
  );
}
