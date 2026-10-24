import { test, expect, ready, templateFiles, pdfFile, expectNoAxe } from './helpers';

const ID = 'northline-fuel-statement';

test('axe reports nothing on any screen', async ({ page }) => {
  const files = {
    ...templateFiles(ID),
    ...pdfFile(`Templates/${ID}/samples/northline-sep26.pdf`, 'northline-sep26.pdf'),
    ...pdfFile('Inbox/ridgeway-invoice-88231.pdf', 'ridgeway-invoice-88231.pdf'),
  };
  await ready(page, files);

  const screens: [string, string][] = [
    ['./?view=templates', 'Templates'],
    [`./?view=mapper&template=${ID}`, 'Mapper'],
    [`./?view=test&template=${ID}`, 'Test on samples'],
    ['./?view=process', 'Process inbox'],
  ];
  for (const [url, heading] of screens) {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoAxe(page);
  }

  // Process, then the Review list and detail.
  await page.goto('./?view=process');
  await page.getByRole('button', { name: 'Process 1 file' }).click();
  await expect(page.getByRole('main').getByText(/^Processed just now/)).toBeVisible();
  await expectNoAxe(page);
  await page.goto('./?view=review');
  await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();
  await expectNoAxe(page);
  await page.getByRole('button', { name: 'Open' }).first().click();
  await expect(page.getByRole('button', { name: 'Create template from this file' })).toBeVisible();
  await expectNoAxe(page);

  // Settings dialog.
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoAxe(page);
});
