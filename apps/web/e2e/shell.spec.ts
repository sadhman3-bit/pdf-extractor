import {
  test,
  expect,
  resetApp,
  firstRun,
  listWs,
  existsWs,
  seed,
  templateFiles,
  expectNoAxe,
  ROOT,
} from './helpers';

test('app loads under the base path and shows the top bar', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('link', { name: 'PDF Extractor' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to PDF Extractor' })).toBeVisible();
  await expectNoAxe(page);
});

test('first run creates the folder tree and remembers the name', async ({ page }) => {
  await resetApp(page);
  await page.getByRole('button', { name: 'Get started' }).click();
  await expectNoAxe(page);
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(page.getByRole('heading', { name: 'These folders will be created' })).toBeVisible();
  await expect(page.getByText('Inbox/')).toBeVisible();
  await expectNoAxe(page);
  await page.getByRole('button', { name: 'Create folders' }).click();
  await expectNoAxe(page);
  await page.getByRole('textbox', { name: 'Your name' }).fill('Sam Tester');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Process inbox' })).toBeVisible();
  const root = await listWs(page, '');
  for (const d of [
    'Inbox',
    'Processed',
    'Exceptions',
    'Output',
    'Templates',
    'Audit',
    '.locks',
    'settings.json',
  ])
    expect(root).toContain(d);
  expect(await existsWs(page, 'Templates/_archived')).toBe(true);
  await page.getByRole('button', { name: 'Process inbox' }).click();
  await expect(page.getByRole('heading', { name: 'Process inbox' })).toBeVisible();
  // Reload: the folder and name are remembered.
  await page.reload();
  await expect(page.getByText('Connected')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Process inbox' })).toBeVisible();
});

test('a template saves and reloads; Templates screen passes axe', async ({ page }) => {
  await resetApp(page);
  await firstRun(page);
  await seed(page, templateFiles('northline-fuel-statement', [2]));
  await page.reload();
  await expect(page.getByRole('heading', { name: /Northline Fuel statement/ })).toBeVisible();
  await expect(page.locator('.tpl-card').getByText('v2', { exact: true })).toBeVisible();
  await expectNoAxe(page);
});

test('the production build has no test hooks', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(ROOT, 'apps', 'web', 'dist', 'assets');
  const js = readdirSync(dir).filter((f) => f.endsWith('.js'));
  expect(js.length).toBeGreaterThan(0);
  for (const f of js)
    expect(readFileSync(join(dir, f), 'utf8')).not.toContain('__PDFX_TEST_WORKSPACE__');
  const html = readFileSync(join(ROOT, 'apps', 'web', 'dist', 'index.html'), 'utf8');
  expect(html).toContain('Content-Security-Policy');
});
