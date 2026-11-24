import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Lightbulb } from 'lucide-react';
import { Card, PageTitle } from '../components/ui';
import { analyze } from '../domain/analysis';
import { categories, lessons } from '../domain/lessons';
import { useProgress } from '../state/store';

export default function LessonsPage() {
  const progress = useProgress();
  const analysis = useMemo(() => analyze(progress.history), [progress.history]);
  const done = lessons.filter((l) => progress.lessons[l.id]?.completed).length;

  return (
    <div>
      <PageTitle sub={`${done} of ${lessons.length} lessons passed`}>Lessons</PageTitle>
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={lessons.length} aria-label="Lessons passed">
        <div className="h-full bg-brand" style={{ width: `${(done / lessons.length) * 100}%` }} />
      </div>

      <Card className="mb-8">
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
      </Card>

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
                        className={`flex h-full flex-col rounded-xl p-4 transition-colors ${
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
