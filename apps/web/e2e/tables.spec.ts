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
  await modes.getByRole('button', { name: 'Map table row' }).click();
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
