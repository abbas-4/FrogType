import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LessonPlayerPage from '../src/pages/LessonPlayerPage';
import LessonsPage from '../src/pages/LessonsPage';
import { getLesson, lessons } from '../src/domain/lessons';
import { loadProgress } from '../src/persistence/storage';
import { progressStore } from '../src/state/store';

const lesson = (id: string) => getLesson(id)!;
const shown = () => screen.getByTestId('words').textContent;
const lessonXp = (id: string) => progressStore.get().xp.filter((t) => t.key === `lesson:${id}`).length;

function setup(id: string) {
  const user = userEvent.setup({ delay: 30 });
  render(
    <MemoryRouter initialEntries={[`/lessons/${id}`]}>
      <Routes>
        <Route path="/lessons" element={<p>Lessons list</p>} />
        <Route path="/lessons/:id" element={<LessonPlayerPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return user;
}

async function finish(user: ReturnType<typeof userEvent.setup>, id: string) {
  expect(shown()).toBe(lesson(id).text.replaceAll(' ', ''));
  await user.type(screen.getByTestId('typing-input'), lesson(id).text);
  await screen.findByTestId('results');
}

beforeEach(() => {
  progressStore.set(loadProgress(null));
  // Run the test clock 8x faster than real time: 30ms typing delay reads as ~240ms per key and the 100ms
  // sampling tick as <1s, so results are valid, pass the targets, and have no idle seconds.
  const start = Date.now();
  vi.spyOn(performance, 'now').mockImplementation(() => (Date.now() - start) * 8);
});
afterEach(() => vi.restoreAllMocks());

describe('lesson progression', { timeout: 20_000 }, () => {
  it('Next loads the next lesson each time, never the same one', async () => {
    const user = setup('beginner-1');
    await finish(user, 'beginner-1');

    await user.click(screen.getByRole('button', { name: 'Next test' }));
    expect(screen.getByRole('heading')).toHaveTextContent(lesson('beginner-2').title);
    expect(screen.getByTestId('progress')).toHaveTextContent(`0/${lesson('beginner-2').text.split(' ').length}`);
    await finish(user, 'beginner-2');

    await user.click(screen.getByRole('button', { name: 'Next test' }));
    expect(screen.getByRole('heading')).toHaveTextContent(lesson('beginner-3').title);
    expect(shown()).toBe(lesson('beginner-3').text.replaceAll(' ', ''));

    const p = progressStore.get();
    expect(p.lessons['beginner-1']).toMatchObject({ attempts: 1, completed: true });
    expect(p.lessons['beginner-2']).toMatchObject({ attempts: 1, completed: true });
    expect(p.lessons['beginner-3']).toBeUndefined();
    expect(p.history).toHaveLength(2);
    expect(lessonXp('beginner-1')).toBe(1);
    expect(lessonXp('beginner-2')).toBe(1);

    // reload: a fresh load from storage has the same progress and XP
    const reloaded = loadProgress(null);
    expect(reloaded.lessons).toEqual(p.lessons);
    expect(reloaded.xp).toEqual(p.xp);
  });

  it('Next on the final lesson goes back to the lessons list', async () => {
    const last = lessons[lessons.length - 1]!.id;
    const user = setup(last);
    await finish(user, last);
    await user.click(screen.getByRole('button', { name: 'Next test' }));
    expect(screen.getByText('Lessons list')).toBeInTheDocument();
  });

  it('Next crosses into the next category', async () => {
    const user = setup('beginner-3');
    await finish(user, 'beginner-3');
    await user.click(screen.getByRole('button', { name: 'Next test' }));
    expect(screen.getByRole('heading')).toHaveTextContent(lesson('home-1').title);
  });

  it('Repeat restarts the same lesson and never awards lesson XP twice', async () => {
    const user = setup('beginner-1');
    await finish(user, 'beginner-1');
    await user.click(screen.getByRole('button', { name: 'Restart test' }));
    expect(screen.getByRole('heading')).toHaveTextContent(lesson('beginner-1').title);
    expect(screen.getByTestId('progress')).toHaveTextContent('0/');
    await finish(user, 'beginner-1');

    expect(progressStore.get().lessons['beginner-1']).toMatchObject({ attempts: 2, completed: true });
    expect(progressStore.get().history).toHaveLength(2);
    expect(lessonXp('beginner-1')).toBe(1);
  });

  it('lesson results hide the description, test type and pass notice', async () => {
    const user = setup('beginner-1');
    expect(screen.queryByText(lesson('beginner-1').description)).toBeNull();
    await finish(user, 'beginner-1');
    expect(screen.queryByText('test type')).toBeNull();
    expect(screen.queryByText(/beginner-1/)).toBeNull();
    expect(screen.queryByText(/Lesson passed/)).toBeNull();
    expect(screen.queryByText(/Not yet/)).toBeNull();
    expect(within(screen.getByTestId('results')).queryByRole('link', { name: /Next:|All lessons/ })).toBeNull();
    for (const label of ['wpm', 'acc', 'raw', 'consistency', 'characters', 'time', 'words']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/XP/)).toBeInTheDocument();
  });

  it('every completed lesson card gets the completed style; others do not', () => {
    const done = { attempts: 1, bestWpm: 30, bestAccuracy: 99, completed: true, firstWpm: 30, lastAt: '' };
    const doneIds = ['beginner-1', 'home-1', lessons[lessons.length - 1]!.id];
    progressStore.set({ ...progressStore.get(), lessons: Object.fromEntries([...doneIds.map((id) => [id, done]), ['home-2', { ...done, completed: false }]]) });
    render(
      <MemoryRouter>
        <LessonsPage />
      </MemoryRouter>,
    );
    for (const l of lessons) {
      const card = screen.getByRole('link', { name: new RegExp(`^${l.title}`) });
      if (doneIds.includes(l.id)) expect(card).toHaveAttribute('data-completed', 'true');
      else expect(card).not.toHaveAttribute('data-completed');
    }
  });
});
