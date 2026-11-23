import { Link, Navigate, useLocation } from 'react-router-dom';
import { SignInForm, SignUpForm } from '../components/AuthForm';
import { Card, Notice } from '../components/ui';
import { useAuth } from '../state/auth';
import { isSupabaseConfigured } from '../services/supabase';
import { safeReturnPath } from '../domain/returnPath';

export default function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const auth = useAuth();
  const location = useLocation();
  const back = safeReturnPath((location.state as { from?: unknown } | null)?.from);

  if (auth.user) return <Navigate to={back} replace />;

  const tab = (to: string, label: string, active: boolean) => (
    <Link
      to={to}
      state={location.state}
      replace
      aria-current={active ? 'page' : undefined}
      className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm transition-colors ${active ? 'bg-surface-2 text-text' : 'text-sub hover:text-text'}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-2xl font-semibold text-text">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
      <p className="mt-1 mb-6 text-sm text-sub">
        Accounts are optional. Sign in to sync your progress across devices, keep a public profile and appear on leaderboards.
      </p>
      {!isSupabaseConfigured ? (
        <Notice>
          Accounts are not configured on this installation, so your progress is stored only in this browser. To enable sign-in, set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> (see README).
        </Notice>
      ) : !auth.ready ? (
        <p className="text-sub">Loading…</p>
      ) : (
        <Card>
          <nav aria-label="Account" className="mb-5 flex gap-1 rounded-lg bg-bg/40 p-1">
            {tab('/signin', 'Sign in', mode === 'signin')}
            {tab('/signup', 'Create account', mode === 'signup')}
          </nav>
          {mode === 'signin' ? <SignInForm /> : <SignUpForm />}
        </Card>
      )}
      <p className="mt-4 text-center text-xs text-sub">
        <Link to="/" className="hover:text-text">
          Continue as a guest
        </Link>{' '}
        · your tests are saved in this browser.
      </p>
    </div>
  );
}
