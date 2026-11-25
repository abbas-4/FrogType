import { useCallback, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TypingTest } from '../components/TypingTest';
import { getLesson, lessons } from '../domain/lessons';
import { saveResult } from '../services/results';
import { useProgress } from '../state/store';
import type { TestResult } from '../types';

export default function LessonPlayerPage() {
  const { id = '' } = useParams();
  const lesson = getLesson(id);
  const progress = useProgress();
  const navigate = useNavigate();
  const words = useMemo(() => lesson?.text.split(' ') ?? [], [lesson]);
  const meta = useMemo(() => ({ mode: 'lesson' as const, mode2: words.length, lessonId: id }), [words.length, id]);
  const onComplete = useCallback((r: TestResult) => saveResult(r, { lesson }), [lesson]);

  if (!lesson) {
    return (
      <div className="py-16 text-center">
        <p className="text-sub">Lesson not found.</p>
        <Link to="/lessons" className="mt-4 inline-block text-brand underline">All lessons</Link>
      </div>
    );
  }
  const idx = lessons.findIndex((l) => l.id === lesson.id);
  // Lessons are ordered across categories, so this crosses into the next category; after the last one, back to the list.
  const next = lessons[idx + 1];
  const nextPath = next ? `/lessons/${next.id}` : '/lessons';
  const p = progress.lessons[lesson.id];

  return (
    <div>
      <Link to="/lessons" className="mb-6 inline-flex items-center gap-1 text-sm text-sub hover:text-text">
        <ArrowLeft size={16} /> All lessons
      </Link>
      <h1 className="text-xl font-semibold text-text">{lesson.title}</h1>
      <p className="mt-1 mb-8 text-sm text-sub">
        Pass: {lesson.targetWpm} wpm at {lesson.targetAccuracy}% accuracy
        {p && ` · attempts ${p.attempts} · best ${Math.round(p.bestWpm)} wpm, ${Math.floor(p.bestAccuracy)}%`}
        {p?.completed && <span className="text-brand"> · passed</span>}
      </p>
      {/* keyed by lesson: Next must start a fresh player (state, result, completion guard), never the previous lesson */}
      <TypingTest
        key={lesson.id}
        source={{ kind: 'fixed', words }}
        sourceKey={lesson.id}
        meta={meta}
        onComplete={onComplete}
        onNext={() => navigate(nextPath)}
      />
    </div>
  );
}
