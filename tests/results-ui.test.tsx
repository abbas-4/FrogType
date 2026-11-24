import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ResultsView from '../src/components/ResultsView';
import { ModeBar } from '../src/components/ModeBar';
import { settingsStore, useSettings } from '../src/state/store';
import { makeResult } from './fixtures';

describe('<ResultsView> actions', () => {
  it('exposes icon-only actions by accessible name and calls the right handler', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onRestart = vi.fn();
    render(
      <MemoryRouter>
        <ResultsView result={makeResult()} onNext={onNext} onRestart={onRestart} />
      </MemoryRouter>,
    );
    const next = screen.getByRole('button', { name: 'Next test' });
    expect(next).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Repeat test' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'View statistics' })).toHaveAttribute('href', '/stats');
  });

  it('keeps every metric and shows no actions for a saved result', () => {
    render(
      <MemoryRouter>
        <ResultsView result={makeResult()} />
      </MemoryRouter>,
    );
    for (const label of ['wpm', 'acc', 'test type', 'raw', 'consistency', 'characters', 'time', 'words']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next test' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'View statistics' })).toBeNull();
  });

  it('hides test type only for lesson results', () => {
    render(
      <MemoryRouter>
        <ResultsView result={makeResult({ mode: 'lesson', lessonId: 'beginner-1' })} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('test type')).toBeNull();
    expect(screen.queryByText(/beginner-1/)).toBeNull();
    expect(screen.getByText('raw')).toBeInTheDocument();
  });
});

describe('<ModeBar>', () => {
  function Harness() {
    const settings = useSettings();
    return <ModeBar settings={settings} mode="time" setMode={setMode} />;
  }
  const setMode = vi.fn();

  it('toggles modifiers, switches mode and picks durations', async () => {
    const user = userEvent.setup();
    settingsStore.set({ ...settingsStore.get(), punctuation: false, numbers: false, timeDuration: 30 });
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'punctuation' }));
    await user.click(screen.getByRole('button', { name: 'numbers' }));
    expect(screen.getByRole('button', { name: 'punctuation' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'numbers' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'words' }));
    expect(setMode).toHaveBeenCalledWith('words');
    for (const v of ['15', '30', '60', '120']) {
      await user.click(screen.getByRole('radio', { name: v }));
      expect(screen.getByRole('radio', { name: v })).toHaveAttribute('aria-checked', 'true');
    }
    await user.click(screen.getByRole('radio', { name: 'custom' }));
    const input = screen.getByLabelText('Seconds (5–600)');
    await user.clear(input);
    await user.type(input, '45{Enter}');
    expect(settingsStore.get().timeDuration).toBe(45);
    expect(screen.getByRole('radio', { name: '45' })).toHaveAttribute('aria-checked', 'true');
  });
});
