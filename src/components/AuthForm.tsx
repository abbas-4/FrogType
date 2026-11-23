import { useState } from 'react';
import { Button, Notice } from './ui';
import { resetPassword, signIn, signUp } from '../services/social';
import { errorMessage } from '../services/supabase';

export function AuthForm({ initialMode = 'signin' }: { initialMode?: 'signin' | 'signup' | 'reset' }) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  // FT-07: visibility is opt-in, unchecked by default
  const [publicProfile, setPublicProfile] = useState(false);
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'signin') await signIn(email, password);
      else if (mode === 'signup') {
        const { needsConfirmation } = await signUp(email, password, username, { publicProfile, showOnLeaderboard });
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
          <input
            className={input}
            type="password"
            required
            minLength={mode === 'signup' ? 10 : undefined}
            maxLength={72}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            aria-describedby={mode === 'signup' ? 'pw-rules' : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}
      {mode === 'signup' && (
        <p id="pw-rules" className="-mt-2 text-xs text-sub">At least 10 characters with an uppercase letter, a lowercase letter and a number.</p>
      )}
      {mode === 'signup' && (
        <fieldset className="space-y-2 text-sm text-sub">
          <legend className="mb-1">Privacy (you can change these any time in Settings)</legend>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 accent-[var(--ft-brand)]" checked={publicProfile} onChange={(e) => setPublicProfile(e.target.checked)} />
            <span>Make my profile public (others can see my stats and achievements)</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 accent-[var(--ft-brand)]" checked={showOnLeaderboard} onChange={(e) => setShowOnLeaderboard(e.target.checked)} />
            <span>Show my username and best results on public leaderboards</span>
          </label>
        </fieldset>
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
