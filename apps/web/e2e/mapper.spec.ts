import type { Page } from '@playwright/test';
import { test, expect, ready, expectNoAxe, startFromSample, savedTemplate } from './helpers';
import { extractWithSaved, goldenJson } from './engine';

const HEADER = [
  { text: 'ST-48213', name: 'StatementNo' },
  { text: '30/09/2026', name: 'StatementDate' },
  { text: '$38.56', name: 'TotalGST' },
  { text: '$424.18', name: 'TotalDue' },
];

async function nameOfOpenField(page: Page): Promise<string> {
  return page.getByRole('combobox', { name: 'Name' }).inputValue();
}

test('maps Northline header fields from scratch; output equals the golden', async ({ page }) => {
  await ready(page);
  await startFromSample(page, 'northline-sep26.pdf');
  await expectNoAxe(page);
  for (const h of HEADER) {
    await page.locator(`.tok[data-text="${h.text}"]`).first().click();
    await expect(page.getByRole('group', { name: /^Field / })).toBeVisible();
    if ((await nameOfOpenField(page)) !== h.name)
      await page.getByRole('combobox', { name: 'Name' }).fill(h.name);
    await page.getByRole('button', { name: 'Done' }).click();
  }
  await expectNoAxe(page);
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('main').getByText('Saved as version 1')).toBeVisible();
  const { json } = await savedTemplate(page);
  const out = await extractWithSaved('northline-sep26.pdf', json);
  expect(out.fields).toEqual(goldenJson('northline-sep26').fields);
  // Templates library lists it and passes axe.
  await page.goto('./?view=templates');
  await expect(page.locator('.tpl-card').getByText('v1', { exact: true })).toBeVisible();
  await expectNoAxe(page);
});

async function focusToken(page: Page, text: string): Promise<void> {
  const viewer = page.getByRole('group', { name: /^PDF page \d/ });
  // Index of the focused word in the overlay (-1 while nothing is focused).
  const focused = () =>
    viewer.evaluate((el) =>
      [...el.querySelectorAll('.tok')].findIndex((t) => t.classList.contains('tok-focus')),
    );
  const textAt = (i: number) => viewer.locator('.tok').nth(i).getAttribute('data-text');
  await viewer.focus();
  await page.keyboard.press('Home');
  await expect.poll(focused).toBe(0);
  const count = await viewer.locator('.tok').count();
  for (let i = 0; i < count; i++) {
    if ((await textAt(i)) === text) {
      await expect(viewer.locator('.sr-only')).toHaveText(`Word: ${text}`);
      return;
    }
    await page.keyboard.press('ArrowRight');
    await expect.poll(focused).toBe(i + 1);
  }
  throw new Error(`token not reached: ${text}`);
}

test('mapping works from the keyboard alone', async ({ page }) => {
  await ready(page);
  await startFromSample(page, 'northline-sep26.pdf');
  for (const h of HEADER) {
    await focusToken(page, h.text);
    await page.keyboard.press('Enter');
    const nameBox = page.getByRole('combobox', { name: 'Name' });
    await expect(nameBox).toBeVisible();
    if ((await nameBox.inputValue()) !== h.name) {
      await nameBox.focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.type(h.name);
    }
    await page.getByRole('button', { name: 'Done' }).focus();
    await page.keyboard.press('Enter');
  }
  await page.getByRole('button', { name: 'Save template' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main').getByText('Saved as version 1')).toBeVisible();
  const { json } = await savedTemplate(page);
  const out = await extractWithSaved('northline-sep26.pdf', json);
  expect(out.fields).toEqual(goldenJson('northline-sep26').fields);
});

test('a mapped value reopens its field; fields remove with undo; dragging maps words', async ({
  page,
}) => {
  await ready(page);
  await startFromSample(page, 'northline-sep26.pdf');
  const mapped = page.locator('.field-row:not(.suggested)');
  const tok = (text: string) => page.locator(`.tok[data-text="${text}"]`).first();

  await tok('ST-48213').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(mapped).toHaveCount(1);
  // Clicking the same value again edits it instead of adding a second field.
  await tok('ST-48213').click();
  await expect(page.getByRole('group', { name: 'Field StatementNo' })).toBeVisible();
  await expect(mapped).toHaveCount(1);

  await page.getByRole('button', { name: 'Remove StatementNo' }).click();
  await expect(mapped).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(mapped).toHaveCount(1);

  // Drag a box around the date.
  const b = (await tok('30/09/2026').boundingBox())!;
  await page.mouse.move(b.x - 6, b.y - 6);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.move(b.x + b.width + 6, b.y + b.height + 6, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('combobox', { name: 'Name' })).toHaveValue('StatementDate');
  await expect(mapped).toHaveCount(2);
  await expectNoAxe(page);
});
