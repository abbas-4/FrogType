import { useState } from 'react';
import { AtSign, Clock, Hash, Type } from 'lucide-react';
import type { Settings } from '../types';
import { updateSettings } from '../state/store';

const TIMES = [15, 30, 60, 120];
const WORDS = [10, 25, 50, 100];

export function ModeBar({ settings, mode, setMode }: { settings: Settings; mode: 'time' | 'words'; setMode: (m: 'time' | 'words') => void }) {
  const values = mode === 'time' ? TIMES : WORDS;
  const current = mode === 'time' ? settings.timeDuration : settings.wordCount;
  const [custom, setCustom] = useState<string | null>(null);

  const btn = (active: boolean) => `flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${active ? 'text-brand' : 'text-sub hover:text-text'}`;
  const group = 'flex items-center gap-0.5 rounded-lg bg-surface px-1.5 py-1';

  const applyCustom = () => {
    const n = Math.round(Number(custom));
    if (mode === 'time' && n >= 5 && n <= 600) updateSettings({ timeDuration: n });
    if (mode === 'words' && n >= 5 && n <= 500) updateSettings({ wordCount: n });
    setCustom(null);
  };

  return (
    <div className="mx-auto mb-10 flex max-w-full flex-wrap items-center justify-center gap-2 text-xs">
      <div className={group}>
        <button type="button" aria-pressed={settings.punctuation} className={btn(settings.punctuation)} onClick={() => updateSettings({ punctuation: !settings.punctuation })}>
          <AtSign size={12} aria-hidden="true" /> punctuation
        </button>
        <button type="button" aria-pressed={settings.numbers} className={btn(settings.numbers)} onClick={() => updateSettings({ numbers: !settings.numbers })}>
          <Hash size={12} aria-hidden="true" /> numbers
        </button>
      </div>
      <div className={group}>
        <button type="button" aria-pressed={mode === 'time'} className={btn(mode === 'time')} onClick={() => setMode('time')}>
          <Clock size={12} aria-hidden="true" /> time
        </button>
        <button type="button" aria-pressed={mode === 'words'} className={btn(mode === 'words')} onClick={() => setMode('words')}>
          <Type size={12} aria-hidden="true" /> words
        </button>
      </div>
      <div role="radiogroup" aria-label={mode === 'time' ? 'Duration in seconds' : 'Word count'} className={group}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={current === v}
            className={btn(current === v)}
            onClick={() => updateSettings(mode === 'time' ? { timeDuration: v } : { wordCount: v })}
          >
            {v}
          </button>
        ))}
        {custom === null ? (
          <button type="button" role="radio" aria-checked={!values.includes(current)} className={btn(!values.includes(current))} onClick={() => setCustom(String(current))}>
            {values.includes(current) ? 'custom' : current}
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyCustom();
            }}
            className="flex items-center gap-1"
          >
            <label className="sr-only" htmlFor="custom-mode">{mode === 'time' ? 'Seconds (5–600)' : 'Words (5–500)'}</label>
            <input
              id="custom-mode"
              autoFocus
              type="number"
              min={5}
              max={mode === 'time' ? 600 : 500}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onBlur={applyCustom}
              className="w-14 rounded bg-surface-2 px-1.5 py-0.5 text-text"
            />
          </form>
        )}
      </div>
    </div>
  );
}
