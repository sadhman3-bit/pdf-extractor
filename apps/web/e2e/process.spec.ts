import type { Page } from '@playwright/test';
import {
  test,
  expect,
  ready,
  readWs,
  listWs,
  existsWs,
  templateFiles,
  pdfFile,
  golden,
  stableCsv,
  expectNoAxe,
} from './helpers';

const TEMPLATES = [
  'northline-fuel-statement',
  'coastal-telco-bill',
  'apex-fleet-invoice',
  'harbourside-coa',
];

/** Fixture → expected status label and template id (null when it has none). */
const EXPECTED: Record<string, { status: string; template: string | null }> = {
  'northline-sep26.pdf': { status: 'Extracted', template: 'northline-fuel-statement' },
  'northline-jun26.pdf': { status: 'Extracted', template: 'northline-fuel-statement' },
  'northline-jul26.pdf': { status: 'Extracted', template: 'northline-fuel-statement' },
  'northline-aug26.pdf': { status: 'Extracted', template: 'northline-fuel-statement' },
  'coastal-telco-sep26.pdf': { status: 'Extracted', template: 'coastal-telco-bill' },
  'apex-fleet-sep26.pdf': { status: 'Extracted', template: 'apex-fleet-invoice' },
  'harbourside-coa-a2391.pdf': { status: 'Extracted', template: 'harbourside-coa' },
  'rotated.pdf': { status: 'Extracted', template: 'northline-fuel-statement' },
  'ridgeway-invoice-88231.pdf': { status: 'Unknown supplier', template: null },
  'encrypted.pdf': { status: 'Could not read', template: null },
  'corrupt.pdf': { status: 'Could not read', template: null },
  'blank.pdf': { status: 'Could not read', template: null },
};

function seedFiles(names: string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const t of TEMPLATES) Object.assign(files, templateFiles(t));
  for (const f of names) Object.assign(files, pdfFile(`Inbox/${f}`, f));
  return files;
}

async function processAll(page: Page, n: number): Promise<void> {
  await page.getByRole('button', { name: `Process ${n} ${n === 1 ? 'file' : 'files'}` }).click();
  await expect(page.getByRole('main').getByText(/^Processed just now/)).toBeVisible({
    timeout: 90_000,
  });
}

const statusOf = (page: Page, file: string) => page.locator(`tr[data-file="${file}"] td`).nth(3);

async function processedFiles(page: Page): Promise<string[]> {
  const months = (await listWs(page, 'Processed')).filter((m) => /^\d{4}-\d{2}$/.test(m));
  const out: string[] = [];
  for (const m of months) out.push(...(await listWs(page, `Processed/${m}`)));
  return out;
}

test('processing the inbox gives the expected status for every file; outputs equal the goldens', async ({
  page,
}) => {
  const names = Object.keys(EXPECTED);
  await ready(page, seedFiles(names), 'process');
  await expect(page.getByRole('heading', { name: 'Process inbox', level: 1 })).toBeVisible();
  await expectNoAxe(page);
  await processAll(page, names.length);

  for (const [file, want] of Object.entries(EXPECTED))
    await expect(statusOf(page, file), file).toContainText(want.status);
  await expect(page.getByRole('heading', { name: 'Written to Output' })).toBeVisible();
  await expectNoAxe(page);

  const processed = await processedFiles(page);
  const exceptions = await listWs(page, 'Exceptions');
  for (const [file, want] of Object.entries(EXPECTED)) {
    const base = file.replace(/\.pdf$/, '');
    if (want.status === 'Extracted') {
      expect(processed, file).toContain(file);
      const json = JSON.parse(await readWs(page, `Output/${want.template}/${base}.json`));
      const gold = JSON.parse(golden(`${base}.json`));
      expect(json.status).toBe('ok');
      expect(json.fields, file).toEqual(gold.fields);
      expect(json.tables, file).toEqual(gold.tables);
      expect(json.template, file).toEqual(gold.template);
      const csv = await readWs(page, `Output/${want.template}/${base}.csv`);
      expect(stableCsv(csv), file).toEqual(stableCsv(golden(`${base}.csv`)));
    } else {
      expect(exceptions, file).toContain(file);
      expect(exceptions, file).toContain(`${base}.review.json`);
    }
  }
  expect(await listWs(page, 'Inbox')).toEqual([]);

  // One audit line per file, with the processing action.
  const months = await listWs(page, 'Audit/Sam Tester');
  const audit = await readWs(page, `Audit/Sam Tester/${months[0]}`);
  for (const file of names) expect(audit).toContain(file);
});

test('a crash between writing outputs and moving the file leaves no duplicates on re-run', async ({
  page,
}) => {
  const file = 'northline-sep26.pdf';
  await ready(page, seedFiles([file]), 'process');
  await page.evaluate(() => {
    (
      window as unknown as { __PDFX_TEST_WORKSPACE__: { crashAfterStep: number } }
    ).__PDFX_TEST_WORKSPACE__.crashAfterStep = 5;
  });
  await page.getByRole('button', { name: 'Process 1 file' }).click();
  await expect(page.getByText(/Simulated crash after step 5/)).toBeVisible({ timeout: 60_000 });
  // Outputs were written but the PDF is still in the Inbox.
  expect(await existsWs(page, 'Output/northline-fuel-statement/northline-sep26.json')).toBe(true);
  expect(await listWs(page, 'Inbox')).toEqual([file]);

  await page.reload();
  await processAll(page, 1);
  await expect(statusOf(page, file)).toContainText('Already processed');
  expect(await listWs(page, 'Inbox')).toEqual([]);
  expect(await processedFiles(page)).toEqual([file]);
  const out = (await listWs(page, 'Output/northline-fuel-statement')).sort();
  expect(out).toEqual(['northline-sep26.csv', 'northline-sep26.json']);
});
