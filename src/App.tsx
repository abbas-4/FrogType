import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { TestPage } from './pages/TestPage';
import './services/sync';

const LessonsPage = lazy(() => import('./pages/LessonsPage'));
const LessonPlayerPage = lazy(() => import('./pages/LessonPlayerPage'));
const DailyChallengePage = lazy(() => import('./pages/DailyChallengePage'));
const WeakKeyDrillPage = lazy(() => import('./pages/WeakKeyDrillPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const HistoryDetailPage = lazy(() => import('./pages/HistoryDetailPage'));
const LeaderboardsPage = lazy(() => import('./pages/LeaderboardsPage'));
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<TestPage />} />
            {/* Practice was split up: custom text is a test mode, drill and daily challenge live under Lessons */}
            <Route path="practice" element={<Navigate to="/" replace />} />
            <Route path="lessons" element={<LessonsPage />} />
            <Route path="lessons/daily" element={<DailyChallengePage />} />
            <Route path="lessons/drill" element={<WeakKeyDrillPage />} />
            <Route path="lessons/:id" element={<LessonPlayerPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="history/:id" element={<HistoryDetailPage />} />
            <Route path="leaderboards" element={<LeaderboardsPage />} />
            <Route path="achievements" element={<AchievementsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="u/:username" element={<PublicProfilePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="reset-password" element={<ResetPasswordPage />} />
            <Route path="signin" element={<AuthPage mode="signin" />} />
            <Route path="signup" element={<AuthPage mode="signup" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
