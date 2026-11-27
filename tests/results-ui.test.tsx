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
    await user.click(screen.getByRole('button', { name: 'Restart test' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Next test' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'View statistics' })).toHaveAttribute('href', '/stats');
  });

  it('focuses no button on mount; stray keys do nothing; Tab then Enter restarts; Next is a separate stop', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onRestart = vi.fn();
    render(
      <MemoryRouter>
        <ResultsView result={makeResult()} onNext={onNext} onRestart={onRestart} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('group', { name: 'Result actions' })).toHaveFocus();
    expect(document.activeElement?.tagName).not.toBe('BUTTON');
    await user.keyboard('asdf {Enter} {Enter}');
    expect(onRestart).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Tab → Enter to restart')).toBeInTheDocument();

    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Restart test' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();

    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Next test' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByText(/to restart/)).toBeNull();
  });

  it('shows the invalid-test notice for tests but not for lessons', () => {
    const invalid = { valid: false, invalidReason: 'Test too short' };
    const { unmount } = render(
      <MemoryRouter>
        <ResultsView result={makeResult(invalid)} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid test');
    unmount();
    render(
      <MemoryRouter>
        <ResultsView result={makeResult({ ...invalid, mode: 'lesson', lessonId: 'beginner-1' })} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('raw')).toBeInTheDocument();
  });

  it('shows a low-accuracy result with every metric and no warning', () => {
    render(
      <MemoryRouter>
        <ResultsView result={makeResult({ accuracy: 12, wpm: 3 })} onRestart={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Invalid test|Accuracy below/)).toBeNull();
    expect(screen.getByTestId('result-acc')).toHaveTextContent('12%');
    for (const label of ['wpm', 'acc', 'raw', 'consistency', 'characters', 'time', 'words']) expect(screen.getByText(label)).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'zen' }));
    expect(setMode).toHaveBeenCalledWith('zen');
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    const input = screen.getByLabelText('Seconds (5–600)');
    await user.clear(input);
    await user.type(input, '45{Enter}');
    expect(settingsStore.get().timeDuration).toBe(45);
    expect(screen.getByRole('radio', { name: 'Custom: 45' })).toHaveAttribute('aria-checked', 'true');
  });
});
