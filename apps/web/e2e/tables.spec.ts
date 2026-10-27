import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, ready, expectNoAxe, startFromSample, savedTemplate } from './helpers';
import { extractWithSaved, goldenJson } from './engine';

const tok = (page: Page, text: string) => page.locator(`.tok[data-text="${text}"]`).first();

/** Maps one value; words the click didn't take are added with Shift-click. Renames when needed. */
async function mapField(page: Page, words: string[], name: string): Promise<void> {
  await tok(page, words[0]!).click();
  for (const w of words.slice(1))
    if (!(await tok(page, w).evaluate((el) => el.classList.contains('tok-selected'))))
      await tok(page, w).click({ modifiers: ['Shift'] });
  const box = page.getByRole('combobox', { name: 'Name' });
  if ((await box.inputValue()) !== name) await box.fill(name);
  await page.getByRole('button', { name: 'Done' }).click();
}

async function mapTable(page: Page, cell: string, name: string, end: string): Promise<void> {
  const modes = page.getByRole('group', { name: 'Mapping mode' });
  await modes.getByRole('button', { name: 'Map a table' }).click();
  await tok(page, cell).click();
  await expect(page.getByRole('textbox', { name: 'Table name' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Table name' }).fill(name);
  await modes.getByRole('button', { name: 'Set end marker' }).click();
  await tok(page, end).click();
}

async function saveAndCompare(page: Page, file: string): Promise<void> {
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('main').getByText('Saved as version 1')).toBeVisible();
  const { json } = await savedTemplate(page);
  const out = await extractWithSaved(file, json);
  const want = goldenJson(file.replace(/\.pdf$/, ''));
  expect(out.fields).toEqual(want.fields);
  expect(out.tables).toEqual(want.tables);
  expect(out.status).toBe('ok');
}

test('maps the Northline table through the interface; output equals the golden', async ({
  page,
}) => {
  await ready(page);
  await startFromSample(page, 'northline-sep26.pdf');
  await mapField(page, ['ST-48213'], 'StatementNo');
  await mapField(page, ['30/09/2026'], 'StatementDate');
  await mapField(page, ['$38.56'], 'TotalGST');
  await mapField(page, ['$424.18'], 'TotalDue');
  await mapTable(page, '03/09/2026', 'Transactions', 'Subtotal');
  await expect(page.getByText(/Transactions · \d+ rows/)).toBeVisible();
  await expectNoAxe(page);
  await saveAndCompare(page, 'northline-sep26.pdf');
});

test('maps the COA results table through the interface; output equals the golden', async ({
  page,
}) => {
  await ready(page);
  await startFromSample(page, 'harbourside-coa-a2391.pdf');
  await mapField(page, ['Citric', 'Acid', 'Anhydrous'], 'Product');
  await mapField(page, ['HC-2391'], 'ProductCode');
  await mapField(page, ['A2391-07'], 'LotNumber');
  await mapField(page, ['14/08/2026'], 'ManufactureDate');
  await mapField(page, ['14/08/2028'], 'ExpiryDate');
  await mapField(page, ['PO-55102'], 'PONumber');
  await mapTable(page, 'Appearance', 'Results', 'Conclusion:');
  await saveAndCompare(page, 'harbourside-coa-a2391.pdf');
});

test('maps a grouped service summary by clicking lines', async ({ page }) => {
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  const modes = page.getByRole('group', { name: 'Mapping mode' });
  await modes.getByRole('button', { name: 'Map a table' }).click();
  await tok(page, 'Summary').click();
  await expect(page.getByText('Table found. Now click any line in it')).toBeVisible();
  const choose = async (word: string, choice: RegExp) => {
    await tok(page, word).click();
    await expect(page.getByRole('heading', { name: 'What is this line?' })).toBeVisible();
    await page.getByRole('button', { name: choice }).click();
  };
  await choose('Telephone', /^A heading: copy “02 5550 0160 AVC000055510432”/);
  await choose('Services', /^A heading: copy “Services and equipment rental”/);
  await choose('25', /^A new column starts at “25 Dec to 24 Jan”$/);
  // 26 items, then the call details on the last page: end the table there.
  for (let i = 0; i < 6 && !(await tok(page, 'Call').count()); i++)
    await page.getByRole('button', { name: 'Next page' }).click();
  await choose('Call', /^The table ends here$/);
  await expect(page.getByText('Items · 26 rows')).toBeVisible();
  // Undo puts the end back; removing a column works too.
  // The newest toast's Undo removes the end again.
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect(page.getByText('Items · 30 rows')).toBeVisible();
  await page.getByRole('button', { name: 'Remove column Column5' }).click();
  await expect(page.getByRole('button', { name: 'Remove column Column5' })).toHaveCount(0);
  await expectNoAxe(page);
});

test('the output shows every row, finds a value on the page and downloads the CSV', async ({
  page,
}) => {
  // Run the preview in the worker, as it does for long bills.
  await page.addInitScript(() => {
    (window as unknown as { __PDFX_TEST_WORKSPACE__: object }).__PDFX_TEST_WORKSPACE__ = {
      previewWorkerWords: 0,
    };
  });
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  const output = page.getByRole('region', { name: 'Output' });
  await expect(output.getByText(/Click a value or map a table/)).toBeVisible();
  await page
    .getByRole('group', { name: 'Mapping mode' })
    .getByRole('button', { name: 'Map a table' })
    .click();
  await tok(page, 'Summary').click();
  await tok(page, 'Telephone').click();
  await page.getByRole('button', { name: /^A heading/ }).click();
  await expect(output.getByRole('columnheader', { name: /Telephone/ })).toBeVisible();
  await expect(output.getByText(/^\d+ rows$/)).toBeVisible();
  // A value in the output is shown on the page.
  await output.getByRole('button', { name: /^Item: SVC102B\./ }).click();
  await expect(page.locator('.tok.tok-selected[data-text="SVC102B"]')).toBeVisible();
  // The CSV downloads with the same columns.
  const download = page.waitForEvent('download');
  await output.getByRole('button', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('summit-voice-jan26.csv');
  const text = readFileSync(await file.path(), 'utf8');
  expect(text.split('\r\n')[0]).toContain(
    'Item,ServiceSummary,ExclGST,InclGST,Telephone,_SourceFile',
  );
  expect(text).toContain('SVC102B');
  await expectNoAxe(page);
});
