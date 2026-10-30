import { test, expect, ready, startFromSample, expectNoAxe, savedTemplate } from './helpers';

test('labels several examples, previews only the selected fragment and saves it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  await page.getByRole('button', { name: 'Start labelling', exact: true }).click();
  const examples = page.getByRole('region', { name: 'Label examples' });
  const ids = page.locator('.tok[data-text^="AVC"]');
  const first = await ids.first().getAttribute('data-text');
  await ids.first().click();
  await examples.getByRole('button', { name: 'Use this example', exact: true }).click();
  const output = page.getByRole('region', { name: 'Output' });
  await expect(output.getByText('12 rows', { exact: true })).toBeVisible();
  await expect(output.getByRole('columnheader')).toHaveCount(4);
  await expect(output.getByText(first!, { exact: true })).toBeVisible();
  await expect(output.getByText(/^Telephone/)).toHaveCount(0);
  await ids.nth(1).click();
  await examples.getByRole('button', { name: 'Use this example', exact: true }).click();
  await expect(examples.getByRole('button', { name: /^Remove example:/ })).toHaveCount(2);
  await expectNoAxe(page);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByRole('main').getByText('Saved as version 1')).toBeVisible();
  const saved = JSON.parse((await savedTemplate(page)).json);
  expect(
    saved.tables[0].groups
      .find((g: { name: string }) => g.name === 'Name')
      .examples.filter((e: { text: string }) => e.text),
  ).toHaveLength(2);
  await page.reload();
  await expect(output.getByText(first!, { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await output.getByRole('button', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
});

test('labels and controls stay inside the screen at laptop, tablet and phone widths', async ({
  page,
}) => {
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  await page.getByRole('button', { name: 'Start labelling', exact: true }).click();
  await page.getByLabel('CSV column name').fill('Service location and department name');
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('CSV column name')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    const clipped = await page
      .locator('.example-panel .btn, .example-panel .caption, .folder-name-text')
      .evaluateAll((els) =>
        els
          .filter((el) => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2)
          .map((el) => el.textContent),
      );
    expect(clipped).toEqual([]);
  }
  await expectNoAxe(page);
});

test('enlarged display keeps the PDF below the example card', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await ready(page);
  await startFromSample(page, 'summit-voice-jan26.pdf');
  await page.getByRole('button', { name: 'Start labelling', exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  const rail = await page.locator('.mapper-rail').boundingBox();
  const pdf = await page.locator('.mapper-page').boundingBox();
  expect(pdf!.y).toBeGreaterThanOrEqual(rail!.y + rail!.height);
  expect(pdf!.width).toBeGreaterThan(500);
});
