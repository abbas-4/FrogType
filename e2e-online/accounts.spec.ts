import { expect, test, type Page } from '@playwright/test';
import { admin, latestMail, linkIn, newUser, PASSWORD, psql } from '../tests-integration/env';
import { accountButton, cloudTests, signInUI, signOutUI, wordsTest } from './helpers';

const signInLink = (page: Page) => page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true });
const importDialog = (page: Page) => page.getByRole('dialog', { name: /Import this browser's guest progress/ });
/** Resolves when the next "Sync now" run has uploaded the queue and refreshed progression. */
const syncDone = (page: Page) => page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/sync_progress') && r.ok());

test('account pages load directly with a heading and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  for (const path of ['/signin', '/signup', '/reset-password', '/profile', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
  }
  expect(errors).toEqual([]);
});

test('guest progress is imported only when the new account chooses to, and only once', async ({ page }) => {
  const email = `imp-${Date.now()}@frogtype.test`;
  const username = `imp_${Date.now().toString(36)}`;
  await wordsTest(page, false); // as a guest

  const t0 = Date.now();
  await page.goto('/signup');
  const form = page.getByRole('form', { name: 'Create account' });
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Username', { exact: true }).fill(username);
  await form.getByLabel('Password', { exact: true }).fill('Import-Passw0rd');
  await form.getByLabel('Confirm password', { exact: true }).fill('Import-Passw0rd');
  await form.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('signup-sent')).toBeVisible();
  await page.goto(linkIn(await latestMail(email, /confirm/i, t0 - 1000)));
  await expect(page.getByText("Your email address is confirmed and you're signed in.")).toBeVisible();
  const id = (await admin.from('profiles').select('id').eq('username', username).single()).data!.id as string;

  await expect(importDialog(page)).toContainText('1 test was recorded here while signed out');
  await page.getByRole('button', { name: 'Keep as guest data' }).click();
  await expect(importDialog(page)).toHaveCount(0);
  let synced = syncDone(page);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await synced;
  expect(await cloudTests(id)).toEqual([]); // declining uploads nothing

  await page.getByRole('button', { name: "Import this browser's guest progress" }).click();
  await importDialog(page).getByRole('button', { name: 'Import to my account' }).click();
  await expect.poll(async () => (await cloudTests(id)).map((t) => [t.imported, t.ranked])).toEqual([[true, false]]);
  synced = syncDone(page);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await synced;
  expect(await cloudTests(id)).toHaveLength(1); // no duplicate upload
  await expect(importDialog(page)).toHaveCount(0);
  await page.goto('/stats');
  await expect(page.locator('table tbody tr')).toHaveCount(1);
});

test('profile edits are saved; the public page shows them only while the profile is public', async ({ page, browser }) => {
  const u = await newUser();
  const name = `p_${u.username.slice(2)}`;
  const bio = 'Touch typing every day, 80 wpm goal.';
  await signInUI(page, u.email);
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const form = page.getByRole('form', { name: 'Edit profile' });
  await form.getByRole('radio', { name: 'Cat', exact: true }).check({ force: true }); // visually hidden radio inside its label
  await form.getByLabel('Bio').fill(bio);
  await form.getByLabel('Username', { exact: true }).fill(name);
  await expect(form.getByText('✓ Username is available')).toBeVisible();
  await form.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText(bio)).toBeVisible();
  await expect
    .poll(async () => (await admin.from('profiles').select('username, avatar, bio, is_public').eq('id', u.id).single()).data)
    .toEqual({ username: name, avatar: 'cat', bio, is_public: true });

  // public by default: a signed-out visitor sees the edits
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(`/u/${name}`);
  await expect(visitor.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(visitor.getByText(bio)).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('switch', { name: /Public profile/ })).toBeChecked();
  await page.locator('label', { hasText: 'Public profile' }).click(); // the switch is a visually hidden checkbox inside its label
  await expect.poll(async () => (await admin.from('profiles').select('is_public').eq('id', u.id).single()).data!.is_public).toBe(false);
  await visitor.reload();
  await expect(visitor.getByText("This profile doesn't exist or is private.")).toBeVisible();
  await expect(visitor.getByText(bio)).toHaveCount(0);

  await page.locator('label', { hasText: 'Public profile' }).click();
  await expect.poll(async () => (await admin.from('profiles').select('is_public').eq('id', u.id).single()).data!.is_public).toBe(true);
  await visitor.reload();
  await expect(visitor.getByRole('heading', { level: 1, name })).toBeVisible();
  await anon.close();
});

const storedSessionIn = (page: Page, where: 'localStorage' | 'sessionStorage') =>
  page.evaluate((w) => Object.keys(window[w]).some((k) => k.endsWith('-auth-token')), where);

test('"Keep me signed in" decides whether the session outlives the tab', async ({ page, context }) => {
  const u = await newUser();
  await signInUI(page, u.email, PASSWORD, true);
  expect(await storedSessionIn(page, 'localStorage')).toBe(true);
  const other = await context.newPage();
  await other.goto('/profile');
  await expect(accountButton(other)).toBeVisible(); // a new tab is signed in
  await other.close();
  await signOutUI(page);

  await signInUI(page, u.email, PASSWORD, false);
  expect(await storedSessionIn(page, 'sessionStorage')).toBe(true);
  expect(await storedSessionIn(page, 'localStorage')).toBe(false);
  const fresh = await context.newPage();
  await fresh.goto('/profile');
  await expect(signInLink(fresh)).toBeVisible(); // a new tab (like a restarted browser) is signed out
  await expect(accountButton(fresh)).toHaveCount(0);
  await fresh.close();
  await page.reload();
  await expect(accountButton(page)).toBeVisible(); // the same tab survives a reload
});

/** User id of the session in one store of this tab, or null. */
const storedUser = (page: Page, where: 'localStorage' | 'sessionStorage') =>
  page.evaluate((w) => {
    const key = Object.keys(window[w]).find((k) => k.endsWith('-auth-token'));
    return key ? ((JSON.parse(window[w].getItem(key)!) as { user?: { id?: string } }).user?.id ?? null) : null;
  }, where);

// Regression for a review finding: supabase-js broadcasts auth events to every tab without updating their storage, and
// the "remember" choice used to be re-read on every token write. A tab-only session could then be shown as another
// account, or moved into shared localStorage by its own refresh.
test('a tab-only session is never taken over by another tab, nor moved to localStorage by a refresh', async ({ page, context }) => {
  const [a, b] = [await newUser(), await newUser()];
  await signInUI(page, a.email, PASSWORD, false); // tab 1: A, this tab only
  const tab2 = await context.newPage();
  await signInUI(tab2, b.email, PASSWORD, true); // tab 2: B, remembered (sets the saved preference to "remember")

  await tab2.waitForTimeout(500); // let tab 1 receive tab 2's SIGNED_IN broadcast
  await expect(accountButton(page)).toHaveAccessibleName(`Account: ${a.username}`); // tab 1 still shows A
  expect(await storedUser(page, 'sessionStorage')).toBe(a.id);

  // Force tab 1's token refresh: expire its stored access token and wake the refresher.
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.endsWith('-auth-token'))!;
    sessionStorage.setItem(key, JSON.stringify({ ...JSON.parse(sessionStorage.getItem(key)!), expires_at: Math.floor(Date.now() / 1000) - 60 }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.endsWith('-auth-token'));
    return key ? (JSON.parse(sessionStorage.getItem(key)!) as { expires_at: number }).expires_at > Date.now() / 1000 : false;
  }), { timeout: 40_000 }).toBe(true); // refreshed…
  expect(await storedUser(page, 'sessionStorage')).toBe(a.id); // …and still pinned to tab 1
  expect(await storedUser(page, 'localStorage')).toBe(b.id); // B's remembered session was not overwritten
  await tab2.reload();
  await expect(accountButton(tab2)).toHaveAccessibleName(`Account: ${b.username}`);
  await expect(accountButton(page)).toHaveAccessibleName(`Account: ${a.username}`);

  // Signing out tab 1 removes only its own tab-only session: tab 2 stays B, and tab 1 now follows the session this
  // browser still remembers (B), exactly as a freshly opened tab would, instead of showing a stale A.
  await accountButton(page).click();
  await page.locator('#account-menu').getByRole('button', { name: 'Sign out' }).click();
  await expect(accountButton(page)).toHaveAccessibleName(`Account: ${b.username}`);
  expect(await storedUser(page, 'sessionStorage')).toBeNull();
  await tab2.waitForTimeout(500);
  await expect(accountButton(tab2)).toHaveAccessibleName(`Account: ${b.username}`);
  expect(await storedUser(tab2, 'localStorage')).toBe(b.id);
  await tab2.close();
});

test('changing the password re-checks the current one and replaces it everywhere', async ({ page }) => {
  const u = await newUser();
  const next = 'Changed-Passw0rd';
  await signInUI(page, u.email);
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'Change password' });
  await form.getByLabel('Current password', { exact: true }).fill('Wrong-Passw0rd1');
  await form.getByLabel('New password', { exact: true }).fill(next);
  await form.getByLabel('Confirm new password', { exact: true }).fill(next);
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByText('Current password is incorrect.')).toBeVisible();
  await expect(accountButton(page)).toBeVisible(); // a wrong password does not sign you out

  await form.getByLabel('Current password', { exact: true }).fill(PASSWORD);
  await form.getByLabel('New password', { exact: true }).fill(next);
  await form.getByLabel('Confirm new password', { exact: true }).fill(next);
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByText('Password changed. Other devices were signed out.')).toBeVisible();
  expect((await u.c.auth.refreshSession()).error).not.toBeNull(); // the other session's refresh token was revoked

  await signOutUI(page);
  await page.goto('/signin');
  const signIn = page.getByRole('form', { name: 'Sign in' });
  await signIn.getByLabel('Email').fill(u.email);
  await signIn.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await signIn.getByRole('button', { name: 'Sign in' }).click();
  await expect(signIn.getByText('Incorrect email or password.')).toBeVisible();
  await signInUI(page, u.email, next);
});

test('changing the email needs both inboxes to confirm, then lands on Settings with a notice', async ({ page }) => {
  const u = await newUser();
  const next = `chg-${u.username.slice(2)}@frogtype.test`; // must not contain the old address: Mailpit's to: search matches substrings
  await signInUI(page, u.email);
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'Change email' });
  await form.getByLabel('New email').fill(next);
  await form.getByLabel('Current password', { exact: true }).fill('Wrong-Passw0rd1');
  await form.getByRole('button', { name: 'Change email' }).click();
  await expect(form.getByText('Current password is incorrect.')).toBeVisible();

  const t0 = Date.now();
  await form.getByLabel('Current password', { exact: true }).fill(PASSWORD);
  await form.getByRole('button', { name: 'Change email' }).click();
  await expect(form.getByText(/Almost done\. We sent confirmation links/)).toBeVisible();
  const email = async () => (await admin.auth.admin.getUserById(u.id)).data.user?.email;
  expect(await email()).toBe(u.email); // nothing changes until both links are opened

  const oldLink = linkIn(await latestMail(u.email, /new email address/i, t0 - 1000));
  const newLink = linkIn(await latestMail(next, /new email address/i, t0 - 1000));
  await page.goto(oldLink);
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByText(/One address confirmed/)).toBeVisible();
  expect(await email()).toBe(u.email);
  await page.goto(newLink);
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByText(`Your email address has been changed to ${next}.`)).toBeVisible();
  await expect.poll(email).toBe(next);
  await expect(page.getByText(`Signed in as ${next}`)).toBeVisible();
});

test('a revoked session signs out gracefully and keeps guest progress', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const u = await newUser();
  await wordsTest(page, false); // guest progress in this browser
  await signInUI(page, u.email);
  await page.getByRole('button', { name: 'Keep as guest data' }).click();

  psql(`delete from auth.sessions where user_id = '${u.id}'`);
  // Make the stored access token look expired so the client must use its (now revoked) refresh token, then wake it.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!;
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), expires_at: Math.floor(Date.now() / 1000) - 60 }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText("You've been signed out.")).toBeVisible({ timeout: 40_000 }); // the 30 s refresh tick also catches it
  await expect(accountButton(page)).toHaveCount(0);
  await expect(signInLink(page)).toBeVisible();

  await page.goto('/stats');
  await expect(page.locator('table tbody tr')).toHaveCount(1); // the guest test is still here
  await page.reload();
  await expect(accountButton(page)).toHaveCount(0); // stays signed out after a reload
  await page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
  expect(errors).toEqual([]);
});
