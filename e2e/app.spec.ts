import { expect, test, type Page } from '@playwright/test';

async function wordsOnScreen(page: Page, n = Infinity): Promise<string[]> {
  await page.getByTestId('words').locator('.word').first().waitFor(); // lazy routes render after navigation
  const all = await page.getByTestId('words').locator('.word').allTextContents();
  return all.slice(0, n);
}

async function typeText(page: Page, text: string, delay = 70) {
  await page.getByTestId('typing-input').focus();
  await page.keyboard.type(text, { delay });
}

test('typing test is the landing page and starts on first key', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('words')).toBeVisible();
  await expect(page.getByTestId('progress')).toHaveText('30');
  const [first, second] = await wordsOnScreen(page, 2);
  await typeText(page, `${first} ${second!.slice(0, 2)}`);
  await expect(page.getByTestId('live-wpm')).toBeVisible();
  // caret sits on the next untyped letter (regression: offsets were once double-counted)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const caret = document.querySelector('.caret')!.getBoundingClientRect();
        const next = document.querySelector('[data-active]')!.children[2]!.getBoundingClientRect();
        return Math.abs(caret.left - next.left);
      }),
    )
    .toBeLessThan(2);
});

test('words mode completes, shows results and persists to statistics', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'words' }).click();
  await page.getByRole('radio', { name: '10', exact: true }).click();
  const words = await wordsOnScreen(page, 10);
  expect(words).toHaveLength(10);
  await typeText(page, words.join(' '), 90);
  await expect(page.getByTestId('results')).toBeVisible();
  await expect(page.getByTestId('result-acc')).toHaveText('100%');
  const wpm = Number(await page.getByTestId('result-wpm').textContent());
  expect(wpm).toBeGreaterThan(30);
  expect(wpm).toBeLessThan(300);

  await page.getByRole('link', { name: 'View statistics' }).click();
  await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  await page.reload();
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  await expect(page.getByText('words 10')).toBeVisible();
});

test('results icons repeat the same passage and start a new one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'words' }).click();
  await page.getByRole('radio', { name: '10', exact: true }).click();
  const first = await wordsOnScreen(page, 10);
  await typeText(page, first.join(' '), 40);
  await page.getByRole('button', { name: 'Repeat test' }).click();
  expect(await wordsOnScreen(page, 10)).toEqual(first);
  await typeText(page, first.join(' '), 40);
  await page.getByRole('button', { name: 'Next test' }).click();
  expect(await wordsOnScreen(page, 10)).not.toEqual(first);
});

test('time mode ends automatically when the timer runs out', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/');
  await page.getByRole('radio', { name: '15', exact: true }).click();
  await typeText(page, (await wordsOnScreen(page, 4)).join(' '));
  await expect(page.getByTestId('results')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('time 15s')).toBeVisible();
});

test('tab restarts the test', async ({ page }) => {
  await page.goto('/');
  await typeText(page, 'xyz');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('words').locator('.text-error')).toHaveCount(0);
  await expect(page.getByTestId('live-wpm')).toHaveCount(0);
});

test('settings persist across reloads', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Lily (light)' }).click();
  await page.getByRole('radio', { name: 'Block' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lily');
  await expect(page.getByRole('radio', { name: 'Block' })).toHaveAttribute('aria-checked', 'true');
});

test('passing a lesson marks it complete and awards XP', async ({ page }) => {
  await page.goto('/lessons/home-1');
  const text = (await wordsOnScreen(page)).join(' ');
  await typeText(page, text, 80);
  await expect(page.getByText(/Lesson passed/)).toBeVisible();
  await expect(page.getByText(/\+\d+ XP/)).toBeVisible();
  await page.getByRole('link', { name: 'All lessons' }).click();
  await expect(page.getByRole('link', { name: /Left hand home/ }).getByLabel('Passed')).toBeVisible();
});

test('online features explain they need configuration instead of faking data', async ({ page }) => {
  await page.goto('/leaderboards');
  await expect(page.getByText(/no rankings are shown/)).toBeVisible();
  await page.goto('/profile');
  await expect(page.getByText(/Accounts are not configured/)).toBeVisible();
});

test('keyboard users can reach every page', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Practice', 'Lessons', 'Statistics', 'Leaderboards', 'Achievements', 'Profile', 'Settings']) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});
