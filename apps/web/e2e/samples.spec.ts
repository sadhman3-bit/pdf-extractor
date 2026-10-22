import type { Page } from '@playwright/test';
import { test, expect, ready, readWs, templateFiles, pdfFile, expectNoAxe } from './helpers';

const ID = 'northline-fuel-statement';
const SAMPLES = [
  'northline-sep26.pdf',
  'northline-jun26.pdf',
  'northline-jul26.pdf',
  'northline-aug26.pdf',
];

/** The grid cell for a row label and a sample column. */
async function cell(page: Page, row: string, sample: string) {
  const heads = await page.locator('table.data thead th').allTextContents();
  const col = heads.findIndex((h) => h.includes(sample));
  return page
    .locator('table.data tbody tr', {
      has: page.getByRole('rowheader', { name: row, exact: true }),
    })
    .locator('td')
    .nth(col - 1);
}

test('label fixes from the June sample make every check pass on all four samples', async ({
  page,
}) => {
  const files: Record<string, string> = { ...templateFiles(ID, [1]) };
  for (const s of SAMPLES) Object.assign(files, pdfFile(`Templates/${ID}/samples/${s}`, s));
  await ready(page, files);
  await page.goto(`./?view=test&template=${ID}`);
  await expect(page.getByRole('heading', { name: /checks passed across 4 samples/ })).toBeVisible();

  // June fails TotalGST and TotalDue at first.
  for (const f of ['TotalGST', 'TotalDue'])
    await expect(await cell(page, f, 'northline-jun26.pdf')).toHaveClass(/cell-fail/);
  for (const s of SAMPLES.filter((x) => !x.includes('jun')))
    await expect(await cell(page, 'TotalDue', s)).toHaveClass(/cell-pass/);
  await expectNoAxe(page);

  const fixes = page.getByRole('heading', { name: 'Suggested fixes' }).locator('..');
  await expect(fixes.getByText('Add ‘GST included’ as another label for TotalGST')).toBeVisible();
  await expect(fixes.getByText('Add ‘Amount payable’ as another label for TotalDue')).toBeVisible();
  while (await fixes.getByRole('button', { name: 'Apply' }).count()) {
    await fixes.getByRole('button', { name: 'Apply' }).first().click();
  }

  const summary = page.getByRole('heading', { name: /checks passed across 4 samples/ });
  await expect(summary).toHaveText(/^(\d+) of \1 checks passed across 4 samples$/);
  await expect(page.locator('td.cell-fail')).toHaveCount(0);

  // The draft now carries the version 2 labels.
  const draft = JSON.parse(await readWs(page, `Templates/${ID}/draft.json`));
  const labels = Object.fromEntries(
    draft.template.fields.map((f: { name: string; anchor: { labels: string[] } }) => [
      f.name,
      f.anchor.labels,
    ]),
  );
  expect(labels.TotalGST).toEqual(['Total GST', 'GST included']);
  expect(labels.TotalDue).toEqual(['Total Due', 'Amount payable']);
});
