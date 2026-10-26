// Captures every screen in light and dark mode into docs/screenshots, for design
// review and the README. Run with `pnpm screenshots` (the normal e2e run ignores it).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, ready, resetApp, templateFiles, pdfFile, ROOT } from './helpers';

const OUT = join(ROOT, 'docs', 'screenshots');
const ID = 'northline-fuel-statement';

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`screens, ${scheme}`, async ({ page }) => {
    test.setTimeout(300_000);
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: 1360, height: 860 });
    await page.emulateMedia({ colorScheme: scheme });
    const s = (n: string) => `${n}-${scheme}`;

    await resetApp(page);
    await shot(page, s('01-welcome'));
    await page.getByRole('button', { name: 'Get started' }).click();
    await shot(page, s('02-choose-folder'));
    await page.getByRole('button', { name: 'Choose folder' }).click();
    await expect(page.getByRole('button', { name: 'Create folders' })).toBeVisible();
    await shot(page, s('03-create-folders'));

    const files: Record<string, string> = {
      ...templateFiles(ID),
      ...templateFiles('harbourside-coa'),
    };
    for (const f of ['northline-sep26.pdf', 'northline-jun26.pdf', 'northline-jul26.pdf'])
      Object.assign(files, pdfFile(`Templates/${ID}/samples/${f}`, f));
    for (const f of [
      'northline-aug26.pdf',
      'apex-fleet-sep26.pdf',
      'ridgeway-invoice-88231.pdf',
      'harbourside-coa-a2391.pdf',
      'corrupt.pdf',
    ])
      Object.assign(files, pdfFile(`Inbox/${f}`, f));
    await ready(page, files);
    await shot(page, s('04-templates'));

    await page.goto(`./?view=mapper&template=${ID}`);
    await expect(page.locator('.tok').first()).toBeAttached();
    await page
      .getByRole('button', { name: 'Resume' })
      .click({ timeout: 1000 })
      .catch(() => undefined);
    await shot(page, s('05-mapper'));

    await page.goto(`./?view=test&template=${ID}`);
    await expect(page.getByRole('heading', { name: /checks passed across/ })).toBeVisible();
    await shot(page, s('06-test-samples'));

    await page.goto('./?view=process');
    await shot(page, s('07-process-before'));
    await page.getByRole('button', { name: /^Process \d+ files$/ }).click();
    await expect(page.getByRole('main').getByText(/^Processed just now/)).toBeVisible({
      timeout: 120_000,
    });
    await shot(page, s('08-process-done'));

    await page.goto('./?view=review');
    await shot(page, s('09-review-list'));
    await page.getByRole('button', { name: 'Open' }).first().click();
    await page.waitForTimeout(800);
    await shot(page, s('10-review-detail'));

    await page.getByRole('button', { name: 'Settings' }).click();
    await shot(page, s('11-settings'));

    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./?view=process');
    await shot(page, s('12-mobile'));
  });
}
