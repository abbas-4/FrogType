import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Award, BarChart3, BookOpen, Keyboard, Medal, Menu, Settings as SettingsIcon, Target, User, X } from 'lucide-react';
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
  const levelLabel = `Level ${level.level}, ${level.into} of ${level.needed} XP to next level`;
  const [migrating, setMigrating] = useState(false);
  const [tipsHidden, setTipsHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);

  // Mobile menu: focus the first item on open; Escape or a click outside closes it.
  useEffect(() => {
    if (!menuOpen) return;
    menuPanel.current?.querySelector('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuPanel.current?.contains(t) && !menuButton.current?.contains(t)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

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
      <header className="relative flex items-center justify-between gap-4 py-6">
        <NavLink to="/" aria-label="FrogType home" className="shrink-0 rounded-lg">
          <Logo />
        </NavLink>
        <nav aria-label="Main" className="hidden md:block" onKeyDown={(e) => e.key === 'Escape' && setTipsHidden(true)} onFocus={() => setTipsHidden(false)}>
          <ul className="flex items-center gap-1">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <li key={to} onMouseEnter={() => setTipsHidden(false)}>
                <NavLink
                  to={to}
                  end={end}
                  aria-label={label}
                  className={({ isActive }) =>
                    `group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${isActive ? 'bg-brand/10 text-brand' : 'text-sub hover:bg-brand/5 hover:text-brand'}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={20} aria-hidden="true" />
                      {isActive && <span className="absolute bottom-0.5 h-0.5 w-4 rounded-full bg-brand" aria-hidden="true" />}
                      {/* Visual tooltip only; the link's accessible name is aria-label. Escape hides it (WCAG 1.4.13). */}
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs font-medium whitespace-nowrap text-zinc-50 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-200 group-focus-visible:opacity-100 ${tipsHidden ? 'hidden' : ''}`}
                      >
                        {label}
                      </span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <NavLink to="/achievements" className="hidden shrink-0 items-center gap-2 rounded-lg text-sm text-sub hover:text-text md:flex" aria-label={levelLabel}>
          <LevelMeter level={level.level} progress={level.progress} />
          {auth.profile && <span className="hidden max-w-32 truncate text-text lg:inline">{auth.profile.username}</span>}
        </NavLink>

        <button
          ref={menuButton}
          type="button"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-sub hover:bg-brand/5 hover:text-brand md:hidden"
        >
          {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
        <div
          ref={menuPanel}
          id="mobile-menu"
          className={`absolute inset-x-0 top-full z-40 rounded-xl border border-surface-2 bg-surface p-2 shadow-xl transition duration-150 md:hidden ${menuOpen ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-1 opacity-0'}`}
        >
          <NavLink to="/achievements" onClick={() => setMenuOpen(false)} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm text-sub hover:bg-brand/5" aria-label={levelLabel}>
            <LevelMeter level={level.level} progress={level.progress} />
            {auth.profile && <span className="truncate text-text">{auth.profile.username}</span>}
          </NavLink>
          <nav aria-label="Main menu" className="mt-1 border-t border-surface-2 pt-1">
            <ul>
              {nav.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${isActive ? 'bg-brand/10 text-brand' : 'text-text hover:bg-brand/5 hover:text-brand'}`
                    }
                  >
                    <Icon size={20} aria-hidden="true" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      {sync.migrationOffer !== null && (
        <div role="dialog" aria-labelledby="migrate-title" className="mb-4 rounded-xl border border-brand/40 bg-surface p-4">
          <h2 id="migrate-title" className="font-medium text-text">Move this browser's guest progress into your account?</h2>
          <p className="mt-1 text-sm text-sub">
            {sync.migrationOffer} test{sync.migrationOffer === 1 ? ' was' : 's were'} recorded here while signed out. Only accept if they are yours: they move into this
            account (and leave guest mode). Nothing in the cloud is replaced. Imported tests stay in your history as unverified and never count toward
            leaderboards, XP or public achievements.
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
              {migrating ? 'Moving…' : 'Move to my account'}
            </button>
            <button type="button" onClick={() => void declineMigration()} className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-text">
              Keep as guest data
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

function LevelMeter({ level, progress }: { level: number; progress: number }) {
  return (
    <span className="flex items-center gap-2" aria-hidden="true">
      <span className="tabular-nums">lv {level}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full bg-brand" style={{ width: `${Math.round(progress * 100)}%` }} />
      </span>
    </span>
  );
}
