import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TypingTest } from '../src/components/TypingTest';
import { saveResult } from '../src/services/results';

function setup(words: string[]) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <TypingTest source={{ kind: 'fixed', words }} sourceKey="t" meta={{ mode: 'custom', mode2: words.length }} onComplete={(r) => saveResult(r)} />
    </MemoryRouter>,
  );
  return user;
}

describe('<TypingTest>', () => {
  it('renders the passage as text and highlights correct and incorrect letters', async () => {
    const user = setup(['frog', 'type']);
    const words = screen.getByTestId('words');
    expect(words).toHaveTextContent('frogtype');
    await user.type(screen.getByTestId('typing-input'), 'fx');
    const letters = within(words).getAllByText(/./, { selector: 'span span' });
    expect(letters[0]).toHaveClass('text-text');
    expect(letters[1]).toHaveClass('text-error');
  });

  it('shows results when the passage is finished', async () => {
    const user = setup(['ab', 'cd']);
    await user.type(screen.getByTestId('typing-input'), 'ab cd');
    expect(await screen.findByTestId('results')).toBeInTheDocument();
    expect(screen.getByTestId('result-acc')).toHaveTextContent('100%');
  });

  it('restarts with Tab and clears typed input', async () => {
    const user = setup(['ab', 'cd']);
    const input = screen.getByTestId('typing-input');
    await user.type(input, 'ax');
    await user.keyboard('{Tab}');
    const letters = within(screen.getByTestId('words')).getAllByText(/./, { selector: 'span span' });
    expect(letters.every((l) => l.classList.contains('text-sub'))).toBe(true);
  });

  it('enters focus mode while typing and leaves it on Esc, restart and finish', async () => {
    const user = setup(['ab', 'cd']);
    const input = screen.getByTestId('typing-input');
    const typing = () => 'typing' in document.documentElement.dataset;
    expect(typing()).toBe(false);
    await user.type(input, 'a');
    expect(typing()).toBe(true);
    await user.keyboard('{Escape}');
    expect(typing()).toBe(false);
    await user.type(input, 'b');
    expect(typing()).toBe(true);
    await user.keyboard('{Tab}');
    expect(typing()).toBe(false);
    await user.type(input, 'ab cd');
    await screen.findByTestId('results');
    expect(typing()).toBe(false);
  });

  it('never renders typed text as HTML', async () => {
    const user = setup(['<b>x</b>']);
    await user.type(screen.getByTestId('typing-input'), '<b>');
    expect(document.querySelector('[data-testid="words"] b')).toBeNull();
  });
});
