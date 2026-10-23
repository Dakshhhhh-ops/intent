import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// The built single-file viewer, opened straight from disk: no server needed.
const app = pathToFileURL(resolve('dist/index.html')).href;

test('core journey: brief → contradicted claim → evidence → blame → why', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app);
  await expect(page.getByRole('heading', { name: /actually/ })).toBeVisible();

  await page.getByRole('button', { name: /See it on a sample run/ }).click();
  await expect(page.getByRole('heading', { name: 'The agent said it was done. The log disagrees.' })).toBeVisible();

  const claim = page.locator('.claim', { hasText: 'All tests pass.' });
  await expect(claim.locator('.stamp')).toHaveText('Contradicted');
  await claim.getByRole('button', { name: /evidence #12/ }).click();

  await expect(page.getByRole('tab', { name: /Replay/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.inspector h2')).toContainText('Re-run the suite');
  await expect(page.locator('.exit')).toContainText('output shows failures');
  expect(page.url()).toContain('#replay/12');

  await page.keyboard.press('3');
  await page.getByRole('button', { name: /test\/cart\.test\.js/ }).click();
  await page.locator('.diff-line.add.selectable').first().click();
  const why = page.getByRole('complementary', { name: 'Why this line' });
  await expect(why).toContainText('Same failures');
  await expect(why).toContainText('Right after a failure');

  await page.keyboard.press('4');
  await expect(page.locator('.finding h3', { hasText: 'were weakened' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('recorded runs open and look clean', async ({ page }) => {
  for (const id of ['csv-quotes-claude', 'csv-quotes-codex']) {
    await page.goto(`${app}?sample=${id}`);
    await expect(page.locator('.verdict-pill').first()).toContainText('Looks clean');
    await expect(page.locator('.stamp').first()).toHaveText('Supported');
  }
});

test('replay keyboard and playback', async ({ page }) => {
  await page.goto(`${app}?sample=cart-rounding#replay/1`);
  await expect(page.locator('.tape-controls .pos')).toContainText('Step 1 of');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(page.locator('.tape-controls .pos')).toContainText('Step 3 of');
  await page.keyboard.press(']');
  await expect(page.locator('.inspector h2')).toContainText('Edit src/discount.js');
  await expect(page.locator('.check-line.bad')).toContainText('had not read this file');
});

test('rejects files that are not agent logs', async ({ page }) => {
  await page.goto(app);
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello world') });
  await expect(page.getByRole('alert')).toContainText('not a Claude Code session');
});
