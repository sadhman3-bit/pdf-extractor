import type { Page } from '@playwright/test';
import { test, expect, ready, expectNoAxe, startFromSample } from './helpers';

const tok = (page: Page, text: string) => page.locator(`.tok[data-text="${text}"]`).first();

test('finds text, shows the table on the page strip, and maps a second table', async ({ page }) => {
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  await tok(page, 'Summary').click();
  await page.getByRole('button', { name: 'Map the table under this header row' }).click();
  const strip = page.getByRole('navigation', { name: 'Pages' });
  await expect(
    strip.getByRole('button', { name: /^Page 1, the table starts here, \d+ rows/ }),
  ).toBeVisible();

  // Find goes to the page with the text and selects it.
  const find = page.getByRole('searchbox', { name: 'Find on the pages' });
  await find.fill('Call details');
  await find.press('Enter');
  await expect(page.locator('.tok.tok-selected[data-text="Call"]')).toBeVisible();
  await expect(strip.locator('[aria-current="page"]')).toHaveAccessibleName(/1 found/);

  // The call details end the first table and become a second one, a CSV of their own.
  await tok(page, 'Call').click();
  await page.getByRole('button', { name: /^The table ends here$/ }).click();
  await page.getByRole('button', { name: 'Add another table' }).click();
  await tok(page, 'Duration').click();
  const tables = page.getByRole('group', { name: 'Tables' });
  await expect(tables.getByRole('button', { name: 'Table2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const output = page.getByRole('region', { name: 'Output' });
  await expect(output.getByRole('columnheader', { name: /^Duration/ })).toBeVisible();
  // Switching back shows the first table's output again.
  await tables.getByRole('button', { name: 'Items' }).click();
  await expect(output.getByRole('columnheader', { name: /^Item\b/ })).toBeVisible();
  await expectNoAxe(page);
});

test('one row per service, from its "Total for" line', async ({ page }) => {
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  await tok(page, 'Summary').click();
  await page.getByRole('button', { name: 'Map the table under this header row' }).click();
  await tok(page, 'Telephone').click();
  await page.getByRole('button', { name: /^A heading/ }).click();
  await tok(page, 'Total').click();
  await page.getByRole('button', { name: /^Make lines starting “Total for” the rows/ }).click();
  const output = page.getByRole('region', { name: 'Output' });
  await expect(output.getByText('12 rows', { exact: true })).toBeVisible();
  await expect(output.getByText(/^Total for 02 5550/).first()).toBeVisible();
  await expect(output.getByRole('columnheader', { name: 'Telephone, Text' })).toBeVisible();
  await expectNoAxe(page);
});
