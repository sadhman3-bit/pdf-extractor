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
  await expect(page.getByRole('cell', { name: 'v1' })).toBeVisible();
  await expectNoAxe(page);
});

async function focusToken(page: Page, text: string): Promise<void> {
  const viewer = page.getByRole('group', { name: /^PDF page \d/ });
  const spoken = viewer.locator('.sr-only');
  await viewer.focus();
  await page.keyboard.press('Home');
  await expect(spoken).toHaveText(/^Word: /);
  for (let i = 0; i < 400; i++) {
    const now = (await spoken.textContent()) ?? '';
    if (now === `Word: ${text}`) return;
    await page.keyboard.press('ArrowRight');
    // Each move announces the next word; wait for it before reading again.
    await expect(spoken).not.toHaveText(now);
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
