import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, ChevronRight, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import type { RecordOutcome } from '../domain/recordResult';
import type { TestResult } from '../types';
import { Stat } from './ui';
import { modeLabel } from '../domain/format';

const WpmChart = lazy(() => import('./WpmChart'));

// p-3 around a 20px icon keeps a 44px tap target without a visible button background.
const action = 'group relative rounded-md p-3 text-sub transition-colors hover:text-brand focus-visible:text-brand';
const kbd = 'rounded bg-sub px-1.5 py-0.5 font-mono text-bg';
const tip =
  'pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-2 py-0.5 text-xs text-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100';

interface Props {
  result: TestResult;
  outcome?: RecordOutcome | null;
  onRestart?: () => void;
  onNext?: () => void;
  extra?: ReactNode;
}

export default function ResultsView({ result: r, outcome, onRestart, onNext, extra }: Props) {
  const xp = outcome?.xpAdded.reduce((a, t) => a + t.amount, 0) ?? 0;
  // Focus lands on the actions group, not a button: stray keys after the last keystroke can't trigger anything,
  // and the next Tab reaches Restart. Its outline is hidden inline because the unlayered global :focus-visible
  // rule outranks Tailwind's outline-none.
  const actions = useRef<HTMLDivElement>(null);
  const hasRestart = !!onRestart;
  useEffect(() => {
    if (hasRestart) actions.current?.focus({ preventScroll: true });
  }, [hasRestart]);
  const details = [r.language, r.punctuation && 'punctuation', r.numbers && 'numbers', r.difficulty !== 'normal' && r.difficulty].filter(Boolean).join(' ');
  return (
    <div className="mx-auto w-full max-w-6xl animate-fade-in" data-testid="results">
      {!r.valid && r.mode !== 'lesson' && (
        <p role="alert" className="mb-4 text-center text-sm text-error">
          Invalid test — {r.invalidReason}. It was not saved to your history.
        </p>
      )}
      <div className="grid items-center gap-6 lg:grid-cols-[auto_1fr] lg:gap-10">
        <div className="flex gap-12 lg:flex-col lg:gap-5">
          <Stat big label="wpm" value={<span data-testid="result-wpm">{Math.round(r.wpm)}</span>} hint={`${r.wpm.toFixed(2)} wpm`} />
          <Stat big label="acc" value={<span data-testid="result-acc">{`${Math.floor(r.accuracy)}%`}</span>} hint={`${r.accuracy.toFixed(2)}%`} />
        </div>
        <Suspense fallback={<div className="h-48 sm:h-56" />}>
          <WpmChart samples={r.samples} />
        </Suspense>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:flex lg:justify-between lg:gap-8">
        {r.mode !== 'lesson' && (
          <Item label="test type" small value={<>{modeLabel(r)}<span className="block">{details}</span></>} />
        )}
        <Item label="raw" value={Math.round(r.raw)} hint={`${r.raw.toFixed(2)} wpm`} />
        <Item label="characters" value={`${r.chars.correct}/${r.chars.incorrect}/${r.chars.extra}/${r.chars.missed}`} hint="correct / incorrect / extra / missed" />
        <Item label="consistency" value={`${Math.round(r.consistency)}%`} hint={`${r.consistency.toFixed(2)}%`} />
        <Item label="time" value={`${(r.durationMs / 1000).toFixed(1)}s`} />
        <Item label="words" value={r.wordsTyped} />
      </dl>

      {(xp > 0 || outcome?.personalBest || (outcome?.unlocked.length ?? 0) > 0) && (
        <p className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-sub" aria-live="polite">
          {xp > 0 && (
            <span className="inline-flex items-center gap-1.5 text-brand">
              <Sparkles size={14} aria-hidden="true" /> +{xp} XP
            </span>
          )}
          {outcome && outcome.levelAfter > outcome.levelBefore && <span className="text-brand">Level {outcome.levelAfter}!</span>}
          {outcome?.personalBest && (
            <span className="inline-flex items-center gap-1.5 text-brand">
              <Trophy size={14} aria-hidden="true" /> New personal best
            </span>
          )}
          {outcome?.unlocked.map((a) => (
            <span key={a.id}>
              Achievement: <span className="text-text">{a.title}</span>
            </span>
          ))}
        </p>
      )}

      {extra && <div className="mt-6">{extra}</div>}

      {(onRestart || onNext) && (
        <div ref={actions} tabIndex={-1} role="group" aria-label="Result actions" className="mt-8 flex justify-center gap-8 sm:gap-16" style={{ outline: 'none' }}>
          {onRestart && (
            <button type="button" onClick={onRestart} aria-label="Restart test" className={action}>
              <RotateCcw size={20} aria-hidden="true" />
              <span className={tip} aria-hidden="true">Restart test</span>
            </button>
          )}
          {onNext && (
            <button type="button" onClick={onNext} aria-label="Next test" className={action}>
              <ChevronRight size={20} aria-hidden="true" />
              <span className={tip} aria-hidden="true">Next test</span>
            </button>
          )}
          <Link to="/stats" aria-label="View statistics" className={action}>
            <BarChart3 size={20} aria-hidden="true" />
            <span className={tip} aria-hidden="true">View statistics</span>
          </Link>
        </div>
      )}
      {onRestart && (
        <p className="mt-6 text-center text-xs text-sub">
          <kbd className={kbd}>Tab</kbd> → <kbd className={kbd}>Enter</kbd> to restart
        </p>
      )}
    </div>
  );
}

function Item({ label, value, hint, small = false }: { label: string; value: ReactNode; hint?: string; small?: boolean }) {
  return (
    <div title={hint}>
      <dt className="text-sm text-sub sm:text-base">{label}</dt>
      <dd className={`tabular-nums text-brand ${small ? 'text-sm leading-snug sm:text-base' : 'text-2xl leading-tight sm:text-3xl'}`}>{value}</dd>
    </div>
  );
}
