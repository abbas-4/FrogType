import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, Settings as SettingsIcon, User } from 'lucide-react';
import { Avatar } from './Avatar';
import { useAuth } from '../state/auth';
import { signOutWithToast } from '../services/social';
import { isSupabaseConfigured } from '../services/supabase';

const item = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text transition-colors hover:bg-brand/10 hover:text-brand focus-visible:bg-brand/10';

/**
 * Header account control: "Sign in" / "Create account" for guests, or the user's avatar with a small disclosure menu
 * (Profile, Settings, Sign out). Escape or a click outside closes it and returns focus to the button.
 */
export function AccountMenu() {
  const auth = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (!isSupabaseConfigured) return null;
  if (!auth.ready) return <span className="h-8 w-16" aria-hidden="true" />;

  if (!auth.user) {
    return (
      <div className="flex items-center gap-1 text-sm">
        <NavLink to="/signin" state={{ from: location.pathname }} className="rounded-lg px-3 py-1.5 text-sub transition-colors hover:bg-brand/5 hover:text-brand">
          Sign in
        </NavLink>
        <NavLink to="/signup" className="hidden rounded-lg border border-brand/40 px-3 py-1.5 text-brand transition-colors hover:bg-brand/10 lg:inline-flex">
          Create account
        </NavLink>
      </div>
    );
  }

  const name = auth.profile?.username ?? '';
  const close = () => setOpen(false);
  return (
    <div
      className="relative"
      onBlur={(e) => {
        // Tab moved focus out. A null relatedTarget is a click (Safari/macOS Firefox don't focus links on mousedown):
        // closing then would hide the panel before the click lands; outside clicks close via pointerdown instead.
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={name ? `Account: ${name}` : 'Account'}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-lg px-1.5 text-sm text-sub transition-colors hover:bg-brand/5 hover:text-text"
      >
        <Avatar avatar={auth.profile?.avatar} username={name || '?'} size="sm" />
        {name && <span className="hidden max-w-32 truncate text-text lg:inline">{name}</span>}
        <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div ref={panel} id="account-menu" hidden={!open} className="absolute top-full right-0 z-50 mt-2 w-60 rounded-xl border border-surface-2 bg-surface p-1.5 shadow-xl">
        <div className="mb-1 border-b border-surface-2 px-3 pt-1 pb-2">
          <div className="truncate text-sm text-text">{name}</div>
          <div className="truncate text-xs text-sub">{auth.user.email}</div>
        </div>
        <Link to="/profile" onClick={close} className={item}>
          <User size={16} aria-hidden="true" /> Profile
        </Link>
        <Link to="/settings" onClick={close} className={item}>
          <SettingsIcon size={16} aria-hidden="true" /> Settings
        </Link>
        <button
          type="button"
          className={item}
          onClick={() => {
            close();
            void signOutWithToast();
          }}
        >
          <LogOut size={16} aria-hidden="true" /> Sign out
        </button>
      </div>
    </div>
  );
}
