import type { Page } from '@playwright/test';
import { test, expect, ready, readWs, listWs, pdfFile } from './helpers';

const FILE = 'ridgeway-invoice-88231.pdf';

async function mapValue(page: Page, text: string, name: string): Promise<void> {
  await page.locator(`.tok[data-text="${text}"]`).first().click();
  const box = page.getByRole('combobox', { name: 'Name' });
  if ((await box.inputValue()) !== name) await box.fill(name);
  await page.getByRole('button', { name: 'Done' }).click();
}

test('a template created from an unknown invoice extracts it on re-run', async ({ page }) => {
  await ready(page, pdfFile(`Inbox/${FILE}`, FILE), 'process');
  await page.getByRole('button', { name: 'Process 1 file' }).click();
  await expect(page.locator(`tr[data-file="${FILE}"] td`).nth(3)).toContainText('Unknown supplier');

  // Review → create a template from this file.
  await page.goto(`./?view=review&file=${encodeURIComponent(FILE)}`);
  await page.getByRole('button', { name: 'Create template from this file' }).click();
  await expect(page).toHaveURL(/view=mapper&template=/);
  await expect(page.locator('.tok').first()).toBeAttached();
  await page.getByRole('button', { name: 'Use detailed mapping', exact: true }).click();
  await mapValue(page, '88231', 'InvoiceNumber');
  await mapValue(page, '15/09/2026', 'InvoiceDate');
  await mapValue(page, 'PO-66104', 'PONumber');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('main').getByText('Saved as version 1')).toBeVisible();

  // The Mapper offers to go back to the file; re-run it there.
  await expect(
    page.getByText(`This template was started from ${FILE}.`, { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Go to the file to re-run it' }).click();
  await page.getByRole('button', { name: 'Re-run this file' }).click();
  await expect(page.getByRole('main').getByText(`Extracted: ${FILE}`)).toBeVisible();

  const id = (await listWs(page, 'Templates')).find((d) => d.startsWith('ridgeway'))!;
  const json = JSON.parse(await readWs(page, `Output/${id}/ridgeway-invoice-88231.json`));
  expect(json.status).toBe('ok');
  expect(json.fields).toEqual({
    InvoiceNumber: '88231',
    InvoiceDate: '2026-09-15',
    PONumber: 'PO-66104',
  });
  expect(await listWs(page, 'Exceptions')).not.toContain(FILE);
});
