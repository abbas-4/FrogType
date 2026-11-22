import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { TestPage } from './pages/TestPage';
import './services/sync';

const PracticePage = lazy(() => import('./pages/PracticePage'));
const LessonsPage = lazy(() => import('./pages/LessonsPage'));
const LessonPlayerPage = lazy(() => import('./pages/LessonPlayerPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const HistoryDetailPage = lazy(() => import('./pages/HistoryDetailPage'));
const LeaderboardsPage = lazy(() => import('./pages/LeaderboardsPage'));
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<TestPage />} />
            <Route path="practice" element={<PracticePage />} />
            <Route path="lessons" element={<LessonsPage />} />
            <Route path="lessons/:id" element={<LessonPlayerPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="history/:id" element={<HistoryDetailPage />} />
            <Route path="leaderboards" element={<LeaderboardsPage />} />
            <Route path="achievements" element={<AchievementsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="u/:username" element={<PublicProfilePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
