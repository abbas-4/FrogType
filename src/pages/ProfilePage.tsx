import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Medal, Pencil } from 'lucide-react';
import { AchievementIcon } from '../components/AchievementIcon';
import { Avatar } from '../components/Avatar';
import { ProfileEditor } from '../components/ProfileEditor';
import { ResendButton } from '../components/AuthForm';
import { Field } from '../components/forms';
import { Button, Card, Notice, Stat } from '../components/ui';
import { achievements } from '../domain/achievements';
import { modeLabel } from '../domain/format';
import { levelFromXp, totalXp } from '../domain/progression';
import { summarize } from '../domain/stats';
import { useAuth } from '../state/auth';
import { useProgress } from '../state/store';
import { pushToast } from '../state/toasts';
import { isSupabaseConfigured, landingAuth } from '../services/supabase';
import { getDecision, offerMigrationAgain, syncNow, useSync } from '../services/sync';
import type { Progress } from '../types';

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
        <EarnedAchievements unlocked={progress.achievements} />
        <RecentActivity history={progress.history} />
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
      <div className="space-y-3 rounded-xl border border-error/40 p-4" data-testid="confirm-invalid">
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
      <div className="rounded-xl border border-surface-2 p-4 text-sm text-sub" data-testid="confirm-other-browser">
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-2 p-4 text-sm text-sub">
      <p>
        The username “{wanted}” was taken just before your account was created, so you're “{actual}” for now.
      </p>
      <Button variant="ghost" onClick={onChoose}>
        Choose a username
      </Button>
    </div>
  );
}

function EarnedAchievements({ unlocked }: { unlocked: Progress['achievements'] }) {
  const earned = achievements.filter((a) => unlocked[a.id]).sort((a, b) => unlocked[b.id]!.localeCompare(unlocked[a.id]!));
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-text">Achievements</h2>
        <Link to="/achievements" className="text-sm text-sub hover:text-text">
          See all {achievements.length}
        </Link>
      </div>
      {earned.length === 0 ? (
        <p className="text-sm text-sub">None yet. Finish your first test to earn one.</p>
      ) : (
        <ul className="space-y-2" aria-label="Earned achievements">
          {earned.map((a) => (
            <li key={a.id} className="flex items-center gap-3 text-sm">
              <span className="text-brand">
                <AchievementIcon icon={a.icon} size={20} />
              </span>
              <span className="flex-1 text-text">{a.title}</span>
              <span className="text-xs text-sub">{day(unlocked[a.id]!)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentActivity({ history }: { history: Progress['history'] }) {
  const recent = history
    .filter((t) => t.valid)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-text">Recent activity</h2>
        <Link to="/stats" className="text-sm text-sub hover:text-text">
          All statistics
        </Link>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-sub">
          No tests yet.{' '}
          <Link to="/" className="text-brand underline">
            Take your first test
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-surface-2" aria-label="Recent tests">
          {recent.map((t) => (
            <li key={t.id}>
              <Link to={`/history/${t.id}`} className="flex items-center gap-3 py-2 text-sm hover:text-brand">
                <span className="w-24 shrink-0 text-xs text-sub">{day(t.createdAt)}</span>
                <span className="flex-1 truncate text-sub">{modeLabel(t)}</span>
                <span className="w-16 text-right text-text tabular-nums">{Math.round(t.wpm)} wpm</span>
                <span className="w-12 text-right text-sub tabular-nums">{Math.floor(t.accuracy)}%</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
