import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, Crosshair, FileText, Trash2 } from 'lucide-react';
import { TypingTest, type ResultMeta } from '../components/TypingTest';
import { Button, Card, Notice, PageTitle } from '../components/ui';
import { dailyChallenge, meetsTarget } from '../domain/daily';
import { utcDay } from '../domain/dates';
import { analyze, weakKeyDrill } from '../domain/analysis';
import { uuid } from '../domain/id';
import { getWordList } from '../data/wordlists';
import { textToWords } from '../engine/words';
import { saveResult } from '../services/results';
import { progressStore, useProgress, useSettings } from '../state/store';
import type { TestResult } from '../types';

type Active = { kind: 'daily' } | { kind: 'custom'; words: string[] } | { kind: 'drill'; words: string[] } | null;

const MAX_TEXT = 5000;

export default function PracticePage() {
  const progress = useProgress();
  const settings = useSettings();
  const [active, setActive] = useState<Active>(null);
  const [runId, setRunId] = useState(0);
  const today = utcDay(new Date());
  const challenge = useMemo(() => dailyChallenge(today), [today]);
  const record = progress.daily[today];
  const analysis = useMemo(() => analyze(progress.history), [progress.history]);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');

  const start = (a: Active) => {
    setActive(a);
    setRunId((n) => n + 1);
  };

  const onComplete = useCallback(
    (r: TestResult) => (active?.kind === 'daily' ? saveResult(r, { daily: challenge }) : saveResult(r)),
    [active, challenge],
  );

  if (active) {
    const words = active.kind === 'daily' ? challenge.words : active.words;
    const meta: ResultMeta =
      active.kind === 'daily' ? { mode: 'daily', mode2: words.length, dailyDate: today } : { mode: 'custom', mode2: words.length };
    return (
      <div>
        <button type="button" onClick={() => setActive(null)} className="mb-6 inline-flex items-center gap-1 text-sm text-sub hover:text-text">
          <ArrowLeft size={16} /> Back to practice
        </button>
        {active.kind === 'daily' && (
          <p className="mb-4 text-sm text-sub">
            Daily challenge {today} · target {challenge.targetWpm} wpm at {challenge.targetAccuracy}% accuracy
          </p>
        )}
        <TypingTest
          source={{ kind: 'fixed', words }}
          sourceKey={`${active.kind}-${runId}`}
          meta={meta}
          onComplete={onComplete}
          resultExtra={
            active.kind === 'daily'
              ? (r) =>
                  meetsTarget(challenge, r.wpm, r.accuracy) && r.valid ? (
                    <Notice>Challenge complete! You beat today's target.</Notice>
                  ) : (
                    <Notice tone="warn">
                      Target not met: needed {challenge.targetWpm} wpm and {challenge.targetAccuracy}% accuracy.
                    </Notice>
                  )
              : undefined
          }
        />
      </div>
    );
  }

  const saveText = () => {
    const clean = text.slice(0, MAX_TEXT).trim();
    if (!clean) return;
    progressStore.set((p) => ({ ...p, customTexts: [...p.customTexts, { id: uuid(), title: title.trim().slice(0, 60) || clean.slice(0, 30), text: clean }].slice(-30) }));
    setTitle('');
  };

  const drillWords = analysis.enoughData ? weakKeyDrill(analysis.weakKeys.map((k) => k.char), getWordList(settings.language, 'normal')) : [];

  return (
    <div>
      <PageTitle sub="Daily challenges, your own passages, and targeted drills.">Practice</PageTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-medium text-text">
            <CalendarDays size={18} className="text-brand" /> Daily challenge
          </h2>
          <p className="mt-1 text-sm text-sub">The same passage for everyone today ({today} UTC). Beat the target for {100} XP.</p>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-sub">target</dt>
              <dd className="text-text">{challenge.targetWpm} wpm</dd>
            </div>
            <div>
              <dt className="text-sub">accuracy</dt>
              <dd className="text-text">{challenge.targetAccuracy}%</dd>
            </div>
            <div>
              <dt className="text-sub">your best</dt>
              <dd className="text-text">{record ? `${Math.round(record.bestWpm)} wpm` : '—'}</dd>
            </div>
          </dl>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => start({ kind: 'daily' })}>{record ? 'Try again' : 'Start challenge'}</Button>
            {record?.completed && (
              <span className="inline-flex items-center gap-1 text-sm text-brand">
                <Check size={16} /> Completed
              </span>
            )}
          </div>
          <DailyHistory daily={progress.daily} />
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 text-lg font-medium text-text">
            <Crosshair size={18} className="text-brand" /> Weak-key drill
          </h2>
          {analysis.enoughData && analysis.weakKeys.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-sub">
                Built from your last {analysis.testsAnalyzed} tests. Highest-error keys:{' '}
                {analysis.weakKeys.map((k) => (
                  <kbd key={k.char} className="mx-0.5 rounded bg-surface-2 px-1.5 text-text">
                    {k.char}
                  </kbd>
                ))}
              </p>
              <Button className="mt-4" onClick={() => start({ kind: 'drill', words: drillWords })} disabled={drillWords.length === 0}>
                Start drill
              </Button>
            </>
          ) : analysis.enoughData ? (
            <p className="mt-1 text-sm text-sub">No key stands out as a weak spot in your recent tests. Nice and even.</p>
          ) : (
            <p className="mt-1 text-sm text-sub">
              Not enough data yet. Complete at least 3 tests ({analysis.testsAnalyzed}/3 so far, {analysis.charsAnalyzed}/500 characters) and a drill will be built
              from the keys you actually miss.
            </p>
          )}
        </Card>

        <Card className="md:col-span-2">
          <h2 className="flex items-center gap-2 text-lg font-medium text-text">
            <FileText size={18} className="text-brand" /> Custom text
          </h2>
          <label htmlFor="custom-title" className="mt-3 block text-sm text-sub">Title (optional)</label>
          <input id="custom-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg bg-surface-2 px-3 py-2 text-text" />
          <label htmlFor="custom-text" className="mt-3 block text-sm text-sub">Passage ({text.length}/{MAX_TEXT})</label>
          <textarea
            id="custom-text"
            value={text}
            maxLength={MAX_TEXT}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg bg-surface-2 px-3 py-2 text-text"
            placeholder="Paste or write anything you want to practice."
          />
          <div className="mt-3 flex gap-2">
            <Button onClick={() => start({ kind: 'custom', words: textToWords(text) })} disabled={textToWords(text).length === 0}>
              Practice this text
            </Button>
            <Button variant="ghost" onClick={saveText} disabled={!text.trim()}>
              Save passage
            </Button>
          </div>
          {progress.customTexts.length > 0 && (
            <ul className="mt-5 divide-y divide-surface-2">
              {progress.customTexts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-text hover:text-brand" onClick={() => start({ kind: 'custom', words: textToWords(c.text) })}>
                    {c.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete passage ${c.title}`}
                    className="text-sub hover:text-error"
                    onClick={() => progressStore.set((p) => ({ ...p, customTexts: p.customTexts.filter((x) => x.id !== c.id) }))}
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function DailyHistory({ daily }: { daily: ReturnType<typeof useProgress>['daily'] }) {
  const items = Object.values(daily).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  if (!items.length) return null;
  return (
    <div className="mt-5">
      <h3 className="text-xs uppercase tracking-wider text-sub">Recent challenges</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((d) => (
          <li key={d.date} className="flex justify-between">
            <span className="text-sub">{d.date}</span>
            <span className={d.completed ? 'text-brand' : 'text-text'}>
              {Math.round(d.bestWpm)} wpm · {Math.floor(d.bestAccuracy)}% {d.completed ? '✓' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
