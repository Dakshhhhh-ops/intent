import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// The built single-file viewer, opened straight from disk: no server needed.
const app = pathToFileURL(resolve('dist/index.html')).href;

test('core journey: brief → contradicted claim → evidence → blame → why', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app);
  await expect(page.getByRole('heading', { name: /Prove it/ })).toBeVisible();

  await page.getByRole('button', { name: /See a run/ }).click();
  await expect(page.getByRole('heading', { name: 'The agent said it was done. The log disagrees.' })).toBeVisible();

  const claim = page.locator('.claim', { hasText: 'All tests pass.' });
  await expect(claim.locator('.stamp')).toHaveText('Contradicted');
  await claim.getByRole('button', { name: /evidence #12/ }).click();

  await expect(page.getByRole('tab', { name: /Replay/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.inspector h2')).toContainText('Re-run the suite');
  await expect(page.locator('.exit')).toContainText('output shows failures');
  expect(page.url()).toContain('#replay/12');

  await page.keyboard.press('3');
  await page.locator('.file-item', { hasText: 'test/cart.test.js' }).click();
  await page.locator('.diff-line.add.selectable').first().click();
  const why = page.getByRole('complementary', { name: 'Why this line' });
  await expect(why).toContainText('Same failures');
  await expect(why).toContainText('Right after a failure');

  await page.keyboard.press('4');
  await expect(page.locator('.fx-card h3', { hasText: 'were weakened' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('recorded runs open and look clean', async ({ page }) => {
  for (const id of ['csv-quotes-claude', 'csv-quotes-codex']) {
    await page.goto(`${app}?sample=${id}`);
    await expect(page.locator('.rh-verdict')).toContainText('Looks clean');
    await expect(page.locator('.stamp').first()).toHaveText('Supported');
  }
});

test('replay keyboard and playback', async ({ page }) => {
  await page.goto(`${app}?sample=cart-rounding#replay/1`);
  await expect(page.locator('.tape-controls .pos')).toContainText('Step 1 of');
  await page.keyboard.press('j');
  await expect(page.locator('.tape-controls .pos')).toContainText('Step 2 of');
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

test('CLI export and in-app download both produce a working offline replay', async ({ page }, info) => {
  const { execFileSync } = await import('node:child_process');
  const out = info.outputPath('cli-replay.html');
  execFileSync(process.execPath, ['dist-cli/intent-replay.mjs', 'export', 'examples/cart-rounding.claude.jsonl', '-o', out]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(out).href);
  await expect(page.locator('.bv-hero h1')).toHaveText('The agent said it was done. The log disagrees.');

  // Download from the app, then open the downloaded file.
  await page.goto(`${app}?sample=csv-quotes-codex`);
  await page.getByRole('button', { name: /Share/ }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Download replay/ }).click()]);
  const saved = info.outputPath('app-replay.html');
  await download.saveAs(saved);
  await page.goto(pathToFileURL(saved).href);
  await expect(page.locator('.rh-verdict')).toContainText('Looks clean');
  expect(errors).toEqual([]);
});

test('compare two agents on the same task', async ({ page }) => {
  await page.goto(app);
  await page.getByRole('button', { name: /Same bug, two agents/ }).click();
  await expect(page.getByRole('heading', { name: 'Same task, two runs' })).toBeVisible();
  await expect(page.locator('.cmp-head .chip')).toHaveText(['Claude Code', 'Codex CLI']);
  await expect(page.locator('.panel-head h2', { hasText: 'src/csv.js' })).toBeVisible();
  await page.getByRole('button', { name: /Open this run/ }).nth(1).click();
  await expect(page.locator('.runhead2')).toContainText('Codex CLI');
});
