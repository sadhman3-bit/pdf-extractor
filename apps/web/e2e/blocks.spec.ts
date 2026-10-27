import { test, expect, ready, resetApp, fixturePdf, startFromSample, expectNoAxe } from './helpers';

test('opens a PDF directly before folder setup', async ({ page }) => {
  await resetApp(page);
  await page.getByLabel('Open a PDF').setInputFiles({
    name: 'summit-voice-jan26.pdf',
    mimeType: 'application/pdf',
    buffer: fixturePdf('summit-voice-jan26.pdf'),
  });
  await expect(page.locator('.tok[data-text="Telephone"]').first()).toBeVisible();
  await expect(page.getByText(/Your layouts are saved in this browser/)).toBeVisible();
  await expectNoAxe(page);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByText(/Your layouts are saved in this browser/)).toBeVisible();
});

test('maps whole headings and phone numbers into four output columns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  const token = (s: string) => page.locator(`.tok[data-text="${s}"]`).first();
  await token('Summary').click();
  await page.getByRole('button', { name: 'Map the table under this header row' }).click();
  await token('Telephone').click();
  await page.getByRole('button', { name: 'Use this block as Name and extract its number' }).click();
  await token('Total').click();
  await page.getByRole('button', { name: /^Make lines starting “Total for” the rows/ }).click();
  const output = page.getByRole('region', { name: 'Output' });
  await expect(output.getByText('12 rows', { exact: true })).toBeVisible();
  await expect(output.getByText('Values read', { exact: true })).toBeVisible();
  await expect(output.getByRole('columnheader')).toHaveCount(4);
  await expect(output.getByRole('columnheader', { name: 'Name, Text', exact: true })).toBeVisible();
  await expect(
    output.getByRole('columnheader', { name: 'PhoneNumber, Text', exact: true }),
  ).toBeVisible();
  await expect(output.getByText(/^Telephone 02 5550/).first()).toBeVisible();
  await expect(output.getByText('02 5550 0160', { exact: true })).toBeVisible();
  await output.getByText('02 5550 0160', { exact: true }).click();
  await expect(page.locator('.tok.tok-selected[data-text="0160"]')).toBeVisible();
  const name = output.getByRole('textbox', { name: 'Rename Name', exact: true });
  await name.fill('ServiceName');
  await name.press('Tab');
  await expect(output.getByRole('columnheader', { name: 'ServiceName, Text' })).toBeVisible();
  await expectNoAxe(page);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await page.reload();
  await expect(output.getByRole('columnheader', { name: 'ServiceName, Text' })).toBeVisible();
});

test('light is default even on a dark system; explicit dark persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Appearance').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Appearance').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
