import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/pdf-extractor/',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @pdfx/web preview:test',
    url: 'http://localhost:4173/pdf-extractor/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
