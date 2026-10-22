import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const ORIGIN = 'http://localhost:4173';

/** Every test fails if the page requests anything outside its own origin. */
export const test = base.extend<{ offOrigin: string[] }>({
  offOrigin: [
    async ({ page }, use) => {
      const bad: string[] = [];
      page.on('request', (r) => {
        const u = r.url();
        if (u.startsWith('data:') || u.startsWith('blob:')) return;
        if (!u.startsWith(ORIGIN)) bad.push(u);
      });
      await use(bad);
      expect(bad, 'requests outside the origin').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export const fixturePdf = (name: string) => readFileSync(join(ROOT, 'fixtures', 'pdf', name));
export const golden = (name: string) =>
  readFileSync(join(ROOT, 'fixtures', 'expected', name), 'utf8');

export function templateFiles(id: string, versions?: number[]): Record<string, string> {
  const dir = join(ROOT, 'fixtures', 'templates', id);
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    const v = Number(/^v(\d+)\.json$/.exec(f)?.[1]);
    if (!v || (versions && !versions.includes(v))) continue;
    out[`Templates/${id}/${f}`] = readFileSync(join(dir, f)).toString('base64');
  }
  return out;
}

export function pdfFile(path: string, fixture: string): Record<string, string> {
  return { [path]: fixturePdf(fixture).toString('base64') };
}

export async function resetApp(page: Page): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __PDFX_TEST_WORKSPACE__?: { reset?: unknown } })
        .__PDFX_TEST_WORKSPACE__?.reset,
  );
  await page.evaluate(() =>
    (
      window as unknown as { __PDFX_TEST_WORKSPACE__: { reset(): Promise<void> } }
    ).__PDFX_TEST_WORKSPACE__.reset(),
  );
  await page.goto('./');
}

export async function seed(page: Page, files: Record<string, string>): Promise<void> {
  await page.evaluate(
    (f) =>
      (
        window as unknown as {
          __PDFX_TEST_WORKSPACE__: { seed(x: Record<string, string>): Promise<void> };
        }
      ).__PDFX_TEST_WORKSPACE__.seed(f),
    files,
  );
}

export async function readWs(page: Page, path: string): Promise<string> {
  return page.evaluate(
    (p) =>
      (
        window as unknown as { __PDFX_TEST_WORKSPACE__: { readText(x: string): Promise<string> } }
      ).__PDFX_TEST_WORKSPACE__.readText(p),
    path,
  );
}

export async function listWs(page: Page, dir: string): Promise<string[]> {
  return page.evaluate(
    (p) =>
      (
        window as unknown as { __PDFX_TEST_WORKSPACE__: { list(x: string): Promise<string[]> } }
      ).__PDFX_TEST_WORKSPACE__.list(p),
    dir,
  );
}

export async function existsWs(page: Page, path: string): Promise<boolean> {
  return page.evaluate(
    (p) =>
      (
        window as unknown as { __PDFX_TEST_WORKSPACE__: { exists(x: string): Promise<boolean> } }
      ).__PDFX_TEST_WORKSPACE__.exists(p),
    path,
  );
}

/** Runs the first-run flow and lands on the Templates screen. */
export async function firstRun(page: Page, user = 'Sam Tester'): Promise<void> {
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await page.getByRole('button', { name: 'Create folders' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill(user);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create your first template' }).click();
  await expect(page.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible();
}

/** Fresh app with a workspace and optional seeded files, ready on the given view. */
export async function ready(
  page: Page,
  files: Record<string, string> = {},
  view = 'templates',
): Promise<void> {
  await resetApp(page);
  await firstRun(page);
  if (Object.keys(files).length) await seed(page, files);
  await page.goto(`./?view=${view}`);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

export async function expectNoAxe(page: Page): Promise<void> {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    r.violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    ),
  ).toEqual([]);
}

/** CSV text without the volatile audit columns, for comparing against goldens. */
export function stableCsv(csv: string): string[][] {
  const rows = csv
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .filter(Boolean)
    .map((l) => l.split(','));
  const head = rows[0]!;
  const keep = head
    .map((h, i) =>
      ['_Template', '_TemplateVersion', '_ExtractedAt', '_SourceSha256'].includes(h) ? -1 : i,
    )
    .filter((i) => i >= 0);
  return rows.map((r) => keep.map((i) => r[i]!));
}

/** Opens the Mapper with a new sample and waits for the token overlay. */
export async function startFromSample(page: Page, file: string): Promise<void> {
  await page.goto('./?view=mapper');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: file, mimeType: 'application/pdf', buffer: fixturePdf(file) });
  await expect(page.getByRole('textbox', { name: 'Template name' })).toBeVisible();
  await expect(page).toHaveURL(/template=/);
  await expect(page.locator('.tok').first()).toBeAttached();
}

export async function savedTemplate(page: Page): Promise<{ id: string; json: string }> {
  const ids = (await listWs(page, 'Templates')).filter((d) => !d.startsWith('_'));
  expect(ids).toHaveLength(1);
  const id = ids[0]!;
  const files = (await listWs(page, `Templates/${id}`)).filter((f) => /^v\d+\.json$/.test(f));
  files.sort();
  return { id, json: await readWs(page, `Templates/${id}/${files[files.length - 1]}`) };
}
