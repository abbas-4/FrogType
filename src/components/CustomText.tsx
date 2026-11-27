import { useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { Button, Card } from './ui';
import { uuid } from '../domain/id';
import { textToWords } from '../engine/words';
import { progressStore, useProgress } from '../state/store';

const MAX_TEXT = 5000;

/** Custom-mode passage picker: write or paste a passage, optionally save it, or start one of the saved ones. */
export function CustomText({ onStart }: { onStart: (words: string[]) => void }) {
  const progress = useProgress();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');

  const saveText = () => {
    const clean = text.slice(0, MAX_TEXT).trim();
    if (!clean) return;
    progressStore.set((p) => ({ ...p, customTexts: [...p.customTexts, { id: uuid(), title: title.trim().slice(0, 60) || clean.slice(0, 30), text: clean }].slice(-30) }));
    setTitle('');
  };

  return (
    <Card className="mx-auto w-full max-w-3xl">
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
        <Button onClick={() => onStart(textToWords(text))} disabled={textToWords(text).length === 0}>
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
              <button type="button" className="min-w-0 flex-1 truncate text-left text-text hover:text-brand" onClick={() => onStart(textToWords(c.text))}>
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
  );
}
