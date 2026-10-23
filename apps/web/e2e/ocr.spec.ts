import { test, expect, ready, readWs, templateFiles, pdfFile, golden, ORIGIN } from './helpers';

const FILE = 'northline-sep26-card2-scan.pdf';

interface ReviewCell {
  value: unknown;
  raw: string;
  conf: number;
}
interface Reason {
  code: string;
  table?: string;
  row?: number;
  column?: string;
}

test('the scanned Northline statement is read with self-hosted OCR', async ({ page }) => {
  test.setTimeout(300_000);
  const ocrRequests: string[] = [];
  page.on('request', (r) => {
    if (/tesseract|tessdata|traineddata/i.test(r.url())) ocrRequests.push(r.url());
  });
  await ready(
    page,
    { ...templateFiles('northline-fuel-statement'), ...pdfFile(`Inbox/${FILE}`, FILE) },
    'process',
  );
  await page.getByRole('button', { name: 'Process 1 file' }).click();
  await expect(page.getByRole('main').getByText(/^Processed just now/)).toBeVisible({
    timeout: 280_000,
  });
  await expect(page.locator(`tr[data-file="${FILE}"]`)).toContainText('Scanned · read with OCR');

  const review = JSON.parse(
    await readWs(page, `Exceptions/${FILE.replace(/\.pdf$/, '')}.review.json`),
  );
  const ex = review.extraction as {
    status: string;
    ocr: boolean;
    reasons: Reason[];
    fields: Record<string, { value: unknown }>;
    tables: { Transactions: { rows: { cells: Record<string, ReviewCell> }[] } };
  };
  expect(ex.ocr).toBe(true);
  expect(ex.status).toBe('review');

  // Every header field.
  const fields = Object.fromEntries(Object.entries(ex.fields).map(([k, v]) => [k, v.value]));
  expect(fields).toEqual({
    StatementNo: 'ST-48214',
    StatementDate: '2026-09-30',
    TotalGST: 38.56,
    TotalDue: 424.18,
  });

  // At least 5 of 6 rows right. The card number is masked ("•• 0034"); OCR
  // can't read the bullets, so only its digits are compared.
  const truth = JSON.parse(golden('northline-sep26.json')).tables.Transactions as Record<
    string,
    unknown
  >[];
  const rows = ex.tables.Transactions.rows;
  expect(rows).toHaveLength(6);
  const right = rows.filter((r, i) => {
    const want = truth[i]!;
    return (
      ['Date', 'Site', 'Product', 'Litres', 'Amount'].every((c) => r.cells[c]?.value === want[c]) &&
      String(r.cells.Card?.value ?? '').endsWith('0034')
    );
  });
  const seen = rows.map((r) =>
    Object.values(r.cells)
      .map((c) => `${c.raw}@${c.conf}`)
      .join(' | '),
  );
  expect(right.length, seen.join('\n')).toBeGreaterThanOrEqual(5);

  // Row 4's smudged amount is read as 34.32 and flagged as low confidence.
  expect(rows[3]!.cells.Amount!.raw, seen.join('\n')).toBe('34.32');
  expect(ex.reasons).toContainEqual(
    expect.objectContaining({
      code: 'low_confidence',
      table: 'Transactions',
      row: 3,
      column: 'Amount',
    }),
  );

  // OCR files came from the app's own origin.
  expect(ocrRequests.length).toBeGreaterThan(0);
  for (const u of ocrRequests) expect(u.startsWith(ORIGIN), u).toBe(true);
});
