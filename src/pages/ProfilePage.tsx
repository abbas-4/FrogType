import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, ChevronRight, Eye, EyeOff, Medal, Pencil, Trophy } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { AchievementIcon } from '../components/AchievementIcon';
import { Avatar } from '../components/Avatar';
import { ProfileEditor } from '../components/ProfileEditor';
import { ResendButton } from '../components/AuthForm';
import { Field } from '../components/forms';
import { Button, Card, Notice, Stat } from '../components/ui';
import { achievements } from '../domain/achievements';
import { levelFromXp, totalXp } from '../domain/progression';
import { formatDuration, summarize, type Summary } from '../domain/stats';
import { useAuth } from '../state/auth';
import { useProgress } from '../state/store';
import { pushToast } from '../state/toasts';
import { isSupabaseConfigured, landingAuth } from '../services/supabase';
import { getDecision, offerMigrationAgain, syncNow, useSync } from '../services/sync';
import type { Progress, TestResult } from '../types';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export default function ProfilePage() {
  const progress = useProgress();
  const auth = useAuth();
  const now = useMemo(() => new Date(), []);
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // Closing the editor (save or cancel) returns focus to "Edit profile" instead of dropping it on <body>.
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const valid = progress.history.filter((t) => t.valid);
  const s = summarize(valid, progress.history, now);
  const xp = totalXp(progress.xp);
  const lvl = levelFromXp(xp);
  const profile = auth.profile;
  const name = profile?.username ?? (auth.user ? 'Your account' : 'Guest');
  const firstTest = valid[0]?.createdAt;

  return (
    <div className="space-y-6">
      <ConfirmationLanding />
      {auth.user && profile && <UsernameFallbackNotice wanted={auth.user.user_metadata?.username} actual={profile.username} onChoose={() => setEditing(true)} />}

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar avatar={profile?.avatar} username={name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold break-words text-text">{name}</h1>
            {profile?.bio && <p className="mt-1 text-sm break-words text-text/90">{profile.bio}</p>}
            <p className="mt-1 text-sm text-sub">
              {profile ? `Joined ${day(profile.created_at)}` : firstTest ? `Local progress since ${day(firstTest)}` : 'No tests yet'}
            </p>
            <div className="mt-3 flex max-w-sm items-center gap-3 text-sm text-sub" aria-label={`Level ${lvl.level}, ${xp} XP total, ${lvl.into} of ${lvl.needed} XP to the next level`}>
              <span className="text-text tabular-nums">Level {lvl.level}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                <span className="block h-full bg-brand" style={{ width: `${Math.round(lvl.progress * 100)}%` }} />
              </span>
              <span className="tabular-nums">{xp} XP</span>
            </div>
            {profile && (
              <ul className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Visibility">
                <li className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-text">
                  {profile.is_public ? <Eye size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
                  {profile.is_public ? 'Public profile' : 'Private profile'}
                </li>
                <li className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-text">
                  <Medal size={12} aria-hidden="true" />
                  {profile.show_on_leaderboard ? 'On leaderboards' : 'Hidden from leaderboards'}
                </li>
                <li>
                  <Link to="/settings#privacy" className="inline-flex px-1 py-1 text-sub underline-offset-2 hover:text-text hover:underline">
                    Change
                  </Link>
                </li>
              </ul>
            )}
          </div>
          {profile && !editing && (
            <div className="flex flex-wrap gap-2">
              <button
                ref={editButton}
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-2/70"
              >
                <Pencil size={14} aria-hidden="true" /> Edit profile
              </button>
              <Link to={`/u/${profile.username}`} className="inline-flex items-center rounded-lg bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface-2/70">
                {profile.is_public ? 'View public profile' : 'Preview public profile'}
              </Link>
            </div>
          )}
        </div>
        {editing && auth.user && profile && (
          <div className="mt-6 border-t border-surface-2 pt-6">
            <h2 className="mb-4 font-medium text-text">Edit profile</h2>
            <ProfileEditor
              autoFocus
              userId={auth.user.id}
              profile={profile}
              onSaved={() => {
                setEditing(false);
                pushToast('Profile saved');
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        )}
      </Card>

      {!auth.user && <GuestAccountCard />}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Card><Stat label="best wpm" value={s.bestWpm.toFixed(1)} /></Card>
        <Card><Stat label="avg accuracy" value={`${s.avgAccuracy.toFixed(1)}%`} /></Card>
        <Card><Stat label="tests" value={s.tests} /></Card>
        <Card><Stat label="streak" value={`${s.currentStreak}d`} /></Card>
        <Card><Stat label="total xp" value={xp} /></Card>
        <Card><Stat label="achievements" value={Object.keys(progress.achievements).length} /></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AchievementsPreview unlocked={progress.achievements} />
        <StatsPreview s={s} valid={valid} />
      </div>

      {auth.user && <SyncPanel userId={auth.user.id} pending={progress.pendingSync.length} />}
    </div>
  );
}

function GuestAccountCard() {
  const auth = useAuth();
  if (!isSupabaseConfigured)
    return (
      <Notice>
        Accounts are not configured on this installation, so your progress is stored only in this browser. To enable sign-in, sync, leaderboards and friends, set{' '}
        <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README).
      </Notice>
    );
  if (!auth.ready) return <p className="text-sub">Loading…</p>;
  return (
    <Card>
      <h2 className="font-medium text-text">You're playing as a guest</h2>
      <p className="mt-1 text-sm text-sub">
        Your progress is saved in this browser only. Create a free account to back it up, sync it across devices, appear on leaderboards and add friends. You'll be asked
        whether to import what's here.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/signup" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-bg hover:bg-brand-hover">
          Create account
        </Link>
        <Link to="/signin" state={{ from: '/profile' }} className="rounded-lg bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface-2/70">
          Sign in
        </Link>
      </div>
    </Card>
  );
}

/** Result of opening a sign-up confirmation link, which lands on /profile (PKCE: it signs in only in the browser that signed up). */
function ConfirmationLanding() {
  const auth = useAuth();
  const location = useLocation();
  const [gaveUp, setGaveUp] = useState(false);
  const [email, setEmail] = useState('');
  const fresh = isSupabaseConfigured && landingAuth.path === '/profile' && location.key === 'default'; // only on the page the link opened
  useEffect(() => {
    if (!fresh || !landingAuth.hadCode) return;
    const id = window.setTimeout(() => setGaveUp(true), 3000);
    return () => window.clearTimeout(id);
  }, [fresh]);
  if (!fresh) return null;
  if (landingAuth.error)
    return (
      <div className="space-y-3 rounded-lg border border-error/40 p-4" data-testid="confirm-invalid">
        <p className="text-sm text-error">This confirmation link is invalid or has expired. Links work once. Enter your email to get a new one.</p>
        <div className="max-w-sm">
          <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <ResendButton email={email} initialCooldown={0} />
      </div>
    );
  if (!landingAuth.hadCode) return null;
  if (auth.user) return <Notice>Your email address is confirmed and you're signed in. Welcome to FrogType!</Notice>;
  if (auth.ready && gaveUp)
    return (
      <div className="rounded-lg border border-surface-2 p-4 text-sm text-sub" data-testid="confirm-other-browser">
        Your email address is confirmed. We couldn't sign you in automatically because the link was opened in a different browser from the one you signed up in.{' '}
        <Link to="/signin" className="text-brand underline">
          Sign in to continue
        </Link>
        .
      </div>
    );
  return <p className="text-sm text-sub">Confirming your email…</p>;
}

/** The sign-up trigger never fails over a taken name; it assigns frog_xxxxxxxx instead. Tell the user and offer a fix. */
function UsernameFallbackNotice({ wanted, actual, onChoose }: { wanted?: unknown; actual: string; onChoose: () => void }) {
  if (typeof wanted !== 'string' || wanted === actual || !/^frog_[0-9a-f]{8}$/.test(actual)) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-2 p-4 text-sm text-sub">
      <p>
        The username “{wanted}” was taken just before your account was created, so you're “{actual}” for now.
      </p>
      <Button variant="ghost" onClick={onChoose}>
        Choose a username
      </Button>
    </div>
  );
}

/** Shared shell for the two dashboard previews: the whole card is one link (stretched over the card), so nothing inside it is interactive. */
function PreviewCard({ to, icon, title, count, linkLabel, children }: { to: string; icon: ReactNode; title: string; count?: ReactNode; linkLabel: string; children: ReactNode }) {
  return (
    <Card className="group relative flex flex-col border border-brand/30 transition-colors hover:border-brand/70 hover:bg-surface/80 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-brand">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-brand" aria-hidden="true">{icon}</span>
        <h2 className="flex-1 text-lg font-medium text-text">{title}</h2>
        {count && <span className="text-sm text-sub tabular-nums">{count}</span>}
        <ChevronRight size={18} aria-hidden="true" className="text-sub transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
      </div>
      <div className="flex-1">{children}</div>
      <Link
        to={to}
        className="mt-4 inline-flex items-center justify-center gap-1 rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-text outline-none after:absolute after:inset-0 after:rounded-lg group-hover:text-brand"
      >
        {linkLabel} <ChevronRight size={14} aria-hidden="true" />
      </Link>
    </Card>
  );
}

const PREVIEW_ACHIEVEMENTS = 3;

function AchievementsPreview({ unlocked }: { unlocked: Progress['achievements'] }) {
  const earned = achievements.filter((a) => unlocked[a.id]).sort((a, b) => unlocked[b.id]!.localeCompare(unlocked[a.id]!));
  return (
    <PreviewCard to="/achievements" icon={<Trophy size={22} />} title="Achievements" count={`${earned.length} of ${achievements.length}`} linkLabel={`See all ${achievements.length}`}>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div className="h-full bg-brand" style={{ width: `${(earned.length / achievements.length) * 100}%` }} />
      </div>
      {earned.length === 0 ? (
        <p className="text-sm text-sub">None yet. Finish your first test to earn one.</p>
      ) : (
        <ul className="divide-y divide-surface-2" aria-label="Latest achievements">
          {earned.slice(0, PREVIEW_ACHIEVEMENTS).map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10">
                <AchievementIcon icon={a.icon} size={24} unlocked />
              </span>
              <span className="min-w-0 flex-1 truncate text-text">{a.title}</span>
              <span className="shrink-0 text-xs text-sub">{day(unlocked[a.id]!)}</span>
            </li>
          ))}
        </ul>
      )}
    </PreviewCard>
  );
}

const PREVIEW_TESTS = 20;

/** Avg wpm, time and words aren't in the stat row above, so the preview shows those plus a recent-wpm sparkline. */
function StatsPreview({ s, valid }: { s: Summary; valid: TestResult[] }) {
  const series = valid.slice(-PREVIEW_TESTS).map((t, i) => ({ n: i + 1, wpm: Math.round(t.wpm) }));
  return (
    <PreviewCard to="/stats" icon={<BarChart3 size={22} />} title="Statistics" count="All time" linkLabel="All statistics">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="avg wpm" value={s.avgWpm.toFixed(1)} />
        <Stat label="typing time" value={formatDuration(s.totalMs)} />
        <Stat label="words" value={s.totalWords} />
      </div>
      <h3 className="mt-4 mb-1 text-xs uppercase tracking-wider text-sub">WPM, last {Math.min(valid.length, PREVIEW_TESTS)} tests</h3>
      {series.length < 2 ? (
        <p className="py-6 text-center text-sm text-sub">Finish a couple of tests to see your trend.</p>
      ) : (
        <div className="h-24" role="img" aria-label={`WPM over your last ${series.length} tests`}>
          <ResponsiveContainer>
            <LineChart data={series} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
              <Line dataKey="wpm" stroke="var(--ft-brand)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </PreviewCard>
  );
}

function SyncPanel({ userId, pending }: { userId: string; pending: number }) {
  const sync = useSync();
  return (
    <Card>
      <h2 className="mb-2 text-lg font-medium text-text">Cloud sync</h2>
      <p className="text-sm text-sub">
        Sync: {sync.status}
        {sync.lastSyncAt && ` · last synced ${new Date(sync.lastSyncAt).toLocaleTimeString()}`}
        {pending > 0 && ` · ${pending} waiting to upload`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => void syncNow()} disabled={sync.status === 'syncing'}>
          {sync.status === 'syncing' ? 'Syncing…' : 'Sync now'}
        </Button>
        {getDecision(userId) === 'declined' && (
          <Button variant="ghost" onClick={offerMigrationAgain}>
            Import this browser's guest progress
          </Button>
        )}
      </div>
    </Card>
  );
}
