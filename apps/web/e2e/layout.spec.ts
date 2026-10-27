import type { Page } from '@playwright/test';
import { test, expect, ready, expectNoAxe, startFromSample } from './helpers';

const tok = (page: Page, text: string) => page.locator(`.tok[data-text="${text}"]`).first();

test('a shared CSV layout gives the same columns, filled from this template', async ({ page }) => {
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  await tok(page, 'Summary').click();
  await page.getByRole('button', { name: 'Map the table under this header row' }).click();

  // Save this template's columns as a layout other templates can use.
  await page.getByText('CSV layout: this template’s own columns').click();
  await page.getByRole('textbox', { name: 'Name for a new shared layout' }).fill('Telco bills');
  await page.getByRole('button', { name: 'Save as a shared layout' }).click();
  await expect(page.getByText('CSV layout: Telco bills', { exact: true })).toBeVisible();

  // A column renamed here no longer matches; fill the layout's column from it.
  await page.getByRole('textbox', { name: 'Column name Item' }).fill('Code');
  await expect(page.getByText('CSV layout: Telco bills · 1 not in this bill yet')).toBeVisible();
  const output = page.getByRole('region', { name: 'Output' });
  await expect(
    output.getByRole('columnheader', { name: 'Item, Not in this bill yet' }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Fill Item from' }).selectOption('Code');
  await expect(page.getByText('CSV layout: Telco bills', { exact: true })).toBeVisible();
  await expect(output.getByRole('columnheader', { name: 'Item, Text' })).toBeVisible();
  await expectNoAxe(page);
});
