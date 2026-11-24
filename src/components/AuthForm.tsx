import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { Button, Notice } from './ui';
import { Field, PasswordField, PasswordRules } from './forms';
import { useUsernameStatus, usernameStatusText } from '../hooks/useUsernameStatus';
import {
  checkUsername,
  EMAIL_RE,
  EmailNotConfirmedError,
  passwordProblem,
  resendConfirmation,
  resetPassword,
  signIn,
  signUp,
  usernameProblem,
} from '../services/social';
import { errorMessage, rememberSession } from '../services/supabase';

type Msg = { text: string; tone: 'info' | 'warn' } | null;

/** Seconds left on a countdown; `start(n)` restarts it. */
function useCooldown(initial = 0): [number, (s: number) => void] {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);
  return [left, setLeft];
}

const RESEND_LIMIT = 5;

/**
 * Re-sends the sign-up confirmation email. Abuse protection: a cooldown that doubles after every send (60 s → 10 min),
 * at most five sends per visit, and GoTrue's own per-address and hourly email limits on the server.
 */
export function ResendButton({ email, initialCooldown = 60 }: { email: string; initialCooldown?: number }) {
  const [left, start] = useCooldown(initialCooldown);
  const [sent, setSent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const exhausted = sent >= RESEND_LIMIT;

  const resend = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await resendConfirmation(email);
      setSent((n) => n + 1);
      start(Math.min(60 * 2 ** sent, 600));
      setMsg({ text: 'If this address is waiting for confirmation, a new link is on its way. It can take a minute; check your spam folder too.', tone: 'info' });
    } catch (e) {
      start(60);
      setMsg({ text: errorMessage(e), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="ghost" onClick={() => void resend()} disabled={busy || left > 0 || exhausted || !EMAIL_RE.test(email.trim())}>
        {busy ? 'Sending…' : left > 0 ? `Resend email in ${left}s` : 'Resend confirmation email'}
      </Button>
      {exhausted && <p className="text-xs text-sub">You have requested several emails. Wait a while and check your spam folder before trying again.</p>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

// ---------------------------------------------------------------- sign in

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(rememberSession);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setMsg(null);
    setUnconfirmed(false);
    if (!email.trim() || !password) return setMsg({ text: 'Enter your email address and password.', tone: 'warn' });
    // Browsers that saved the FrogType username as the login (before the email was marked autocomplete="username") fill it here.
    if (!EMAIL_RE.test(email.trim())) return setMsg({ text: 'Sign in with the email address you created your account with, not your username.', tone: 'warn' });
    setBusy(true);
    try {
      await signIn(email, password, remember);
      // success: the auth listener updates the session and the page redirects
    } catch (err) {
      setUnconfirmed(err instanceof EmailNotConfirmedError);
      setMsg({ text: errorMessage(err), tone: 'warn' });
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Sign in" aria-busy={busy}>
      <div className="space-y-4">
        <Field label="Email" type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <label className="flex items-center gap-2 text-sub">
            <input type="checkbox" className="accent-[var(--ft-brand)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Keep me signed in
          </label>
          <Link to="/reset-password" className="text-sub underline-offset-2 hover:text-text hover:underline">
            Forgot password?
          </Link>
        </div>
      </div>
      {!remember && <p className="-mt-2 text-xs text-sub">You'll be signed out when you close this tab. Use this on shared computers.</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {unconfirmed && <ResendButton email={email} initialCooldown={0} />}
    </form>
  );
}

// ---------------------------------------------------------------- create account

type SignUpField = 'email' | 'username' | 'password' | 'confirm';

export function SignUpForm() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState<Partial<Record<SignUpField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [takenAtSubmit, setTakenAtSubmit] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const status = useUsernameStatus(username);

  const errors: Record<SignUpField, string | null> = {
    email: EMAIL_RE.test(email.trim()) ? null : 'Enter a valid email address.',
    username: usernameProblem(username) ?? (status === 'taken' || takenAtSubmit === username ? 'That username is taken. Try another.' : null),
    password: passwordProblem(password),
    confirm: confirm === password ? null : 'The passwords do not match.',
  };
  // Real-time: username is checked as you type, confirm once it is as long as the password; the rest on blur or submit.
  const live = (f: SignUpField) => (f === 'username' && username.length > 0) || (f === 'confirm' && confirm.length > 0 && confirm.length >= password.length);
  const shown = (f: SignUpField) => (submitted || touched[f] || live(f) ? errors[f] : null);
  const blur = (f: SignUpField) => () => setTouched((t) => ({ ...t, [f]: true }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setMsg(null);
    const firstBad = (Object.keys(errors) as SignUpField[]).find((f) => errors[f]);
    if (firstBad) {
      form.current?.querySelector<HTMLInputElement>(`[name="${firstBad}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      // final check: the debounced lookup may be stale or still running
      if ((await checkUsername(username)) === 'taken') {
        setTakenAtSubmit(username);
        return;
      }
      const { needsConfirmation } = await signUp(email, password, username);
      if (needsConfirmation) setSentTo(email.trim());
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  // after a "taken" answer at submit, put the cursor back on the username field
  useEffect(() => {
    if (takenAtSubmit && !busy) form.current?.querySelector<HTMLInputElement>('[name="username"]')?.focus();
  }, [takenAtSubmit, busy]);

  if (sentTo) return <SignUpSent email={sentTo} onBack={() => setSentTo(null)} />;

  return (
    <form ref={form} onSubmit={submit} noValidate className="space-y-4" aria-label="Create account" aria-busy={busy}>
      <div className="space-y-4">
        <Field
          label="Email"
          name="email"
          type="email"
          // The email is the login: password managers save the autocomplete="username" field with the password.
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={blur('email')}
          error={shown('email')}
          hint="We'll send a link to confirm it's yours."
        />
        <Field
          label="Username"
          name="username"
          autoComplete="nickname"
          autoCapitalize="off"
          spellCheck={false}
          required
          maxLength={20}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setTakenAtSubmit(null);
          }}
          onBlur={blur('username')}
          error={shown('username')}
          hint="3–20 letters, numbers or underscores. Shown on your public profile and leaderboards; hide either in Settings."
          status={shown('username') ? null : usernameStatusText(status)}
        />
        <div>
          <PasswordField
            label="Password"
            name="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={blur('password')}
            error={shown('password')}
            aria-describedby="signup-pw-rules"
          />
          <PasswordRules id="signup-pw-rules" password={password} />
        </div>
        <PasswordField
          label="Confirm password"
          name="confirm"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={blur('confirm')}
          error={shown('confirm')}
        />
      </div>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Creating account…' : 'Create account'}
      </Button>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </form>
  );
}

/** Confirmation screen after sign-up. Worded the same whether or not the address already had an account (no enumeration). */
function SignUpSent({ email, onBack }: { email: string; onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="space-y-4" data-testid="signup-sent">
      <div className="flex items-center gap-3">
        <MailCheck size={28} className="shrink-0 text-brand" aria-hidden="true" />
        <h2 ref={heading} tabIndex={-1} className="text-lg font-medium text-text outline-none">
          Check your email to confirm your account
        </h2>
      </div>
      <p className="text-sm text-sub">
        We sent a confirmation link to <strong className="break-all text-text">{email}</strong>.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-sub">
        <li>Open the email from FrogType. If it isn't there in a minute, check your spam folder.</li>
        <li>
          Select <span className="text-text">Confirm your email</span>. Open it in this browser to be signed in straight away; the link works once.
        </li>
        <li>Your guest progress stays on this device. After you sign in we'll ask whether to import it.</li>
      </ol>
      <p className="text-xs text-sub">
        Already have an account with this email?{' '}
        <Link to="/signin" className="underline">
          Sign in
        </Link>{' '}
        or{' '}
        <Link to="/reset-password" className="underline">
          reset your password
        </Link>{' '}
        instead.
      </p>
      <ResendButton email={email} />
      <button type="button" onClick={onBack} className="text-sm text-sub underline-offset-2 hover:text-text hover:underline">
        Use a different email address
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- password reset request

export function ResetRequestForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [left, start] = useCooldown();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setMsg({ text: 'Enter a valid email address.', tone: 'warn' });
    setBusy(true);
    setMsg(null);
    try {
      await resetPassword(email);
      start(60);
      setMsg({ text: 'If that email has an account, a reset link is on its way.', tone: 'info' });
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="max-w-sm space-y-4" aria-label="Reset password">
      <Field label="Email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy || left > 0}>
          {busy ? 'Sending…' : left > 0 ? `Send again in ${left}s` : 'Send reset link'}
        </Button>
        <Link to="/signin" className="text-sm text-sub hover:text-text">
          Back to sign in
        </Link>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </form>
  );
}
