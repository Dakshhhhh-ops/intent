import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { viewport: { width: 1440, height: 900 } },
  reporter: [['list']],
});
