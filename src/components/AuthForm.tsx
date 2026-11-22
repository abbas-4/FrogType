import { useState } from 'react';
import { Button, Notice } from './ui';
import { resetPassword, signIn, signUp } from '../services/social';
import { errorMessage } from '../services/supabase';

export function AuthForm() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'signin') await signIn(email, password);
      else if (mode === 'signup') {
        const { needsConfirmation } = await signUp(email, password, username);
        if (needsConfirmation) setMsg({ text: 'Check your email to confirm your account, then sign in.', tone: 'info' });
      } else {
        await resetPassword(email);
        setMsg({ text: 'If that email has an account, a reset link is on its way.', tone: 'info' });
      }
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const input = 'mt-1 w-full rounded-lg bg-surface-2 px-3 py-2 text-text';
  return (
    <form onSubmit={submit} className="max-w-sm space-y-3" aria-label={mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Reset password' : 'Sign in'}>
      <div className="flex gap-4 text-sm">
        {(['signin', 'signup'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={mode === m ? 'text-brand' : 'text-sub hover:text-text'}>
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <label className="block text-sm text-sub">
        Email
        <input className={input} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {mode === 'signup' && (
        <label className="block text-sm text-sub">
          Username
          <input className={input} required pattern="[A-Za-z0-9_]{3,20}" title="3–20 letters, numbers or underscores" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
      )}
      {mode !== 'reset' && (
        <label className="block text-sm text-sub">
          Password
          <input className={input} type="password" required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      )}
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </Button>
        {mode === 'signin' && (
          <button type="button" className="text-sm text-sub hover:text-text" onClick={() => setMode('reset')}>
            Forgot password?
          </button>
        )}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </form>
  );
}
