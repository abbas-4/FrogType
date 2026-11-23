import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Field, PasswordField, PasswordRules } from './forms';
import { ProfileEditor } from './ProfileEditor';
import { Button, Card, Notice } from './ui';
import { useAuth } from '../state/auth';
import { pushToast } from '../state/toasts';
import { changeEmail, changePassword, deleteAccount, EMAIL_RE, MIN_PASSWORD_LENGTH, passwordProblem, signOut } from '../services/social';
import { exportMyData } from '../services/cloud';
import { errorMessage, isSupabaseConfigured, landingAuth } from '../services/supabase';
import { clearDecision } from '../services/sync';
import { removeProgress } from '../persistence/storage';
import { useProgress } from '../state/store';

type Msg = { text: string; tone: 'info' | 'warn' } | null;

const h2 = 'mb-1 text-lg font-medium text-text';
const h3 = 'font-medium text-text';

/** Account card for guests: what an account adds, and where to get one. */
export function GuestAccountSettings() {
  const auth = useAuth();
  return (
    <Card>
      <h2 id="account" className={h2}>
        Account
      </h2>
      {!isSupabaseConfigured ? (
        <p className="text-sm text-sub">Accounts are not configured on this installation, so everything stays in this browser.</p>
      ) : !auth.ready ? (
        <p className="text-sm text-sub">Loading…</p>
      ) : (
        <>
          <p className="text-sm text-sub">You're using FrogType as a guest; progress is saved in this browser only. An account is optional and free.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/signup" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-bg hover:bg-brand-hover">
              Create account
            </Link>
            <Link to="/signin" state={{ from: '/settings' }} className="rounded-lg bg-surface-2 px-4 py-2 text-sm text-text">
              Sign in
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}

/** Account, email, password and sign-out for a signed-in user. Privacy and data live in their own cards on the page. */
export function AccountSettings() {
  const auth = useAuth();
  const user = auth.user!;
  return (
    <Card>
      <h2 id="account" className={h2}>
        Account
      </h2>
      <p className="text-sm text-sub">
        Signed in as <span className="break-all text-text">{user.email}</span>
      </p>
      <EmailChangeLanding />
      <div className="mt-6 space-y-8 divide-y divide-surface-2 [&>*]:pt-6 [&>*:first-child]:pt-0">
        <section aria-labelledby="profile-info">
          <h3 id="profile-info" className={`${h3} mb-3`}>
            Profile information
          </h3>
          {auth.profile ? <ProfileEditor userId={user.id} profile={auth.profile} /> : <p className="text-sm text-sub">Loading…</p>}
        </section>
        <EmailSection email={user.email ?? ''} pendingEmail={user.new_email} />
        <PasswordSection email={user.email ?? ''} />
        <SignOutSection userId={user.id} />
      </div>
    </Card>
  );
}

/** Email-change links land on /settings: the first confirms one address, the second (PKCE code) completes the change. */
function EmailChangeLanding() {
  const location = useLocation();
  const auth = useAuth();
  if (landingAuth.path !== '/settings' || location.key !== 'default') return null;
  if (landingAuth.error) return <div className="mt-3"><Notice tone="warn">That email-change link is invalid or has expired. Start the change again below.</Notice></div>;
  if (landingAuth.message)
    return (
      <div className="mt-3">
        <Notice>One address confirmed. Now open the link we sent to the other address to finish changing your email.</Notice>
      </div>
    );
  if (landingAuth.hadCode && auth.user)
    return (
      <div className="mt-3">
        <Notice>Your email address has been changed to {auth.user.email}.</Notice>
      </div>
    );
  return null;
}

function EmailSection({ email, pendingEmail }: { email: string; pendingEmail?: string }) {
  const [next, setNext] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [touched, setTouched] = useState(false);
  const emailError = touched && !EMAIL_RE.test(next.trim()) ? 'Enter a valid email address.' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    if (!EMAIL_RE.test(next.trim()) || !password) return;
    setBusy(true);
    setMsg(null);
    try {
      await changeEmail(email, password, next);
      setMsg({ text: `Almost done. We sent confirmation links to ${email} and ${next.trim()}; open both to finish. Until then you sign in with ${email}.`, tone: 'info' });
      setNext('');
      setPassword('');
      setTouched(false);
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="email-h">
      <h3 id="email-h" className={h3}>
        Email address
      </h3>
      <p className="mt-1 text-sm text-sub">
        Current: <span className="break-all text-text">{email}</span>
        {pendingEmail && (
          <>
            {' '}
            · waiting for confirmation of <span className="break-all text-text">{pendingEmail}</span>
          </>
        )}
      </p>
      <form onSubmit={submit} noValidate className="mt-3 max-w-md space-y-3" aria-label="Change email">
        <div className="space-y-3">
          <Field label="New email" type="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} onBlur={() => setTouched(true)} error={emailError} />
          <PasswordField label="Current password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="Required to change your email." />
        </div>
        <Button type="submit" disabled={busy || !next || !password}>
          {busy ? 'Sending links…' : 'Change email'}
        </Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </form>
    </section>
  );
}

function PasswordSection({ email }: { email: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [submitted, setSubmitted] = useState(false);
  const nextError = (submitted || next.length >= MIN_PASSWORD_LENGTH) && next ? passwordProblem(next) : submitted && !next ? 'Enter a new password.' : null;
  const confirmError = (submitted || confirm.length >= next.length) && confirm !== next ? 'The passwords do not match.' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    if (!current || passwordProblem(next) || next !== confirm) return;
    setBusy(true);
    setMsg(null);
    try {
      await changePassword(email, current, next);
      setMsg({ text: 'Password changed. Other devices were signed out.', tone: 'info' });
      setCurrent('');
      setNext('');
      setConfirm('');
      setSubmitted(false);
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="password-h">
      <h3 id="password-h" className={h3}>
        Password
      </h3>
      <form onSubmit={submit} noValidate className="mt-3 max-w-md space-y-3" aria-label="Change password">
        <div className="space-y-3">
          <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={submitted && !current ? 'Enter your current password.' : null} />
          <div>
            <PasswordField label="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={nextError} aria-describedby="change-pw-rules" />
            <PasswordRules id="change-pw-rules" password={next} />
          </div>
          <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={confirmError} />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </form>
    </section>
  );
}

function SignOutSection({ userId }: { userId: string }) {
  const pending = useProgress().pendingSync.length;
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (forget: boolean) => {
    setMsg(null);
    try {
      await signOut();
      if (forget) {
        removeProgress(userId);
        clearDecision(userId);
      }
      pushToast('Signed out', forget ? 'Your data was removed from this browser. Your account is unchanged.' : undefined);
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <section aria-labelledby="signout-h">
      <h3 id="signout-h" className={h3}>
        Sign out
      </h3>
      <p className="mt-1 text-sm text-sub">On a shared computer, also remove your progress from this browser. It stays safe in your account.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => void run(false)}>
          Sign out
        </Button>
        <Button variant="ghost" disabled={pending > 0} onClick={() => void run(true)}>
          Sign out and remove my data from this browser
        </Button>
      </div>
      {pending > 0 && (
        <p className="mt-2 text-xs text-sub">
          Removing local data is available once your {pending} queued result{pending === 1 ? ' has' : 's have'} uploaded (see Profile → Cloud sync).
        </p>
      )}
      {msg && (
        <div className="mt-2">
          <Notice tone="warn">{msg}</Notice>
        </div>
      )}
    </section>
  );
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** FT-10: export and permanent deletion. Deletion needs the password (fresh sign-in) and the username typed out. */
export function AccountDataSettings() {
  const auth = useAuth();
  const userId = auth.user!.id;
  const email = auth.user!.email ?? '';
  const username = auth.profile?.username ?? '';
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
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
      pushToast('Account deleted', 'Your account and its data were permanently removed.');
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className={h3}>Your account data</h3>
      <p className="text-sm text-sub">Download everything stored in your account, or delete the account permanently.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy !== null} onClick={() => void doExport()}>
          {busy === 'export' ? 'Preparing…' : 'Download my data (JSON)'}
        </Button>
        {!confirming && (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete account…
          </Button>
        )}
      </div>
      {confirming && (
        <form onSubmit={doDelete} className="max-w-md space-y-3 rounded-lg border border-error/40 p-4" aria-label="Delete account">
          <p className="text-sm text-sub">
            This permanently deletes your account, test history, XP, achievements, lesson progress, leaderboard entries and friendships from the server. It cannot be undone.
            Nothing is kept except standard backups held by the hosting provider until they expire. Download your data first if you want a copy.
          </p>
          <Field label={`Type your username (${username}) to confirm`} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <PasswordField label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={busy !== null || typed !== username || !password}>
              {busy === 'delete' ? 'Deleting…' : 'Permanently delete'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
