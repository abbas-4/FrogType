// Account menu, session-ended banner, profile editor and updateProfile, with a configured-but-mocked Supabase client.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AccountMenu } from '../src/components/AccountMenu';
import { Layout } from '../src/components/Layout';
import { ProfileEditor } from '../src/components/ProfileEditor';
import { AVATARS } from '../src/domain/avatars';
import SettingsPage from '../src/pages/SettingsPage';
import { applyIdentity, authStore, expectSignOut, loadProfile, type Profile } from '../src/state/auth';
import { takeExpectedSignOut } from '../src/state/signOutIntent';
import { updateProfile } from '../src/services/social';

const h = vi.hoisted(() => ({
  updates: [] as { table: string; patch: unknown; id: unknown }[],
  updateError: null as null | { code?: string; message: string },
  signOuts: 0,
  /** The signed-in user's stored profiles row (null: none). Updates merge into it; selects return it. */
  row: null as null | Record<string, unknown>,
  selectError: null as null | { message: string },
}));

vi.mock('../src/services/supabase', () => {
  const client = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => {
        h.signOuts++;
        return { error: null };
      },
    },
    from: (table: string) => ({
      update: (patch: unknown) => ({
        eq: async (_col: string, id: unknown) => {
          h.updates.push({ table, patch, id });
          const row = h.row;
          if (!h.updateError && row && row.id === id) Object.assign(row, patch as object);
          return { error: h.updateError };
        },
      }),
      select: () => ({ eq: () => ({ maybeSingle: async () => (h.selectError ? { data: null, error: h.selectError } : { data: h.row ? { ...h.row } : null, error: null }) }) }),
    }),
    rpc: async () => ({ data: true, error: null }),
  };
  return {
    supabase: client,
    isSupabaseConfigured: true,
    requireClient: () => client,
    pinnedClient: () => client,
    errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    rememberSession: () => true,
    setRememberSession: () => {},
    landingAuth: { path: '/', hadCode: false, error: null, message: null },
  };
});

vi.mock('../src/services/social', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/social')>();
  return { ...real, updateProfile: vi.fn(real.updateProfile) };
});

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const alice = { id: A, email: 'alice@frog.test' } as User;
const profile: Profile = { id: A, username: 'alice', is_public: false, show_on_leaderboard: false, avatar: null, bio: null, created_at: '2026-01-01T00:00:00Z' };

beforeEach(() => {
  h.updates = [];
  h.updateError = null;
  h.signOuts = 0;
  h.row = null;
  h.selectError = null;
  takeExpectedSignOut(); // no intent left over from an earlier test
  applyIdentity(null, 'SIGNED_OUT');
  authStore.set({ ready: true, user: null, profile: null, sessionEnded: false });
  vi.mocked(updateProfile).mockClear();
});

const signInAlice = () => {
  applyIdentity(alice, 'SIGNED_IN');
  authStore.set({ profile });
};

function renderMenu() {
  render(
    <MemoryRouter>
      <AccountMenu />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('AccountMenu', () => {
  it('shows Sign in and Create account to guests', () => {
    renderMenu();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/signup');
    expect(screen.queryByRole('button', { name: /Account/ })).not.toBeInTheDocument();
  });

  it('opens a menu with Profile, Settings and Sign out; Escape closes it and returns focus', async () => {
    signInAlice();
    const user = renderMenu();
    const button = screen.getByRole('button', { name: 'Account: alice' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument(); // hidden while closed

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('stays open when a click blurs a menu item without moving focus (Safari), closes when focus leaves', async () => {
    signInAlice();
    const user = renderMenu();
    const button = screen.getByRole('button', { name: 'Account: alice' });
    await user.click(button);
    fireEvent.blur(screen.getByRole('link', { name: 'Profile' }), { relatedTarget: null });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.blur(screen.getByRole('link', { name: 'Profile' }), { relatedTarget: document.body });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('Sign out signs out and the following SIGNED_OUT is not reported as an ended session', async () => {
    signInAlice();
    const user = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Account: alice' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(h.signOuts).toBe(1));
    applyIdentity(null, 'SIGNED_OUT');
    expect(authStore.get().sessionEnded).toBe(false);
  });
});

describe('session expiry', () => {
  it('a SIGNED_OUT nobody asked for marks the session as ended', () => {
    applyIdentity(alice, 'SIGNED_IN');
    expect(authStore.get().sessionEnded).toBe(false);
    applyIdentity(null, 'SIGNED_OUT');
    expect(authStore.get().sessionEnded).toBe(true);
    applyIdentity(alice, 'SIGNED_IN');
    expect(authStore.get().sessionEnded).toBe(false); // cleared on the next sign-in
  });

  it('an expected sign-out does not', () => {
    applyIdentity(alice, 'SIGNED_IN');
    expectSignOut();
    applyIdentity(null, 'SIGNED_OUT');
    expect(authStore.get().sessionEnded).toBe(false);
  });

  it('a SIGNED_OUT while already signed out is not an ended session', () => {
    applyIdentity(null, 'SIGNED_OUT');
    expect(authStore.get().sessionEnded).toBe(false);
  });

  it('Layout shows the signed-out banner with Sign in again, and Dismiss hides it', async () => {
    applyIdentity(alice, 'SIGNED_IN');
    applyIdentity(null, 'SIGNED_OUT');
    render(
      <MemoryRouter initialEntries={['/stats']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<h1>page</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("You've been signed out.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/signin');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText("You've been signed out.")).not.toBeInTheDocument();
    expect(authStore.get().sessionEnded).toBe(false);
  });
});

describe('ProfileEditor', () => {
  function renderEditor() {
    signInAlice();
    render(<ProfileEditor userId={A} profile={profile} />);
    return userEvent.setup();
  }

  it('saves only the changed fields (avatar and normalised bio)', async () => {
    const user = renderEditor();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled(); // nothing changed yet
    await user.click(screen.getByRole('radio', { name: 'Cat' }));
    await user.type(screen.getByLabelText(/Bio/), '  Learning   to type ');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(updateProfile).toHaveBeenCalledTimes(1);
    expect(updateProfile).toHaveBeenCalledWith(A, { avatar: 'cat', bio: 'Learning to type' });
    expect(h.updates).toEqual([{ table: 'profiles', patch: { avatar: 'cat', bio: 'Learning to type' }, id: A }]);
  });

  it('an invalid username blocks saving', async () => {
    const user = renderEditor();
    const name = screen.getByLabelText('Username');
    await user.clear(name);
    await user.type(name, 'bad name');
    await user.click(screen.getByRole('radio', { name: 'Cat' }));

    expect(screen.getByText('Use only letters, numbers and underscores.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Edit profile' })); // the submit handler guards too
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

describe('updateProfile', () => {
  it('rejects unknown avatar keys before any network call', async () => {
    await expect(updateProfile(A, { avatar: 'dragon' as never })).rejects.toThrow('Pick one of the built-in avatars.');
    expect(h.updates).toEqual([]);
  });

  it('rejects bios over 160 characters before any network call', async () => {
    await expect(updateProfile(A, { bio: 'x'.repeat(161) })).rejects.toThrow('Bio must be at most 160 characters.');
    expect(h.updates).toEqual([]);
  });

  it('normalises whitespace in the bio and stores an empty bio as null', async () => {
    await updateProfile(A, { bio: '  hi\n\tthere  ' });
    await updateProfile(A, { bio: '   ' });
    await updateProfile(A, { avatar: null });
    expect(h.updates.map((u) => u.patch)).toEqual([{ bio: 'hi there' }, { bio: null }, { avatar: null }]);
  });

  it('maps a unique violation to "That username is taken."', async () => {
    h.updateError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    await expect(updateProfile(A, { username: 'bob_frog' })).rejects.toThrow('That username is taken.');
  });

  it('maps the server rate limit to a friendly message', async () => {
    h.updateError = { message: 'rate limited: too many requests, try again later' };
    await expect(updateProfile(A, { username: 'bob_frog' })).rejects.toThrow(/too often today/);
  });
});

describe('avatar keys', () => {
  it('match the profiles_avatar_check constraint in the migration', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261124000000_account_profiles.sql'), 'utf8');
    const list = /profiles_avatar_check\s+check\s*\(\s*avatar is null or avatar in \(([^)]*)\)\s*\)/i.exec(sql)?.[1];
    expect(list).toBeDefined();
    expect([...list!.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...AVATARS]);
  });
});

describe('Settings → Privacy', () => {
  it('a new account starts with both on; each turns off and on independently and survives sign-out/sign-in', async () => {
    h.row = { ...profile, is_public: true, show_on_leaderboard: true }; // what the sign-up trigger creates
    applyIdentity(alice, 'SIGNED_IN');
    await loadProfile();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const pub = () => screen.getByRole('switch', { name: /^Public profile/ });
    const board = () => screen.getByRole('switch', { name: /^Show me on leaderboards/ });
    expect(pub()).toBeChecked();
    expect(board()).toBeChecked();

    await user.click(board());
    await waitFor(() => expect(board()).not.toBeChecked());
    expect(pub()).toBeChecked(); // independent
    await user.click(pub());
    await waitFor(() => expect(pub()).not.toBeChecked());
    await user.click(board());
    await waitFor(() => expect(board()).toBeChecked());
    expect(h.updates.map((u) => u.patch)).toEqual([{ show_on_leaderboard: false }, { is_public: false }, { show_on_leaderboard: true }]);
    expect(h.updates.every((u) => u.id === A)).toBe(true); // only ever the signed-in user's own row

    applyIdentity(null, 'SIGNED_OUT');
    applyIdentity(alice, 'SIGNED_IN');
    await loadProfile();
    expect(authStore.get().profile).toMatchObject({ is_public: false, show_on_leaderboard: true });
  });

  it('signed out, the toggles show the new-account defaults and cannot be changed', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    for (const name of [/^Public profile/, /^Show me on leaderboards/]) {
      expect(screen.getByRole('switch', { name })).toBeChecked();
      expect(screen.getByRole('switch', { name })).toBeDisabled();
    }
  });
});

describe('loadProfile', () => {
  it('keeps the loaded profile when a reload fails, and clears it only when the row is really gone', async () => {
    h.row = { ...profile };
    applyIdentity(alice, 'SIGNED_IN');
    await loadProfile();
    expect(authStore.get().profile).toMatchObject({ username: 'alice' });

    h.selectError = { message: 'network down' };
    await loadProfile();
    expect(authStore.get().profile).toMatchObject({ username: 'alice' }); // not wiped by a transient failure

    h.selectError = null;
    h.row = null;
    await loadProfile();
    expect(authStore.get().profile).toBeNull();
  });
});
