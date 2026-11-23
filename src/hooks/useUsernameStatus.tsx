import { useEffect, useState } from 'react';
import { checkUsername, usernameProblem } from '../services/social';

export type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'unknown';

/** Debounced availability lookup for a well-formed username. `current` (the user's own name) is never "taken". */
export function useUsernameStatus(username: string, current?: string): UsernameStatus {
  const [checked, setChecked] = useState<{ name: string; result: UsernameStatus } | null>(null);
  const skip = usernameProblem(username) !== null || username === current;
  useEffect(() => {
    if (skip) return;
    let live = true;
    const t = window.setTimeout(async () => {
      const r = await checkUsername(username);
      if (live) setChecked({ name: username, result: r === 'invalid' ? 'idle' : r });
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [username, skip]);
  if (skip) return 'idle';
  return checked?.name === username ? checked.result : 'checking';
}

export function usernameStatusText(s: UsernameStatus) {
  if (s === 'checking') return <span className="text-sub">Checking availability…</span>;
  if (s === 'available') return <span className="text-brand">✓ Username is available</span>;
  if (s === 'unknown') return <span className="text-sub">Couldn't check availability right now. We'll check again when you submit.</span>;
  return null;
}
