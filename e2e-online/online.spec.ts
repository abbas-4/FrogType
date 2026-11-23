import { expect, test, type Page } from '@playwright/test';
import { admin, latestMail, linkIn, newUser, PASSWORD, psql } from '../tests-integration/env';

async function signInUI(page: Page, email: string, password = PASSWORD) {
  await page.goto('/profile');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('form button[type=submit]').click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
}

async function signOutUI(page: Page) {
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
}

/** Types the visible words like a person (irregular gaps), so the server's automation heuristics stay quiet. */
async function typeWords(page: Page, n: number) {
  await page.getByTestId('words').locator('.word').first().waitFor();
  const words = (await page.getByTestId('words').locator('.word').allTextContents()).slice(0, n);
  await page.getByTestId('typing-input').focus();
  let i = 0;
  for (const ch of words.join(' ')) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(55 + ((i++ * 7919) % 97));
  }
  return words;
}

async function wordsTest(page: Page, waitForChallenge: boolean) {
  await page.goto('/');
  const challenge = waitForChallenge ? page.waitForResponse((r) => r.url().includes('/rpc/issue_challenge') && r.ok()) : null;
  await page.getByRole('button', { name: 'words' }).click();
  await page.getByRole('radio', { name: '10', exact: true }).click();
  if (challenge) await challenge;
  await page.waitForTimeout(300);
  await typeWords(page, 10);
  await expect(page.getByTestId('results')).toBeVisible();
}

const cloudTests = async (userId: string) => (await admin.from('typing_tests').select('id, verified, ranked').eq('user_id', userId)).data ?? [];

test('security headers are sent and the app runs under the CSP with Supabase enabled', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => /Content Security Policy|Refused to/i.test(m.text()) && violations.push(m.text()));
  const res = await page.goto('/');
  const h = res!.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['content-security-policy']).toContain('http://127.0.0.1:55321');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=()');
  for (const path of ['/stats', '/leaderboards', '/profile', '/settings', '/lessons', '/practice']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(violations).toEqual([]);
});

test('sign-up is private by default and needs email confirmation', async ({ page }) => {
  const email = `ui-${Date.now()}@frogtype.test`;
  const t0 = Date.now();
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Create account' }).first().click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Username', { exact: true }).fill(`ui_${Date.now().toString(36)}`);
  const pw = page.getByLabel('Password', { exact: true });
  await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
  await pw.fill('weakpass');
  expect(await pw.evaluate((e) => (e as HTMLInputElement).validity.tooShort)).toBe(true); // browser blocks submit
  await pw.fill('alllowercase123');
  await page.locator('form button[type=submit]').click();
  await expect(page.getByText(/needs an uppercase letter/)).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('Ui-Signup-Passw0rd');
  await expect(page.getByRole('checkbox', { name: /profile public/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /leaderboards/ })).not.toBeChecked();
  await page.locator('form button[type=submit]').click();
  await expect(page.getByText('Check your email to confirm your account')).toBeVisible();
  await page.goto(linkIn(await latestMail(email, /confirm/i, t0 - 1000)));
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  const { data } = await admin.from('profiles').select('is_public, show_on_leaderboard').eq('username', (await page.getByLabel('Username', { exact: true }).inputValue())).single();
  expect(data).toEqual({ is_public: false, show_on_leaderboard: false });
});

test('two accounts sharing a browser never see or upload each other\'s results', async ({ page }) => {
  const [a, b] = [await newUser(), await newUser()];
  await signInUI(page, a.email);
  await wordsTest(page, false);
  await expect.poll(async () => (await cloudTests(a.id)).length).toBe(1);
  await page.goto('/stats');
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  await signOutUI(page);
  await page.goto('/stats');
  await expect(page.locator('table tbody tr')).toHaveCount(0); // guest sees nothing of A
  await signInUI(page, b.email);
  await page.goto('/stats');
  await expect(page.locator('table tbody tr')).toHaveCount(0);
  expect(await cloudTests(b.id)).toEqual([]);
});

test('a queued result that failed to upload is never sent under the next account', async ({ page }) => {
  const [a, b] = [await newUser(), await newUser()];
  await signInUI(page, a.email);
  await page.route('**/rest/v1/rpc/submit_test', (r) => r.abort());
  await wordsTest(page, false);
  await page.goto('/profile');
  await expect(page.getByText('1 waiting to upload')).toBeVisible();
  await signOutUI(page);
  await signInUI(page, b.email);
  await page.unroute('**/rest/v1/rpc/submit_test');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/last synced/)).toBeVisible();
  expect(await cloudTests(b.id)).toEqual([]);
  expect(await cloudTests(a.id)).toEqual([]);
  await signOutUI(page);
  await signInUI(page, a.email);
  await expect.poll(async () => (await cloudTests(a.id)).length).toBe(1); // A's queue goes to A
});

test('a ranked test uses a server passage, is verified, and appears on the leaderboard', async ({ page }) => {
  const u = await newUser({ show_on_leaderboard: true });
  await signInUI(page, u.email);
  await wordsTest(page, true);
  await expect.poll(async () => (await cloudTests(u.id))[0] ?? null, { timeout: 20_000 }).toMatchObject({ verified: true, ranked: true });
  await page.goto('/leaderboards');
  await page.getByRole('radio', { name: 'words 10', exact: true }).click();
  await expect(page.getByRole('link', { name: u.username })).toBeVisible();
});

test('password recovery: valid link once; reused, tampered and expired links fail', async ({ page }) => {
  const u = await newUser();
  const request = async () => {
    const t0 = Date.now();
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email').fill(u.email);
    await page.locator('form button[type=submit]').click();
    await expect(page.getByText('If that email has an account, a reset link is on its way.')).toBeVisible();
    return linkIn(await latestMail(u.email, /reset/i, t0 - 1000));
  };
  const link = await request();
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password/);
  await page.getByLabel('New password', { exact: true }).fill('Recovered-Passw0rd');
  await page.getByLabel('Confirm new password').fill('Different-Passw0rd');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText('The passwords do not match.')).toBeVisible();
  await page.getByLabel('Confirm new password').fill('Recovered-Passw0rd');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByTestId('reset-done')).toBeVisible();
  await signOutUI(page);
  await signInUI(page, u.email, 'Recovered-Passw0rd');
  await signOutUI(page);

  await page.goto(link); // reused
  await expect(page.getByTestId('reset-invalid')).toBeVisible();
  await page.goto(link.replace(/token=[^&]+/, 'token=deadbeef')); // tampered
  await expect(page.getByTestId('reset-invalid')).toBeVisible();
  await page.waitForTimeout(1100); // GoTrue: one email per second per user
  const expiring = await request();
  psql(`update auth.users set recovery_sent_at = now() - interval '2 hours' where id = '${u.id}'`);
  await page.goto(expiring); // expired
  await expect(page.getByTestId('reset-invalid')).toBeVisible();
  await page.goto('/reset-password'); // direct visit without a recovery session: no password form
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
});

test('export downloads only the user\'s data; deletion re-authenticates and removes the account', async ({ page }) => {
  const u = await newUser();
  await signInUI(page, u.email);
  await wordsTest(page, false);
  await expect.poll(async () => (await cloudTests(u.id)).length).toBe(1);
  await page.goto('/profile');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data (JSON)' }).click();
  const file = JSON.parse(await (await (await download).createReadStream()).toArray().then((c) => Buffer.concat(c).toString()));
  expect(file.profile.id).toBe(u.id);
  expect(file.typing_tests).toHaveLength(1);
  expect(file.typing_tests.every((t: { user_id: string }) => t.user_id === u.id)).toBe(true);

  await page.getByRole('button', { name: 'Delete account…' }).click();
  const form = page.getByRole('form', { name: 'Delete account' });
  await expect(form.getByRole('button', { name: 'Permanently delete' })).toBeDisabled();
  await form.getByLabel(/Type your username/).fill(u.username);
  await form.getByLabel('Password').fill('wrong-password');
  await form.getByRole('button', { name: 'Permanently delete' }).click();
  await expect(page.getByText('Password is incorrect.')).toBeVisible();
  expect((await admin.auth.admin.getUserById(u.id)).error).toBeNull();
  await form.getByLabel('Password').fill(PASSWORD);
  await form.getByRole('button', { name: 'Permanently delete' }).click();
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
  expect((await admin.auth.admin.getUserById(u.id)).error).not.toBeNull();
  expect(await cloudTests(u.id)).toEqual([]);
  expect(await page.evaluate((id) => localStorage.getItem(`frogtype:progress:u:${id}`), u.id)).toBeNull();
});
