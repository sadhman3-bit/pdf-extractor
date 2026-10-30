import { readFileSync } from 'node:fs';
import { test, expect, ready, startFromSample } from './helpers';
import { parseCsv } from '../src/workspace/csv';
import { businessRows } from '../../../tools/fixtures/src/business';

test('one digital name example produces the full CSV while the source stays visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await ready(page);
  await startFromSample(page, 'business-invoice-digital.pdf');
  await page.getByRole('button', { name: 'Start labelling', exact: true }).click();
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.locator('.tok[data-text="West"]').click();
  await page
    .locator('.tok[data-text="Depot"]')
    .first()
    .click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Use this example', exact: true }).click();
  const output = page.getByRole('region', { name: 'Output' });
  await expect(output.getByText('16 rows', { exact: true })).toBeVisible();
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    const source = await page.locator('.mapper-page').boundingBox();
    const dock = await output.boundingBox();
    expect(source!.height).toBeGreaterThan(300);
    expect(dock!.y).toBeGreaterThanOrEqual(source!.y + source!.height - 1);
  }
  const pending = page.waitForEvent('download');
  await output.getByRole('button', { name: 'Download CSV' }).click();
  const download = await pending;
  const csv = parseCsv(readFileSync((await download.path())!, 'utf8'));
  expect(csv[0]).toEqual(['Name', 'PhoneNumber', 'ExclGST', 'InclGST']);
  expect(csv.slice(1)).toEqual(
    businessRows.map((r) => [r.Name, r.PhoneNumber, r.ExclGST.toFixed(2), r.InclGST.toFixed(2)]),
  );
});
