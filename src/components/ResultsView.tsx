import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, ChevronRight, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import type { RecordOutcome } from '../domain/recordResult';
import type { TestResult } from '../types';
import { Stat } from './ui';
import { modeLabel } from '../domain/format';

const WpmChart = lazy(() => import('./WpmChart'));

interface Props {
  result: TestResult;
  outcome?: RecordOutcome | null;
  onRestart?: () => void;
  onNext?: () => void;
  extra?: ReactNode;
}

export default function ResultsView({ result: r, outcome, onRestart, onNext, extra }: Props) {
  const xp = outcome?.xpAdded.reduce((a, t) => a + t.amount, 0) ?? 0;
  return (
    <div className="w-full animate-fade-in" data-testid="results">
      {!r.valid && (
        <p role="alert" className="mb-4 rounded-lg border border-error/40 px-4 py-2 text-sm text-error">
          Invalid test — {r.invalidReason}. It was not saved to your history.
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        <div className="flex gap-8 md:flex-col md:gap-4">
          <Stat big label="wpm" value={<span data-testid="result-wpm">{Math.round(r.wpm)}</span>} hint={`${r.wpm.toFixed(2)} wpm`} />
          <Stat big label="acc" value={<span data-testid="result-acc">{`${Math.floor(r.accuracy)}%`}</span>} hint={`${r.accuracy.toFixed(2)}%`} />
        </div>
        <Suspense fallback={<div className="h-56" />}>
          <WpmChart samples={r.samples} />
        </Suspense>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Item label="test type" value={modeLabel(r)} />
        <Item label="raw" value={Math.round(r.raw)} />
        <Item label="consistency" value={`${Math.round(r.consistency)}%`} />
        <Item label="characters" value={`${r.chars.correct}/${r.chars.incorrect}/${r.chars.extra}/${r.chars.missed}`} hint="correct / incorrect / extra / missed" />
        <Item label="time" value={`${(r.durationMs / 1000).toFixed(1)}s`} />
        <Item label="words" value={r.wordsTyped} />
      </dl>

      {(xp > 0 || outcome?.personalBest || (outcome?.unlocked.length ?? 0) > 0) && (
        <div className="mt-6 flex flex-wrap gap-3 text-sm" aria-live="polite">
          {xp > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-brand">
              <Sparkles size={14} /> +{xp} XP
            </span>
          )}
          {outcome && outcome.levelAfter > outcome.levelBefore && (
            <span className="rounded-full bg-brand/15 px-3 py-1 text-brand">Level {outcome.levelAfter}!</span>
          )}
          {outcome?.personalBest && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-brand">
              <Trophy size={14} /> New personal best
            </span>
          )}
          {outcome?.unlocked.map((a) => (
            <span key={a.id} className="rounded-full bg-surface px-3 py-1 text-text">
              Achievement: {a.title}
            </span>
          ))}
        </div>
      )}

      {extra && <div className="mt-6">{extra}</div>}

      {(onRestart || onNext) && (
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {onNext && (
            <button type="button" onClick={onNext} autoFocus className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-bg hover:bg-brand-hover">
              <ChevronRight size={16} /> Next test
            </button>
          )}
          {onRestart && (
            <button type="button" onClick={onRestart} className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface">
              <RotateCcw size={16} /> Repeat test
            </button>
          )}
          <Link to="/stats" className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface">
            <BarChart3 size={16} /> View statistics
          </Link>
        </div>
      )}
    </div>
  );
}

function Item({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-xs uppercase tracking-wider text-sub">{label}</dt>
      <dd className="text-lg tabular-nums text-text">{value}</dd>
    </div>
  );
}
