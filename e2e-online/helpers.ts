// Browser helpers shared by the online specs.
import { expect, type Page } from '@playwright/test';
import { admin, PASSWORD } from '../tests-integration/env';

export const accountButton = (page: Page) => page.getByRole('button', { name: /^Account: / });

export async function signInUI(page: Page, email: string, password = PASSWORD, remember = true) {
  await page.goto('/signin');
  const form = page.getByRole('form', { name: 'Sign in' });
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByLabel('Keep me signed in').setChecked(remember);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(accountButton(page)).toBeVisible();
  await expect(page.locator('#account-menu')).toContainText(email); // signed in as this account, not another
}

export async function signOutUI(page: Page) {
  await accountButton(page).click();
  await page.locator('#account-menu').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
}

/** Types the visible words like a person (irregular gaps), so the server's automation heuristics stay quiet. */
export async function typeWords(page: Page, n: number) {
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

export async function wordsTest(page: Page, waitForChallenge: boolean) {
  await page.goto('/');
  const challenge = waitForChallenge ? page.waitForResponse((r) => r.url().includes('/rpc/issue_challenge') && r.ok()) : null;
  await page.getByRole('button', { name: 'words' }).click();
  await page.getByRole('radio', { name: '10', exact: true }).click();
  if (challenge) await challenge;
  await page.waitForTimeout(300);
  await typeWords(page, 10);
  await expect(page.getByTestId('results')).toBeVisible();
}

export const cloudTests = async (userId: string) =>
  (await admin.from('typing_tests').select('id, verified, ranked, imported').eq('user_id', userId)).data ?? [];
