import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthForm } from '../components/AuthForm';
import { Button, Card, Notice, PageTitle, Stat } from '../components/ui';
import { levelFromXp, totalXp } from '../domain/progression';
import { summarize } from '../domain/stats';
import { loadProfile, useAuth } from '../state/auth';
import { useProgress } from '../state/store';
import { deleteAccount, signOut, updateProfile, USERNAME_RE } from '../services/social';
import { exportMyData } from '../services/cloud';
import { errorMessage, isSupabaseConfigured } from '../services/supabase';
import { clearDecision, getDecision, offerMigrationAgain, syncNow, useSync } from '../services/sync';
import { removeProgress } from '../persistence/storage';

export default function ProfilePage() {
  const progress = useProgress();
  const auth = useAuth();
  const sync = useSync();
  const now = useMemo(() => new Date(), []);
  const valid = progress.history.filter((t) => t.valid);
  const s = summarize(valid, progress.history, now);
  const xp = totalXp(progress.xp);
  const lvl = levelFromXp(xp);
  const name = auth.profile?.username ?? 'Guest';
  const since = auth.profile?.created_at ?? valid[0]?.createdAt;

  return (
    <div>
      <PageTitle>Profile</PageTitle>
      <div className="mb-6 flex items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/15 text-2xl font-semibold text-brand" aria-hidden="true">
          {name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <div className="text-xl font-semibold text-text">{name}</div>
          <div className="text-sm text-sub">
            Level {lvl.level} · {xp} XP{since ? ` · ${auth.profile ? 'joined' : 'since'} ${new Date(since).toLocaleDateString()}` : ''}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Card><Stat label="best wpm" value={s.bestWpm.toFixed(1)} /></Card>
        <Card><Stat label="avg accuracy" value={`${s.avgAccuracy.toFixed(1)}%`} /></Card>
        <Card><Stat label="tests" value={s.tests} /></Card>
        <Card><Stat label="streak" value={`${s.currentStreak}d`} /></Card>
        <Card><Stat label="total xp" value={xp} /></Card>
        <Card><Stat label="achievements" value={Object.keys(progress.achievements).length} /></Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-3 text-lg font-medium text-text">Account</h2>
        {!isSupabaseConfigured ? (
          <Notice>
            Accounts are not configured on this installation, so your progress is stored only in this browser. To enable sign-in, sync, leaderboards and friends,
            set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README).
          </Notice>
        ) : !auth.ready ? (
          <p className="text-sub">Loading…</p>
        ) : !auth.user ? (
          <>
            <p className="mb-4 text-sm text-sub">Accounts are optional. Sign in to sync across devices, appear on leaderboards and add friends.</p>
            <AuthForm />
          </>
        ) : (
          <AccountPanel email={auth.user.email ?? ''} userId={auth.user.id} pending={progress.pendingSync.length} />
        )}
        {auth.user && (
          <div className="mt-6 border-t border-surface-2 pt-4 text-sm text-sub">
            <p>
              Sync: {sync.status}
              {sync.lastSyncAt && ` · last synced ${new Date(sync.lastSyncAt).toLocaleTimeString()}`}
              {progress.pendingSync.length > 0 && ` · ${progress.pendingSync.length} waiting to upload`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void syncNow()}>Sync now</Button>
              {getDecision(auth.user.id) === 'declined' && (
                <Button variant="ghost" onClick={offerMigrationAgain}>Upload this device's local progress</Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Signs out; optionally removes this account's local copy so the next person on a shared browser starts clean. */
async function signOutAndMaybeForget(userId: string, forget: boolean) {
  await signOut();
  if (forget) {
    removeProgress(userId);
    clearDecision(userId);
  }
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function AccountPanel({ email, userId, pending }: { email: string; userId: string; pending: number }) {
  const auth = useAuth();
  const [username, setUsername] = useState(auth.profile?.username ?? '');
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile(userId, { username });
      await loadProfile();
      setMsg({ text: 'Saved.', tone: 'info' });
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-sub">Signed in as {email}</p>
      <form onSubmit={save} className="flex max-w-md items-end gap-2">
        <label className="flex-1 text-sm text-sub">
          Username
          <input
            className="mt-1 w-full rounded-lg bg-surface-2 px-3 py-2 text-text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            pattern="[A-Za-z0-9_]{3,20}"
            title="3–20 letters, numbers or underscores"
          />
        </label>
        <Button type="submit" disabled={!USERNAME_RE.test(username) || username === auth.profile?.username}>Save</Button>
      </form>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        {auth.profile && (
          <Link to={`/u/${auth.profile.username}`} className="rounded-lg bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface">
            View public profile
          </Link>
        )}
        <Link to="/settings#privacy" className="rounded-lg bg-surface-2 px-4 py-2 text-sm text-text hover:bg-surface">
          Privacy settings
        </Link>
        <Button variant="ghost" onClick={() => void signOut().catch((e) => setMsg({ text: errorMessage(e), tone: 'warn' }))}>Sign out</Button>
        <Button
          variant="ghost"
          disabled={pending > 0}
          onClick={() => void signOutAndMaybeForget(userId, true).catch((e) => setMsg({ text: errorMessage(e), tone: 'warn' }))}
        >
          Sign out and remove my data from this browser
        </Button>
      </div>
      {pending > 0 && <p className="text-xs text-sub">Removing local data is available once your {pending} queued result{pending === 1 ? ' has' : 's have'} uploaded.</p>}
      <DataPanel email={email} userId={userId} username={auth.profile?.username ?? ''} />
    </div>
  );
}

/** FT-10: export and permanent deletion. Deletion needs the password (fresh sign-in) and the username typed out. */
function DataPanel({ email, userId, username }: { email: string; userId: string; username: string }) {
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');

  const doExport = async () => {
    setBusy('export');
    setMsg(null);
    try {
      download(`frogtype-export-${new Date().toISOString().slice(0, 10)}.json`, await exportMyData(userId));
    } catch (e) {
      setMsg({ text: `Export failed: ${errorMessage(e)}`, tone: 'warn' });
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('delete');
    setMsg(null);
    try {
      await deleteAccount(email, password, typed);
      removeProgress(userId);
      clearDecision(userId);
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
      setBusy(null);
    }
  };

  const input = 'mt-1 w-full rounded-lg bg-surface-2 px-3 py-2 text-text';
  return (
    <div className="mt-6 space-y-3 border-t border-surface-2 pt-4">
      <h3 className="font-medium text-text">Your data</h3>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy !== null} onClick={() => void doExport()}>{busy === 'export' ? 'Preparing…' : 'Download my data (JSON)'}</Button>
        {!confirming && <Button variant="danger" onClick={() => setConfirming(true)}>Delete account…</Button>}
      </div>
      {confirming && (
        <form onSubmit={doDelete} className="max-w-md space-y-3 rounded-lg border border-error/40 p-4" aria-label="Delete account">
          <p className="text-sm text-sub">
            This permanently deletes your account, test history, XP, achievements, lesson progress, leaderboard entries and friendships from the server. It
            cannot be undone. Nothing is kept except standard backups held by the hosting provider until they expire. Download your data first if you want a copy.
          </p>
          <label className="block text-sm text-sub">
            Type your username (<code>{username}</code>) to confirm
            <input className={input} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <label className="block text-sm text-sub">
            Password
            <input className={input} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={busy !== null || typed !== username || !password}>{busy === 'delete' ? 'Deleting…' : 'Permanently delete'}</Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
