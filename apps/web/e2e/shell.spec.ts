import { test, expect } from '@playwright/test';

test('app loads under the base path and shows the top bar', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('link', { name: 'PDF Extractor' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});
