// Regenerates docs/screenshots from the built viewer (npm run build:web first).
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = pathToFileURL(resolve('dist/index.html')).href;
const out = resolve('docs/screenshots');
const theme = process.argv[2] ?? 'dark';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await page.addInitScript((t) => localStorage.setItem('ir-theme', t), theme);
const shot = async (name, url, fn, full = false) => {
  await page.goto(url);
  // Let entrance animations settle so the shot is sharp.
  await page.waitForTimeout(2500);
  if (fn) await fn();
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
};
await shot('home', app);
await shot('brief', `${app}?sample=cart-rounding#brief`);
await shot('replay', `${app}?sample=cart-rounding#replay/14`);
await shot('changes', `${app}?sample=cart-rounding#changes/test%2Fcart.test.js`, async () => {
  await page.locator('.diff-line.add.selectable').first().click();
  await page.waitForTimeout(300);
});
await shot('findings', `${app}?sample=cart-rounding#findings`);
await shot('compare', `${app}?compare=csv-quotes-claude,csv-quotes-codex`);
await browser.close();
console.log('screenshots written to docs/screenshots');
