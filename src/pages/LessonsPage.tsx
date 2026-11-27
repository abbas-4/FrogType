import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, Check, CheckCircle2, Circle, Clock, Crosshair, Flame, Lightbulb, Play, Star, Target, Trophy } from 'lucide-react';
import { Button, Card, PageTitle } from '../components/ui';
import { analyze } from '../domain/analysis';
import { dailyChallenge } from '../domain/daily';
import { utcDay } from '../domain/dates';
import { categories, lessons } from '../domain/lessons';
import { XP } from '../domain/progression';
import { calcStreaks } from '../domain/streaks';
import { useProgress } from '../state/store';
import type { Progress } from '../types';

export default function LessonsPage() {
  const progress = useProgress();
  const navigate = useNavigate();
  const analysis = useMemo(() => analyze(progress.history), [progress.history]);
  const done = lessons.filter((l) => progress.lessons[l.id]?.completed).length;

  return (
    <div>
      <PageTitle sub={`${done} of ${lessons.length} lessons passed`}>Lessons</PageTitle>
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={lessons.length} aria-label="Lessons passed">
        <div className="h-full bg-brand" style={{ width: `${(done / lessons.length) * 100}%` }} />
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <DailyCard daily={progress.daily} history={progress.history} />
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-medium text-text">
            <Lightbulb size={18} className="text-brand" /> Recommended for you
          </h2>
          {!analysis.enoughData ? (
            <p className="mt-2 text-sm text-sub">
              We don't have enough data to personalize yet — {analysis.testsAnalyzed}/3 tests and {analysis.charsAnalyzed}/500 characters analyzed. Start with{' '}
              <Link className="text-brand underline" to="/lessons/beginner-1">Beginner fundamentals</Link> or take a few tests.
            </p>
          ) : analysis.recommendations.length === 0 ? (
            <p className="mt-2 text-sm text-sub">
              Your last {analysis.testsAnalyzed} tests show no clear weak spot (avg {analysis.avgWpm.toFixed(0)} wpm, {analysis.avgAccuracy.toFixed(1)}% accuracy). Try{' '}
              <Link className="text-brand underline" to="/lessons/advanced-1">Advanced practice</Link>.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-sub">
                Based on {analysis.testsAnalyzed} recent tests ({analysis.charsAnalyzed} characters). Avg {analysis.avgWpm.toFixed(0)} wpm at {analysis.avgAccuracy.toFixed(1)}%.
              </p>
              <ul className="mt-3 space-y-2">
                {analysis.recommendations.map(({ lesson, reason }) => (
                  <li key={lesson.id}>
                    <Link to={`/lessons/${lesson.id}`} className="block rounded-lg bg-surface-2/50 px-4 py-3 hover:bg-surface-2">
                      <span className="font-medium text-text">{lesson.title}</span>
                      <span className="block text-sm text-sub">{reason}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {analysis.weakBigrams.length > 0 && (
                <p className="mt-3 text-sm text-sub">
                  Frequent mistakes in combinations:{' '}
                  {analysis.weakBigrams.map((b) => (
                    <kbd key={b.bigram} className="mx-0.5 rounded bg-surface-2 px-1.5 text-text">{b.bigram}</kbd>
                  ))}
                </p>
              )}
            </>
          )}
          {analysis.enoughData && analysis.weakKeys.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="ghost" onClick={() => navigate('/lessons/drill')}>
                <Crosshair size={16} aria-hidden="true" /> Weak-key drill
              </Button>
              <span className="text-sm text-sub">
                highest-error keys:{' '}
                {analysis.weakKeys.map((k) => (
                  <kbd key={k.char} className="mx-0.5 rounded bg-surface-2 px-1.5 text-text">{k.char}</kbd>
                ))}
              </span>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-8">
        {categories.map((cat, i) => (
          <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
            <h2 id={`cat-${cat.id}`} className="text-lg font-medium text-text">
              <span className="mr-2 text-sub tabular-nums">{i + 1}.</span>
              {cat.title}
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {lessons
                .filter((l) => l.category === cat.id)
                .map((l) => {
                  const p = progress.lessons[l.id];
                  return (
                    <li key={l.id}>
                      <Link
                        to={`/lessons/${l.id}`}
                        data-completed={p?.completed || undefined}
                        className={`flex h-full flex-col rounded-lg p-4 transition-colors ${
                          p?.completed ? 'bg-brand/10 ring-1 ring-inset ring-brand/50 hover:bg-brand/15' : 'bg-surface hover:bg-surface-2'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium text-text">{l.title}</span>
                          {p?.completed ? <CheckCircle2 size={18} className="text-brand" aria-label="Passed" /> : <Circle size={18} className="text-sub" aria-label="Not passed" />}
                        </span>
                        <span className="mt-auto pt-3 text-xs text-sub">
                          target {l.targetWpm} wpm · {l.targetAccuracy}%
                          {p && ` · best ${Math.round(p.bestWpm)} wpm${p.attempts > 1 && p.bestWpm > p.firstWpm ? ` (+${Math.round(p.bestWpm - p.firstWpm)})` : ''}`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Ticks every 30s so the countdown and the UTC day roll over without a reload. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Time until the next UTC midnight, when a new daily challenge starts. */
function resetsIn(now: Date): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.max(0, Math.floor((next - now.getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m left` : m > 0 ? `${m}m left` : '<1m left';
}

function DailyCard({ daily, history }: { daily: Progress['daily']; history: Progress['history'] }) {
  const navigate = useNavigate();
  const now = useNow();
  const today = utcDay(now);
  const challenge = useMemo(() => dailyChallenge(today), [today]);
  const record = daily[today];
  const all = Object.values(daily);
  const recent = [...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const attempts = history.filter((t) => t.dailyDate === today).length;
  const streak = calcStreaks(all.filter((d) => d.completed).map((d) => d.date), today).current;
  const best = all.length ? Math.round(Math.max(...all.map((d) => d.bestWpm))) : null;

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-medium text-text">
          <CalendarDays size={18} className="text-brand" /> Daily challenge
          {record?.completed && (
            <span className="inline-flex items-center gap-1 text-sm font-normal text-brand">
              <Check size={16} /> Completed
            </span>
          )}
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs tabular-nums text-sub" title="Time until the next challenge (resets at 00:00 UTC)">
          <Clock size={14} className="text-brand" /> {resetsIn(now)}
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-center py-6">
        <dl className="grid grid-cols-3 divide-x divide-surface-2">
          <div className="flex items-center gap-4 pr-3">
            <div className="hidden size-16 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-brand lg:flex">
              <Target size={32} aria-hidden />
            </div>
            <PrimaryStat label="Target speed" value={challenge.targetWpm} unit="wpm" />
          </div>
          <div className="px-3 lg:px-5">
            <PrimaryStat label="Accuracy" value={challenge.targetAccuracy} unit="%" />
          </div>
          <div className="pl-3 lg:pl-5">
            <PrimaryStat label="Today" value={attempts} unit={attempts === 1 ? 'attempt' : 'attempts'} />
          </div>
        </dl>

        <dl className="mt-6 grid grid-cols-1 gap-3 border-t border-surface-2 pt-6 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
          <SecondaryStat icon={<Flame size={18} />} value={`${streak} day streak`} label={record?.completed ? 'Done for today' : streak > 0 ? 'Keep it going!' : 'Pass one to start'} />
          <SecondaryStat icon={<Trophy size={18} />} value={best === null ? '—' : `${best} wpm`} label={record ? `Personal best · today ${Math.round(record.bestWpm)}` : 'Personal best'} />
          <SecondaryStat icon={<Star size={18} />} value={`+${XP.daily} XP`} label={record?.completed ? 'Earned today' : 'Reward'} />
        </dl>
      </div>

      <div>
        <Button className="w-full py-3 text-base" onClick={() => navigate('/lessons/daily')}>
          <Play size={16} aria-hidden /> {record ? 'Try again' : 'Start challenge'} <ArrowRight size={16} aria-hidden />
        </Button>
        {recent.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-xs uppercase tracking-wider text-sub hover:text-text">Recent challenges</summary>
            <ul className="mt-2 space-y-1">
              {recent.map((d) => (
                <li key={d.date} className="flex justify-between">
                  <span className="text-sub">{d.date}</span>
                  <span className={d.completed ? 'text-brand' : 'text-text'}>
                    {Math.round(d.bestWpm)} wpm · {Math.floor(d.bestAccuracy)}% {d.completed ? '✓' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

function PrimaryStat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="mt-1 truncate text-xs text-sub lg:text-sm">{label}</dt>
      <dd className="whitespace-nowrap text-2xl font-semibold tabular-nums text-text lg:text-3xl">
        {value}
        <span className="ml-1 text-sm font-normal text-sub lg:text-base">{unit}</span>
      </dd>
    </div>
  );
}

function SecondaryStat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-brand" aria-hidden>{icon}</span>
      <div className="flex min-w-0 flex-col-reverse">
        <dt className="text-xs text-sub">{label}</dt>
        <dd className="font-medium tabular-nums text-text">{value}</dd>
      </div>
    </div>
  );
}
