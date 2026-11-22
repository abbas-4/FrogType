import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { finalStats } from '../engine/core';
import { useTypingTest, type WordSource } from '../hooks/useTypingTest';
import { useSettings } from '../state/store';
import { playKey } from '../services/sound';
import { uuid } from '../domain/id';
import type { RecordOutcome } from '../domain/recordResult';
import type { TestResult } from '../types';
import { Word } from './Word';

const ResultsView = lazy(() => import('./ResultsView'));

export interface ResultMeta {
  mode: TestResult['mode'];
  mode2: number;
  lessonId?: string;
  dailyDate?: string;
}

interface Props {
  source: WordSource;
  sourceKey: string;
  meta: ResultMeta;
  onComplete: (r: TestResult) => RecordOutcome | null;
  /** extra content on the results screen (lesson / daily verdicts) */
  resultExtra?: (r: TestResult) => ReactNode;
  autoFocus?: boolean;
}

const fontStacks = {
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
};

export function TypingTest({ source, sourceKey, meta, onComplete, resultExtra, autoFocus = true }: Props) {
  const settings = useSettings();
  const t = useTypingTest(source, sourceKey);
  const { state, live, running, finished } = t;
  const inputRef = useRef<HTMLInputElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [stored, setResult] = useState<{ key: string; r: TestResult; outcome: RecordOutcome | null } | null>(null);
  // A result belongs to the source it was produced from; switching source hides it without an effect.
  const result = stored?.key === sourceKey ? stored : null;
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });

  const focus = useCallback(() => inputRef.current?.focus({ preventScroll: true }), []);

  const restart = useCallback(
    (repeat = false) => {
      setResult(null);
      setNotice(null);
      t.restart(repeat);
      requestAnimationFrame(focus);
    },
    [t, focus],
  );

  useEffect(() => {
    if (autoFocus) focus();
  }, [autoFocus, focus]);

  // Build the result exactly once per finished test.
  const doneFor = useRef<number | null>(null);
  useEffect(() => {
    if (!finished || state.startedAt === null || doneFor.current === state.startedAt) return;
    doneFor.current = state.startedAt;
    const f = finalStats(state);
    const s = settingsRef.current;
    const r: TestResult = {
      id: uuid(),
      createdAt: new Date().toISOString(),
      ...meta,
      wpm: f.wpm,
      raw: f.raw,
      accuracy: f.accuracy,
      consistency: f.consistency,
      chars: f.chars,
      durationMs: Math.round(f.durationMs),
      wordsTyped: f.wordsTyped,
      language: s.language,
      punctuation: s.punctuation,
      numbers: s.numbers,
      difficulty: s.difficulty,
      samples: state.samples,
      charStats: state.charStats,
      bigramErrors: state.bigramErrors,
      valid: f.valid,
      invalidReason: f.invalidReason,
    };
    setResult({ key: sourceKey, r, outcome: onComplete(r) });
  }, [finished, state, meta, onComplete, sourceKey]);

  // Hidden tab during a run would corrupt timing; reset instead of recording a misleading result.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && running) {
        t.restart(true);
        setNotice('Test reset because the tab was hidden.');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [running, t]);

  // Typing anywhere on the page (outside form fields) focuses the test.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (result) return;
      const el = document.activeElement;
      const inField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable;
      if (inField || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      if ((el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement) && e.key === ' ') return;
      e.preventDefault();
      focus();
      if (e.key === ' ') t.space();
      else t.type(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, t, result]);

  const handleChar = (ch: string) => {
    const word = state.words[state.wordIndex] ?? '';
    const input = state.inputs[state.wordIndex] ?? '';
    playKey(settings.sound, ch !== word[input.length]);
    t.type(ch);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      restart(false);
      return;
    }
    if (e.key === 'Escape') {
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      t.backspace(e.ctrlKey || e.altKey || e.metaKey);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if ((state.inputs[state.wordIndex] ?? '').length) playKey(settings.sound, false);
      t.space();
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleChar(e.key);
    }
  };

  // shortcut: mobile/IME input arrives here via the input event; backspace on some Android keyboards is not detected.
  const onInput = (e: React.FormEvent<HTMLInputElement>) => {
    const v = e.currentTarget.value;
    e.currentTarget.value = '';
    for (const ch of v) {
      if (ch === ' ') t.space();
      else handleChar(ch);
    }
  };

  // Caret + line scrolling: direct DOM writes after layout, no extra React renders.
  useLayoutEffect(() => {
    const container = wordsRef.current;
    const caret = caretRef.current;
    if (!container || !caret) return;
    const active = container.querySelector<HTMLElement>('[data-active]');
    if (!active) return;
    const lineH = active.offsetHeight;
    const shift = Math.max(0, active.offsetTop - lineH);
    container.style.transform = `translateY(${-shift}px)`;
    const idx = (state.inputs[state.wordIndex] ?? '').length;
    const letters = active.children;
    // Letter offsets are relative to the positioned container (same frame as the word), not to the word.
    let left: number;
    let width: number;
    const cur = letters[idx] as HTMLElement | undefined;
    if (cur) {
      left = cur.offsetLeft;
      width = cur.offsetWidth;
    } else {
      const last = letters[letters.length - 1] as HTMLElement | undefined;
      left = last ? last.offsetLeft + last.offsetWidth : active.offsetLeft;
      width = last?.offsetWidth ?? 0;
    }
    caret.style.transform = `translate(${left}px, ${active.offsetTop - shift}px)`;
    caret.style.height = `${lineH}px`;
    caret.style.width = settings.caretStyle === 'block' || settings.caretStyle === 'underline' ? `${width || lineH * 0.5}px` : '2px';
  });

  if (result) {
    return (
      <Suspense fallback={<div className="h-96" />}>
        <ResultsView result={result.r} outcome={result.outcome} onRestart={() => restart(true)} onNext={() => restart(false)} extra={resultExtra?.(result.r)} />
      </Suspense>
    );
  }

  const remaining = state.limit.kind === 'time' ? Math.max(0, Math.ceil(state.limit.seconds - live.elapsedMs / 1000)) : null;
  const progressLabel =
    state.limit.kind === 'time'
      ? String(running ? remaining : state.limit.seconds)
      : `${Math.min(state.wordIndex, state.words.length)}/${state.words.length}`;

  const caretClass = {
    line: 'bg-brand',
    block: 'bg-brand/30',
    underline: 'border-b-2 border-brand',
    off: 'hidden',
  }[settings.caretStyle];

  return (
    <div className="w-full">
      <div className="mb-3 flex h-8 items-end gap-6 text-xl tabular-nums text-brand" aria-live="off">
        <span data-testid="progress">{progressLabel}</span>
        {settings.showLiveWpm && running && (
          <>
            <span className="text-sub" data-testid="live-wpm">{Math.round(live.wpm)} wpm</span>
            <span className="text-sub">{Math.floor(live.accuracy)}%</span>
          </>
        )}
      </div>

      <div
        className="relative cursor-text"
        onClick={focus}
        style={{ fontFamily: fontStacks[settings.fontFamily], fontSize: `min(${settings.fontSize}rem, 6.5vw)`, lineHeight: 1.6 }}
      >
        <input
          ref={inputRef}
          data-testid="typing-input"
          aria-label="Typing input. Start typing to begin the test."
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="absolute h-px w-px opacity-0"
          onKeyDown={onKeyDown}
          onInput={onInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <div className="relative overflow-hidden" style={{ height: '4.8em' }}>
          <div ref={caretRef} aria-hidden="true" className={`caret absolute top-0 left-0 rounded-sm ${caretClass} ${running ? '' : 'caret-idle'} ${focused ? '' : 'opacity-0'}`} />
          <div ref={wordsRef} className="words flex flex-wrap select-none" data-testid="words">
            {state.words.map((w, i) => (
              <Word key={i} word={w} input={state.inputs[i] ?? ''} active={i === state.wordIndex} committed={i < state.wordIndex} />
            ))}
          </div>
        </div>
        {!focused && (
          <button
            type="button"
            onClick={focus}
            className="absolute inset-0 flex items-center justify-center rounded-lg bg-bg/70 text-base text-sub backdrop-blur-[2px]"
          >
            Click here or press any key to focus
          </button>
        )}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => restart(false)}
          aria-label="Restart test"
          className="rounded-lg p-3 text-sub transition-colors hover:text-text"
        >
          <RotateCcw size={20} />
        </button>
        {notice && <p role="status" className="text-sm text-error">{notice}</p>}
        <p className="text-xs text-sub">
          <kbd className="rounded bg-surface px-1.5 py-0.5">tab</kbd> restart · <kbd className="rounded bg-surface px-1.5 py-0.5">esc</kbd> leave typing area ·{' '}
          <kbd className="rounded bg-surface px-1.5 py-0.5">ctrl/alt + backspace</kbd> delete word
        </p>
      </div>
    </div>
  );
}
