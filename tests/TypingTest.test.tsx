import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TypingTest } from '../src/components/TypingTest';
import { saveResult } from '../src/services/results';
import { loadProgress } from '../src/persistence/storage';
import { progressStore } from '../src/state/store';

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

describe('<TypingTest> results screen', { timeout: 20_000 }, () => {
  afterEach(() => vi.restoreAllMocks());

  // A below-50% run at a human pace: 8x test clock makes the 30ms typing delay read as ~240ms per key.
  async function finishBadly() {
    progressStore.set(loadProgress(null));
    const start = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => (Date.now() - start) * 8);
    const user = userEvent.setup({ delay: 30 });
    render(
      <MemoryRouter>
        <TypingTest source={{ kind: 'fixed', words: ['abc', 'def', 'ghi', 'jkl'] }} sourceKey="t" meta={{ mode: 'custom', mode2: 4 }} onComplete={(r) => saveResult(r)} />
      </MemoryRouter>,
    );
    await user.type(screen.getByTestId('typing-input'), 'xyz xyz xyz xyz ');
    await screen.findByTestId('results');
    return user;
  }

  it('shows full results for a test below 50% accuracy and saves it to history', async () => {
    await finishBadly();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Invalid test|Accuracy below/)).toBeNull();
    expect(Number.parseInt(screen.getByTestId('result-acc').textContent!)).toBeLessThan(50);
    for (const label of ['wpm', 'acc', 'raw', 'consistency', 'characters', 'time', 'words']) expect(screen.getByText(label)).toBeInTheDocument();
    const history = progressStore.get().history;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ valid: true });
    expect(history[0]!.accuracy).toBeLessThan(50);
  });

  it('stray keys after finishing never restart; Tab then Enter does', async () => {
    const user = await finishBadly();
    expect(document.activeElement?.tagName).not.toBe('BUTTON');
    await user.keyboard('typing on {Enter} {Enter}x');
    expect(screen.getByTestId('results')).toBeInTheDocument();
    expect(screen.queryByTestId('typing-input')).toBeNull();

    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Restart test' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByTestId('results')).toBeNull();
    expect(screen.getByTestId('progress')).toHaveTextContent('0/4');
    expect(progressStore.get().history).toHaveLength(1);
  });
});
