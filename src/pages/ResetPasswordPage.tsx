import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResetRequestForm } from '../components/AuthForm';
import { PasswordField, PasswordRules } from '../components/forms';
import { Button, Card, Notice, PageTitle } from '../components/ui';
import { authStore, useAuth } from '../state/auth';
import { passwordProblem, updatePassword } from '../services/social';
import { errorMessage, isSupabaseConfigured, landingAuth } from '../services/supabase';

/** FT-04: landing page for password-recovery links. Only a recovery session can set a new password here. */
export default function ResetPasswordPage() {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);
  const [done, setDone] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  // The recovery event can arrive just after the session is restored; give a link a moment before calling it invalid.
  useEffect(() => {
    if (!landingAuth.hadCode) return;
    const id = window.setTimeout(() => setGaveUp(true), 3000);
    return () => window.clearTimeout(id);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = passwordProblem(password) ?? (password !== confirm ? 'The passwords do not match.' : null);
    if (bad) return setMsg({ text: bad, tone: 'warn' });
    setBusy(true);
    setMsg(null);
    try {
      await updatePassword(password);
      authStore.set({ recovery: false });
      setDone(true);
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (!isSupabaseConfigured) body = <Notice>Accounts are not configured on this installation.</Notice>;
  else if (done)
    body = (
      <div className="space-y-3" data-testid="reset-done">
        <Notice>Your password has been changed and other devices were signed out.</Notice>
        <Link to="/profile" className="text-brand underline">Go to your profile</Link>
      </div>
    );
  else if (auth.recovery)
    body = (
      <form onSubmit={submit} noValidate className="max-w-sm space-y-3" aria-label="Choose a new password">
        <div>
          <PasswordField label="New password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="pw-rules" />
          <PasswordRules id="pw-rules" password={password} />
        </div>
        <PasswordField label="Confirm new password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </form>
    );
  else if (landingAuth.error || (landingAuth.hadCode && auth.ready && gaveUp))
    body = (
      <div className="space-y-4" data-testid="reset-invalid">
        <Notice tone="warn">This reset link is invalid, has already been used, or has expired. Request a new one below (links work once, for 15 minutes, in the browser that requested them).</Notice>
        <ResetRequestForm />
      </div>
    );
  else if (landingAuth.hadCode) body = <p className="text-sub">Checking your link…</p>;
  else
    body = (
      <div className="space-y-4">
        <p className="text-sm text-sub">Open the reset link from your email to choose a new password, or request a new link.</p>
        <ResetRequestForm />
      </div>
    );

  return (
    <div>
      <PageTitle>Reset password</PageTitle>
      <Card>{body}</Card>
    </div>
  );
}
