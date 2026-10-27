import {
  test,
  expect,
  ready,
  readWs,
  listWs,
  existsWs,
  templateFiles,
  pdfFile,
  expectNoAxe,
} from './helpers';
import { parseCsv } from '../src/workspace/csv';

const FILE = 'northline-sep26-card2-scan.pdf';
const BASE = 'northline-sep26-card2-scan';
const OUT = 'Output/northline-fuel-statement';

test('correcting row 4 of the scan turns the checks green; approving saves corrected outputs', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await ready(
    page,
    { ...templateFiles('northline-fuel-statement'), ...pdfFile(`Inbox/${FILE}`, FILE) },
    'process',
  );
  await page.getByRole('button', { name: 'Process 1 file' }).click();
  await expect(page.getByRole('main').getByText(/^Processed just now/)).toBeVisible({
    timeout: 280_000,
  });

  // The list, then the detail view.
  await page.goto('./?view=review');
  await expect(page.getByRole('cell', { name: FILE })).toBeVisible();
  await expectNoAxe(page);
  await page.getByRole('button', { name: 'Open' }).first().click();
  await expect(page.getByRole('button', { name: 'Approve and save' })).toBeDisabled();
  await expect(page.getByText(/Short by \$9\.00/)).toBeVisible();
  // A file the template read with problems can go to the Mapper to fix the template.
  await expect(
    page.getByRole('button', { name: /^Fix the .+ template with this file$/ }),
  ).toBeVisible();
  await expectNoAxe(page);

  const amount = page.getByRole('textbox', { name: 'Transactions row 4 Amount' });
  await expect(amount).toHaveValue('34.32');
  await amount.fill('43.32');
  await expect(page.getByText('All checks pass. Approve to save the outputs.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve and save' }).click();
  await expect(page.getByRole('main').getByText(`Approved ${FILE}. Outputs saved.`)).toBeVisible();

  // Outputs carry the correction.
  const json = JSON.parse(await readWs(page, `${OUT}/${BASE}.json`));
  expect(json.status).toBe('ok');
  expect(json.reviewedBy).toBe('Sam Tester');
  expect(json.tables.Transactions[3].Amount).toBe(43.32);
  expect(json.corrections).toContainEqual(
    expect.objectContaining({
      table: 'Transactions',
      row: 3,
      field: 'Amount',
      from: 34.32,
      to: 43.32,
    }),
  );
  const csv = parseCsv(await readWs(page, `${OUT}/${BASE}.csv`)).filter((r) => r.some(Boolean));
  const head = csv[0]!;
  for (const r of csv.slice(1)) {
    expect(r[head.indexOf('_Corrected')]).toBe('true');
    expect(r[head.indexOf('_ReviewedBy')]).toBe('Sam Tester');
  }
  expect(csv[4]![head.indexOf('Amount')]).toBe('43.32');

  // The file moved to Processed and the review file is gone.
  const months = (await listWs(page, 'Processed')).filter((m) => /^\d{4}-\d{2}$/.test(m));
  expect(await listWs(page, `Processed/${months[0]}`)).toContain(FILE);
  expect(await existsWs(page, `Exceptions/${FILE}`)).toBe(false);
  expect(await existsWs(page, `Exceptions/${BASE}.review.json`)).toBe(false);

  // Audit lines for the correction and the approval.
  const auditFile = (await listWs(page, 'Audit/Sam Tester'))[0]!;
  const audit = parseCsv(await readWs(page, `Audit/Sam Tester/${auditFile}`));
  const ah = audit[0]!;
  const lines = audit.slice(1).filter((r) => r[ah.indexOf('File')] === FILE);
  const corrected = lines.find((r) => r[ah.indexOf('Action')] === 'corrected');
  expect(corrected?.[ah.indexOf('OldValue')]).toBe('34.32');
  expect(corrected?.[ah.indexOf('NewValue')]).toBe('43.32');
  expect(lines.some((r) => r[ah.indexOf('Action')] === 'approved')).toBe(true);
});
