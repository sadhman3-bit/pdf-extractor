import { test, expect, ready, readWs, seed, templateFiles, existsWs } from './helpers';

const ID = 'northline-fuel-statement';

async function lockPath(subject: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return `.locks/${createHash('sha256').update(subject).digest('hex').slice(0, 12)}.json`;
}

test('a draft survives a reload and offers to resume', async ({ page }) => {
  await ready(page, templateFiles(ID, [2]));
  await page.goto(`./?view=mapper&template=${ID}`);
  const name = page.getByRole('textbox', { name: 'Template name' });
  await expect(name).toHaveValue(/Northline/);
  await name.fill('Northline renamed');
  await expect
    .poll(() => existsWs(page, `Templates/${ID}/draft.json`), { timeout: 10_000 })
    .toBe(true);
  expect(await readWs(page, `Templates/${ID}/draft.json`)).toContain('Northline renamed');
  await page.reload();
  await expect(page.getByText(/Resume your draft from/)).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(name).toHaveValue('Northline renamed');
});

test('a fresh lock warns, a stale lock does not', async ({ page }) => {
  await ready(page, templateFiles(ID, [2]));
  const path = await lockPath(`template:${ID}`);
  const fresh = { user: 'Alex Other', since: new Date().toISOString(), what: `template:${ID}` };
  await seed(page, { [path]: Buffer.from(JSON.stringify(fresh)).toString('base64') });
  await page.goto(`./?view=mapper&template=${ID}`);
  await expect(page.getByText(/In use by Alex Other since/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open anyway' })).toBeVisible();

  const stale = { ...fresh, since: new Date(Date.now() - 31 * 60 * 1000).toISOString() };
  await seed(page, { [path]: Buffer.from(JSON.stringify(stale)).toString('base64') });
  await page.goto(`./?view=mapper&template=${ID}`);
  await expect(page.getByRole('textbox', { name: 'Template name' })).toBeVisible();
  await expect(page.getByText(/In use by/)).toHaveCount(0);
  // The stale lock was taken over by the current user.
  expect(JSON.parse(await readWs(page, path)).user).toBe('Sam Tester');
});
