import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '../src/components/Layout';
import AchievementsPage from '../src/pages/AchievementsPage';
import { achievements } from '../src/domain/achievements';
import { progressStore } from '../src/state/store';

const pages = [
  ['Test', '/'],
  ['Lessons', '/lessons'],
  ['Leaderboards', '/leaderboards'],
  ['Profile', '/profile'],
  ['Settings', '/settings'],
] as const;

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<h1>page</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('main navigation', () => {
  it('has an icon link with a tooltip for each of the five main pages, and marks the active one', () => {
    renderAt('/lessons');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const [name, href] of pages) {
      const link = within(nav).getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveTextContent(name); // tooltip text
    }
    expect(within(nav).queryByRole('link', { name: 'Statistics' })).toBeNull(); // reached from the profile page
    expect(within(nav).queryByRole('link', { name: 'Achievements' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Practice' })).toBeNull(); // split into the custom test mode and Lessons
    expect(within(nav).getByRole('link', { name: 'Lessons' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Test' })).not.toHaveAttribute('aria-current');
  });

  it('logo links home', () => {
    renderAt('/settings');
    expect(screen.getByRole('link', { name: 'FrogType home' })).toHaveAttribute('href', '/');
  });

  it('mobile menu opens, closes on Escape, and closes after navigating', async () => {
    const user = renderAt('/');
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(menu).getAllByRole('link')).toHaveLength(5);

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();

    await user.click(button);
    await user.click(within(menu).getByRole('link', { name: 'Lessons' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(within(menu).getByRole('link', { name: 'Lessons' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('achievement icons', () => {
  it('every achievement has its own icon, grey when locked and green when unlocked', () => {
    progressStore.set((p) => ({ ...p, achievements: { 'first-test': '2026-11-01T00:00:00.000Z' } }), false);
    render(
      <MemoryRouter>
        <AchievementsPage />
      </MemoryRouter>,
    );
    const cards = screen.getAllByRole('listitem').filter((li) => li.dataset.state);
    expect(cards).toHaveLength(achievements.length);
    const drawn = cards.map((c) => c.querySelector('svg')!.innerHTML);
    expect(new Set(drawn).size).toBe(achievements.length);

    const unlocked = cards.find((c) => c.textContent?.includes('First Test Completed'))!;
    expect(unlocked.dataset.state).toBe('unlocked');
    expect(unlocked.querySelector('svg g')).toHaveClass('text-brand');

    const locked = cards.find((c) => c.textContent?.includes('Graduate'))!;
    expect(locked.dataset.state).toBe('locked');
    expect(locked).toHaveTextContent('Locked');
    expect(locked.querySelector('svg g')).not.toHaveClass('text-brand');
  });
});

describe('profile previews', () => {
  it('show the latest achievements and all-time stats, and link to the full pages', async () => {
    const { default: ProfilePage } = await import('../src/pages/ProfilePage');
    const { makeResult } = await import('./fixtures');
    progressStore.set(
      (p) => ({
        ...p,
        achievements: { 'first-test': '2026-11-01T00:00:00.000Z', 'tests-10': '2026-11-03T00:00:00.000Z', 'first-lesson': '2026-11-02T00:00:00.000Z', 'wpm-50': '2026-11-04T00:00:00.000Z' },
        history: [makeResult({ wpm: 40, durationMs: 30000, wordsTyped: 25 }), makeResult({ wpm: 60, durationMs: 30000, wordsTyped: 30 })],
      }),
      false,
    );
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: `See all ${achievements.length}` })).toHaveAttribute('href', '/achievements');
    expect(screen.getByText(`4 of ${achievements.length}`)).toBeInTheDocument();
    const latest = within(screen.getByRole('list', { name: 'Latest achievements' })).getAllByRole('listitem');
    expect(latest).toHaveLength(3); // preview only, newest first
    expect(latest[0]).toHaveTextContent(achievements.find((a) => a.id === 'wpm-50')!.title);

    expect(screen.getByRole('link', { name: 'All statistics' })).toHaveAttribute('href', '/stats');
    expect(screen.getByText('50.0')).toBeInTheDocument(); // avg wpm
    expect(screen.getByText('55')).toBeInTheDocument(); // words typed
    expect(screen.queryByText('Recent activity')).toBeNull();
  });
});

describe('daily challenge', () => {
  it('lives on the Lessons page and opens its player at /lessons/daily', async () => {
    const [{ default: LessonsPage }, { default: DailyChallengePage }] = await Promise.all([import('../src/pages/LessonsPage'), import('../src/pages/DailyChallengePage')]);
    render(
      <MemoryRouter initialEntries={['/lessons']}>
        <Routes>
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/lessons/daily" element={<DailyChallengePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Daily challenge' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Start challenge|Try again/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Daily challenge' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All lessons' })).toHaveAttribute('href', '/lessons');
    expect(screen.getByTestId('typing-input')).toBeInTheDocument();
  });
});

describe('custom test mode', () => {
  it('picks a passage (saving it), types it, and "change text" returns to the picker', async () => {
    const { TestPage } = await import('../src/pages/TestPage');
    progressStore.set((p) => ({ ...p, customTexts: [] }), false);
    render(
      <MemoryRouter>
        <TestPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'custom' }));
    expect(screen.queryByTestId('typing-input')).toBeNull();
    await user.type(screen.getByLabelText('Title (optional)'), 'Frogs');
    await user.type(screen.getByLabelText(/Passage/), 'green frogs jump');
    await user.click(screen.getByRole('button', { name: 'Save passage' }));
    expect(progressStore.get().customTexts.map((c) => c.title)).toEqual(['Frogs']);

    await user.click(screen.getByRole('button', { name: 'Practice this text' }));
    expect(screen.getByTestId('words')).toHaveTextContent('greenfrogsjump');

    await user.click(screen.getByRole('button', { name: 'change text' }));
    await user.click(screen.getByRole('button', { name: 'Frogs' })); // saved passage starts directly
    expect(screen.getByTestId('words')).toHaveTextContent('greenfrogsjump');
  });
});
