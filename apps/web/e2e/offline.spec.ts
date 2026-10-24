import { test, expect, ready, templateFiles, pdfFile, existsWs, resetApp } from './helpers';

test('the app works offline after the first load', async ({ page, context }) => {
  await resetApp(page);
  // Wait until the service worker controls the page and has cached the app.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r));
  });

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome to PDF Extractor' })).toBeVisible();

    // A full run, offline: first run, then process a PDF (pdf.js worker, wasm and fonts all cached).
    const file = 'northline-sep26.pdf';
    await ready(
      page,
      { ...templateFiles('northline-fuel-statement'), ...pdfFile(`Inbox/${file}`, file) },
      'process',
    );
    await page.getByRole('button', { name: 'Process 1 file' }).click();
    await expect(page.locator(`tr[data-file="${file}"] td`).nth(3)).toContainText('Extracted', {
      timeout: 60_000,
    });
    expect(await existsWs(page, 'Output/northline-fuel-statement/northline-sep26.json')).toBe(true);
  } finally {
    await context.setOffline(false);
  }
});
