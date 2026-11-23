import { useCallback, useMemo, useState } from 'react';
import { ModeBar } from '../components/ModeBar';
import { TypingTest } from '../components/TypingTest';
import type { WordSource } from '../hooks/useTypingTest';
import { saveResult } from '../services/results';
import { issueChallenge } from '../services/cloud';
import { useAuth } from '../state/auth';
import { useSettings } from '../state/store';

const RANKED: Record<'time' | 'words', number[]> = { time: [15, 30, 60, 120], words: [10, 25, 50, 100] };

export function TestPage() {
  const settings = useSettings();
  const [mode, setMode] = useState<'time' | 'words'>(settings.defaultMode);
  const mode2 = mode === 'time' ? settings.timeDuration : settings.wordCount;
  const options = useMemo(
    () => ({ language: settings.language, difficulty: settings.difficulty, punctuation: settings.punctuation, numbers: settings.numbers }),
    [settings.language, settings.difficulty, settings.punctuation, settings.numbers],
  );
  const signedIn = useAuth().user !== null;
  // FT-01: only the standard English board configuration can rank, and only with a server-issued passage
  const ranked =
    signedIn && options.language === 'english' && options.difficulty === 'normal' && !options.punctuation && !options.numbers && RANKED[mode].includes(mode2);
  const source = useMemo<WordSource>(
    () => ({
      kind: 'generated',
      options,
      limit: mode === 'time' ? { kind: 'time', seconds: mode2 } : { kind: 'words' },
      count: mode2,
      challenge: ranked ? () => issueChallenge(mode, mode2).catch(() => null) : undefined,
    }),
    [options, mode, mode2, ranked],
  );
  const key = `${mode}-${mode2}-${options.language}-${options.difficulty}-${options.punctuation}-${options.numbers}-${ranked}`;
  const meta = useMemo(() => ({ mode, mode2 }), [mode, mode2]);
  const onComplete = useCallback((r: Parameters<typeof saveResult>[0]) => saveResult(r), []);

  return (
    <div className="flex min-h-[60vh] flex-col justify-center">
      <h1 className="sr-only">Typing test</h1>
      <ModeBar settings={settings} mode={mode} setMode={setMode} />
      <TypingTest source={source} sourceKey={key} meta={meta} onComplete={onComplete} />
    </div>
  );
}
