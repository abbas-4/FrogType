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

test('a low-accuracy test shows full results, survives stray keys, saves, and restarts with Tab then Enter', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'words' }).click();
  await page.getByRole('radio', { name: '10', exact: true }).click();
  const words = await wordsOnScreen(page, 10);
  await typeText(page, words.map((w) => 'q'.repeat(w.length)).join(' ') + ' ', 90);
  const results = page.getByTestId('results');
  await expect(results).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(Number.parseInt((await page.getByTestId('result-acc').textContent())!)).toBeLessThan(50);
  await expect(results.getByText('consistency')).toBeVisible();

  // keys typed out of momentum after the finish never trigger an action
  await page.keyboard.type('asdf ', { delay: 30 });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(results).toBeVisible();
  await expect(page.getByText('Tab → Enter to restart')).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Restart test' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(results).toHaveCount(0);
  expect(await wordsOnScreen(page, 10)).toEqual(words);

  await page.goto('/stats');
  await expect(page.locator('table tbody tr')).toHaveCount(1);
});

test('results icons repeat the same passage and start a new one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'words' }).click();
  await page.getByRole('radio', { name: '10', exact: true }).click();
  const first = await wordsOnScreen(page, 10);
  await typeText(page, first.join(' '), 40);
  await page.getByRole('button', { name: 'Restart test' }).click();
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
  await expect(page.getByTestId('results')).toBeVisible();
  // completion state lives in the lesson header; results carry the XP badge and no verdict box or Next link
  await expect(page.getByText('· passed')).toBeVisible();
  await expect(page.getByText(/\+\d+ XP/)).toBeVisible();
  await expect(page.getByText(/Lesson passed/)).toHaveCount(0);
  await expect(page.getByText(/Not yet|Invalid test/)).toHaveCount(0);
  await expect(page.getByTestId('results').getByRole('link', { name: /Next:/ })).toHaveCount(0);
  // Next moves on to the following lesson with its own text
  await page.getByRole('button', { name: 'Next test' }).click();
  await expect(page).toHaveURL(/\/lessons\/home-2$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Right hand home');
  expect((await wordsOnScreen(page)).join(' ')).not.toBe(text);
  await page.getByRole('link', { name: 'All lessons' }).click();
  await expect(page.getByRole('link', { name: /Left hand home/ }).getByLabel('Passed')).toBeVisible();
  await expect(page.getByRole('link', { name: /Left hand home/ })).toHaveAttribute('data-completed', 'true');
  await expect(page.getByRole('link', { name: /Right hand home/ })).not.toHaveAttribute('data-completed');
  // completion survives a reload
  await page.reload();
  await expect(page.getByRole('link', { name: /Left hand home/ })).toHaveAttribute('data-completed', 'true');
});

test('online features explain they need configuration instead of faking data', async ({ page }) => {
  await page.goto('/leaderboards');
  await expect(page.getByText(/no rankings are shown/)).toBeVisible();
  await page.goto('/profile');
  await expect(page.getByText(/Accounts are not configured/)).toBeVisible();
});

test('keyboard users can reach every page', async ({ page }) => {
  await page.goto('/');
  for (const name of ['Lessons', 'Leaderboards', 'Profile', 'Settings']) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  // Statistics and Achievements live behind the profile page's preview cards.
  for (const [link, heading] of [['All statistics', 'Statistics'], [/^See all \d+$/, 'Achievements']] as const) {
    await page.goto('/profile');
    await page.getByRole('link', { name: link }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
});
