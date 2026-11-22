import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Award, BarChart3, BookOpen, Keyboard, Medal, Settings as SettingsIcon, Target, User } from 'lucide-react';
import { Logo } from './Logo';
import { useProgress, useSettings } from '../state/store';
import { useToasts } from '../state/toasts';
import { useAuth } from '../state/auth';
import { useSync, acceptMigration, declineMigration } from '../services/sync';
import { levelFromXp, totalXp } from '../domain/progression';

const nav = [
  { to: '/', label: 'Test', icon: Keyboard, end: true },
  { to: '/practice', label: 'Practice', icon: Target },
  { to: '/lessons', label: 'Lessons', icon: BookOpen },
  { to: '/stats', label: 'Statistics', icon: BarChart3 },
  { to: '/leaderboards', label: 'Leaderboards', icon: Medal },
  { to: '/achievements', label: 'Achievements', icon: Award },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Layout() {
  const settings = useSettings();
  const progress = useProgress();
  const toasts = useToasts();
  const auth = useAuth();
  const sync = useSync();
  const location = useLocation();
  const level = levelFromXp(totalXp(progress.xp));
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.motion = settings.reducedMotion === 'system' ? '' : settings.reducedMotion;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--ft-bg').trim());
  }, [settings.theme, settings.reducedMotion]);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded focus:bg-brand focus:px-3 focus:py-1 focus:text-bg">
        Skip to content
      </a>
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <NavLink to="/" aria-label="FrogType home">
          <Logo />
        </NavLink>
        <nav aria-label="Main" className="order-3 w-full overflow-x-auto sm:order-none sm:w-auto">
          <ul className="flex gap-1">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  title={label}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${isActive ? 'text-brand' : 'text-sub hover:text-text'}`
                  }
                >
                  <Icon size={18} aria-hidden="true" />
                  <span className="hidden lg:inline">{label}</span>
                  <span className="sr-only lg:hidden">{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <NavLink to="/achievements" className="flex items-center gap-2 text-sm text-sub hover:text-text" aria-label={`Level ${level.level}, ${level.into} of ${level.needed} XP to next level`}>
          <span className="tabular-nums">lv {level.level}</span>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface" aria-hidden="true">
            <span className="block h-full bg-brand" style={{ width: `${Math.round(level.progress * 100)}%` }} />
          </span>
          {auth.profile && <span className="hidden text-text sm:inline">{auth.profile.username}</span>}
        </NavLink>
      </header>

      {sync.migrationOffer !== null && (
        <div role="dialog" aria-labelledby="migrate-title" className="mb-4 rounded-xl border border-brand/40 bg-surface p-4">
          <h2 id="migrate-title" className="font-medium text-text">Add this device's progress to your account?</h2>
          <p className="mt-1 text-sm text-sub">
            {sync.migrationOffer} test{sync.migrationOffer === 1 ? '' : 's'} on this device are not in your account yet. Uploading merges them with your cloud
            progress — nothing in the cloud is replaced. Imported tests are kept in your history but do not count toward leaderboards.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={migrating}
              onClick={async () => {
                setMigrating(true);
                await acceptMigration();
                setMigrating(false);
              }}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-bg hover:bg-brand-hover disabled:opacity-50"
            >
              {migrating ? 'Uploading…' : 'Add to my account'}
            </button>
            <button type="button" onClick={() => void declineMigration()} className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-text">
              Keep on this device only
            </button>
          </div>
        </div>
      )}
      {sync.status === 'error' && sync.message && (
        <p role="alert" className="mb-4 rounded-lg border border-error/40 px-4 py-2 text-sm text-error">
          {sync.message}
        </p>
      )}

      <main id="main" key={location.pathname} className="flex-1 animate-fade-in pb-12">
        <Outlet />
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-surface py-4 text-xs text-sub">
        <span>FrogType — Type faster. Get better.</span>
        <span>{sync.status === 'offline' ? 'offline' : auth.user ? (sync.status === 'syncing' ? 'syncing…' : 'synced') : 'local progress'}</span>
      </footer>

      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="animate-fade-in rounded-lg border border-brand/30 bg-surface px-4 py-3 shadow-lg">
            <div className="text-sm font-medium text-brand">{t.title}</div>
            {t.body && <div className="text-sm text-text">{t.body}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
