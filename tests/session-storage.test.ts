// "Keep me signed in": where supabase-js session data lands, and post-sign-in redirect safety.
import { beforeEach, describe, expect, it } from 'vitest';
import { afterEach } from 'vitest';
import { authStorage, chooseSessionPersistence, rememberSession, setRememberSession } from '../src/services/supabase';
import { safeReturnPath } from '../src/domain/returnPath';

const SESSION = 'sb-127-auth-token';
const VERIFIER = 'sb-127-auth-token-code-verifier';

beforeEach(() => sessionStorage.clear());
afterEach(() => chooseSessionPersistence(null));

describe('authStorage', () => {
  it('remembers sessions by default', () => {
    expect(rememberSession()).toBe(true);
  });

  it("this tab's sign-in choice (remember) puts the new session in localStorage and drops a sessionStorage copy", () => {
    sessionStorage.setItem(SESSION, 'old');
    chooseSessionPersistence(true);
    authStorage.setItem(SESSION, 'new');
    expect(localStorage.getItem(SESSION)).toBe('new');
    expect(sessionStorage.getItem(SESSION)).toBeNull();
  });

  it("this tab's sign-in choice (don't remember) puts the new session in sessionStorage and leaves the shared copy alone", () => {
    localStorage.setItem(SESSION, 'other-tab');
    chooseSessionPersistence(false);
    authStorage.setItem(SESSION, 'new');
    expect(sessionStorage.getItem(SESSION)).toBe('new');
    expect(authStorage.getItem(SESSION)).toBe('new'); // this tab reads its own copy first
    expect(localStorage.getItem(SESSION)).toBe('other-tab'); // another tab's remembered session survives
  });

  // Regression (review finding): the browser-wide preference used to be re-read on every write, so another tab's
  // sign-in could move a tab-only session into shared localStorage on its next token refresh.
  it('a tab-only session stays in sessionStorage on refresh even when the saved preference says remember', () => {
    sessionStorage.setItem(SESSION, 'tab-only');
    localStorage.setItem(SESSION, 'other-tab');
    setRememberSession(true);
    authStorage.setItem(SESSION, 'refreshed');
    expect(sessionStorage.getItem(SESSION)).toBe('refreshed');
    expect(localStorage.getItem(SESSION)).toBe('other-tab'); // not overwritten or deleted by this tab's refresh
  });

  it('a remembered session stays in localStorage on refresh even when the saved preference says do not remember', () => {
    localStorage.setItem(SESSION, 'durable');
    setRememberSession(false);
    expect(rememberSession()).toBe(false);
    authStorage.setItem(SESSION, 'refreshed');
    expect(localStorage.getItem(SESSION)).toBe('refreshed');
    expect(sessionStorage.getItem(SESSION)).toBeNull();
  });

  it('a brand-new session without a choice in this tab (e.g. from an email link) follows the saved preference', () => {
    setRememberSession(false);
    authStorage.setItem(SESSION, 'from-link');
    expect(sessionStorage.getItem(SESSION)).toBe('from-link');
    expect(localStorage.getItem(SESSION)).toBeNull();
  });

  it('always keeps PKCE code verifiers in localStorage (links open in a new tab)', () => {
    setRememberSession(false);
    authStorage.setItem(VERIFIER, 'v');
    expect(localStorage.getItem(VERIFIER)).toBe('v');
    expect(sessionStorage.getItem(VERIFIER)).toBeNull();
  });

  it('getItem finds a value in either store', () => {
    localStorage.setItem('a', 'local');
    sessionStorage.setItem('b', 'tab');
    expect(authStorage.getItem('a')).toBe('local');
    expect(authStorage.getItem('b')).toBe('tab');
    expect(authStorage.getItem('missing')).toBeNull();
  });

  it("removeItem (sign-out) removes only this tab's copy: the tab-only one, never another tab's shared session", () => {
    localStorage.setItem(SESSION, 'other-tab');
    sessionStorage.setItem(SESSION, 'mine');
    authStorage.removeItem(SESSION);
    expect(sessionStorage.getItem(SESSION)).toBeNull();
    expect(localStorage.getItem(SESSION)).toBe('other-tab');
  });

  it('removeItem removes the shared copy when this tab has no tab-only one', () => {
    localStorage.setItem(SESSION, 'shared');
    authStorage.removeItem(SESSION);
    expect(localStorage.getItem(SESSION)).toBeNull();
  });
});

describe('safeReturnPath', () => {
  it('accepts same-app paths', () => {
    expect(safeReturnPath('/settings')).toBe('/settings');
    expect(safeReturnPath('/u/frog?tab=stats')).toBe('/u/frog?tab=stats');
  });

  it.each([['//evil.com'], ['https://evil.com'], ['/\\evil'], ['evil'], [''], [null], [undefined], [42], [{ pathname: '/settings' }]])('rejects %j', (from) => {
    expect(safeReturnPath(from)).toBe('/profile');
  });
});
