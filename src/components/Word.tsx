import { memo } from 'react';

interface Props {
  word: string;
  input: string;
  active: boolean;
  committed: boolean;
}

/** Memoized: on each keystroke only the active word re-renders. Text is rendered as React text nodes (never HTML). */
export const Word = memo(function Word({ word, input, active, committed }: Props) {
  const len = Math.max(word.length, input.length);
  const letters = [];
  for (let i = 0; i < len; i++) {
    const typed = input[i];
    const expected = word[i];
    let cls = 'text-sub';
    if (typed !== undefined) {
      if (expected === undefined) cls = 'text-error/70';
      else cls = typed === expected ? 'text-text' : 'text-error';
    }
    letters.push(
      <span key={i} className={cls}>
        {expected ?? typed}
      </span>,
    );
  }
  const wrong = committed && input !== word;
  return (
    <span
      className={`word mr-[0.6em] inline-block whitespace-nowrap ${wrong ? 'underline decoration-error decoration-2 underline-offset-[0.25em]' : ''}`}
      data-active={active || undefined}
    >
      {letters.length ? letters : '\u200b' /* empty zen word: keep line height for the caret */}
    </span>
  );
});
