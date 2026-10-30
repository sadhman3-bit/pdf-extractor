import { readFileSync } from 'node:fs';
import { test, expect, ready, startFromSample, expectNoAxe } from './helpers';
import { parseCsv } from '../src/workspace/csv';
import { businessRows } from '../../../tools/fixtures/src/business';

test('a new PDF opens with its table found, one row per block, and rows can be changed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await ready(page);
  await startFromSample(page, 'business-invoice-digital.pdf', { autoTable: true });
  const rows = page.getByRole('region', { name: 'Your table' });
  await expect(rows.getByText('Table found · 16 rows')).toBeVisible();
  await expect(rows.getByRole('radio', { name: /A block: heading to total/ })).toBeChecked();
  // Each block is boxed on the page, from heading to total.
  await page.getByRole('button', { name: /^Page 2,/ }).click();
  await expect(page.locator('.mark-row, .mark-row-check').first()).toBeAttached();
  // The CSV is the four columns, every row.
  const output = page.getByRole('region', { name: 'Output' });
  const pending = page.waitForEvent('download');
  await output.getByRole('button', { name: 'Download CSV' }).click();
  const csv = parseCsv(readFileSync((await (await pending).path())!, 'utf8'));
  expect(csv[0]).toEqual(['Name', 'PhoneNumber', 'ExclGST', 'InclGST']);
  expect(csv.slice(1)).toEqual(
    businessRows.map((r) => [r.Name, r.PhoneNumber, r.ExclGST.toFixed(2), r.InclGST.toFixed(2)]),
  );
  // One row per item instead, then back to blocks.
  await rows.getByRole('radio', { name: /Each item line/ }).check();
  await expect(rows.getByRole('radio', { name: /Each item line/ })).toBeChecked();
  await expect(rows.getByText('Table found · 16 rows')).toHaveCount(0);
  await rows.getByRole('radio', { name: /A block: heading to total/ }).check();
  await expect(rows.getByText('Table found · 16 rows')).toBeVisible();
  await expectNoAxe(page);
});
