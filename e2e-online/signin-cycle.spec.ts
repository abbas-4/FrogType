import { expect, test, type Page } from '@playwright/test';
import { latestMail, linkIn } from '../tests-integration/env';
import { accountButton, signOutUI } from './helpers';

const signedInAs = async (p: Page, email: string) => {
  await expect(accountButton(p)).toBeVisible();
  await expect(p.locator('#account-menu')).toContainText(email);
};

// Existing specs sign in after a full page load; this one stays in the app between sign-out and sign-in, like a person.
test('a new account can sign out and back in repeatedly, in either tab, and stays signed in across reloads', async ({ page: signupTab, context }) => {
  const tag = Date.now().toString(36);
  const email = `cyc-${tag}@frogtype.test`;
  const pw = 'Cycle-Passw0rd';
  const t0 = Date.now();
  await signupTab.goto('/signup');
  const form = signupTab.getByRole('form', { name: 'Create account' });
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Username', { exact: true }).fill(`cyc_${tag}`);
  await form.getByLabel('Password', { exact: true }).fill(pw);
  await form.getByLabel('Confirm password', { exact: true }).fill(pw);
  await form.getByRole('button', { name: 'Create account' }).click();
  await expect(signupTab.getByTestId('signup-sent')).toBeVisible();

  const mailTab = await context.newPage(); // the mail app opens the confirmation link in a new tab
  await mailTab.goto(linkIn(await latestMail(email, /confirm/i, t0 - 1000)));
  await signedInAs(mailTab, email);
  await signedInAs(signupTab, email);

  for (const [i, p] of [mailTab, signupTab, mailTab].entries()) {
    await signOutUI(p);
    await p.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }).click();
    const signIn = p.getByRole('form', { name: 'Sign in' });
    await signIn.getByLabel('Email').fill(email);
    if (i === 0) {
      await signIn.getByLabel('Password', { exact: true }).fill('Wrong-Passw0rd'); // gitleaks:allow (synthetic)
      await signIn.getByRole('button', { name: 'Sign in' }).click();
      await expect(signIn.getByText('Incorrect email or password.')).toBeVisible();
    }
    await signIn.getByLabel('Password', { exact: true }).fill(pw);
    await signIn.getByRole('button', { name: 'Sign in' }).click();
    await signedInAs(p, email);
    await p.reload();
    await signedInAs(p, email);
  }
});
