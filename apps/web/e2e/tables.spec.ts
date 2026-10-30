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

/** Clicks a word of the table's header row, then a word of the line where it ends. */
async function mapTable(page: Page, header: string, name: string, end: string): Promise<void> {
  await tok(page, header).click();
  await page.getByRole('button', { name: 'Map the table under this header row' }).click();
  await expect(page.getByRole('textbox', { name: 'Table name' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Table name' }).fill(name);
  await tok(page, end).click();
  await page.getByRole('button', { name: /^The table ends here$/ }).click();
}

/** Clicks the ruler above the table just left of a word: a column break goes there. */
async function breakBefore(page: Page, word: string): Promise<void> {
  const ruler = page.locator('.ruler-bar');
  const t = (await tok(page, word).boundingBox())!;
  const r = (await ruler.boundingBox())!;
  await ruler.click({ position: { x: t.x - r.x - 2, y: r.height / 2 } });
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
  await mapTable(page, 'Litres', 'Transactions', 'Subtotal');
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
  await mapTable(page, 'Specification', 'Results', 'Conclusion:');
  await saveAndCompare(page, 'harbourside-coa-a2391.pdf');
});

test('maps a grouped service summary by clicking lines', async ({ page }) => {
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  await tok(page, 'Summary').click();
  await page.getByRole('button', { name: 'Map the table under this header row' }).click();
  await expect(page.getByText(/^Table marked\./)).toBeVisible();
  const choose = async (word: string, choice: RegExp) => {
    await tok(page, word).click();
    await expect(page.getByRole('heading', { name: 'What is this line?' })).toBeVisible();
    await page.getByRole('button', { name: choice }).click();
  };
  await choose('Telephone', /^A heading: copy “02 5550 0160 AVC000055510432”/);
  await choose('Services', /^A heading: copy “Services and equipment rental”/);
  // The period gets its own column: a break on the ruler, just left of it.
  await breakBefore(page, '25');
  await expect(
    page.locator('.toast').getByText('New column Column5. Rename it on the left.'),
  ).toBeVisible();
  // The margin shows how each line was read; "Rental" lines are part of the row above.
  await expect(page.locator('.line-mark-heading').first()).toBeVisible();
  await expect(page.locator('.line-mark-part').first()).toBeVisible();
  await choose('Rental', /^A second line: put “Rental”/);
  await expect(
    page.getByRole('region', { name: 'Output' }).getByRole('columnheader', { name: /^Detail/ }),
  ).toBeVisible();
  // 26 items, then the call details on the last page: end the table there.
  for (let i = 0; i < 6 && !(await tok(page, 'Call').count()); i++)
    await page.getByRole('button', { name: 'Next page' }).click();
  await choose('Call', /^The table ends here$/);
  await expect(page.getByText('Items · 26 rows')).toBeVisible();
  // Undo puts the end back; removing a column works too.
  // Undo (Ctrl+Z) removes the end again.
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Items · 30 rows')).toBeVisible();
  await page.getByRole('button', { name: 'Remove column Column5' }).click();
  await expect(page.getByRole('button', { name: 'Remove column Column5' })).toHaveCount(0);
  // Table settings read in plain words, with no patterns to write.
  await page.getByText('Table settings: header, rows, skipped lines, headings').click();
  await expect(
    page.getByRole('combobox', { name: 'Kind of line for skipped line rule 1' }),
  ).toHaveValue('pageNumbers');
  await expect(page.getByRole('textbox', { name: 'Text for skipped line rule 2' })).toHaveValue(
    'Total for',
  );
  await page.getByRole('button', { name: 'Add a line to skip' }).click();
  await expect(page.getByRole('textbox', { name: 'Text for skipped line rule 3' })).toHaveValue(
    'Total',
  );
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
  await tok(page, 'Summary').click();
  await page.getByRole('button', { name: 'Map the table under this header row' }).click();
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
  expect(text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe(
    'Item,ServiceSummary,ExclGST,InclGST,Telephone',
  );
  expect(text).toContain('SVC102B');
  await expectNoAxe(page);
});

test('a header row with numbers, and a column without a heading', async ({ page }) => {
  await ready(page);
  await startFromSample(page, 'summit-voice-activity.pdf');
  // The header ("Account Activity · Your Reference 55-10 2047") isn't offered on its
  // own, so choose it.
  await page.getByRole('button', { name: 'Choose the header row on the page' }).click();
  await tok(page, 'Activity').click();
  await expect(page.getByText(/^Table marked\./)).toBeVisible();
  const output = page.getByRole('region', { name: 'Output' });
  await expect(output.getByRole('columnheader')).toHaveCount(2);
  // An amount with no heading: a break on the ruler just left of it makes it a column.
  await breakBefore(page, '$38.27');
  await expect(output.getByRole('columnheader')).toHaveCount(3);
  await expect(output.getByRole('cell', { name: /\$?4,457\.38|4457\.38/ })).toBeVisible();
  // Arrow keys move a break; × takes it away and Undo brings it back.
  const handle = page.getByRole('button', { name: /^Column break between \w+ and Column3\./ });
  await handle.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(output.getByRole('columnheader')).toHaveCount(3);
  await handle.focus();
  await page
    .getByRole('button', { name: /^Remove the column break between \w+ and Column3$/ })
    .click();
  await expect(output.getByRole('columnheader')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect(output.getByRole('columnheader')).toHaveCount(3);
  // Below the table's end ("Total"), a value is a bill detail.
  await tok(page, '$645.88').click();
  await expect(page.getByRole('combobox', { name: 'Name' })).toBeVisible();
  await expectNoAxe(page);
});
