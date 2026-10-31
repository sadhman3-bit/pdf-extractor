import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  test,
  expect,
  resetApp,
  fixturePdf,
  golden,
  stableCsv,
  expectNoAxe,
  ROOT,
} from './helpers';

test('basic mode imports a template, extracts opened files and downloads the CSV', async ({
  page,
}) => {
  // As if the browser had no folder access (Firefox, Safari).
  await page.addInitScript(() => {
    (window as unknown as { __PDFX_TEST_WORKSPACE__: object }).__PDFX_TEST_WORKSPACE__ = {
      basic: true,
    };
  });
  await resetApp(page);
  await expect(page.getByText('Saved in this browser')).toBeVisible();
  await expectNoAxe(page);

  await page.goto('./?view=templates');
  const template = join(ROOT, 'fixtures', 'templates', 'northline-fuel-statement', 'v2.json');
  await page.getByLabel('Import JSON').setInputFiles({
    name: 'v2.json',
    mimeType: 'application/json',
    buffer: readFileSync(template),
  });
  await expect(page.getByText('Imported 1 template')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Northline Fuel statement/ })).toBeVisible();

  await page.goto('./?view=process');
  await expect(
    page.getByText('Files are read only in basic mode. Nothing is moved.'),
  ).toBeVisible();
  const file = 'northline-sep26.pdf';
  await page.getByLabel('Open PDF files').setInputFiles({
    name: file,
    mimeType: 'application/pdf',
    buffer: fixturePdf(file),
  });
  await expect(page.locator(`tr[data-file="${file}"] td`).nth(3)).toContainText('Extracted');
  await expectNoAxe(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('northline-sep26.csv');
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(stableCsv(csv)).toEqual(stableCsv(golden('northline-sep26.csv')));
  // After the first download, a folder is offered once.
  const offer = page.getByText('Want results saved to a folder automatically?');
  await expect(offer).toBeVisible();
  await expectNoAxe(page);
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(offer).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Process inbox' })).toBeVisible();
  await expect(offer).toHaveCount(0);
});
