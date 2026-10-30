import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPdfNode } from '@pdfx/pdf/node';
import { buildLayout, extractTable, learnExample, setTableEnd } from '@pdfx/engine';
import { businessRows } from './business';

async function layout(file: string) {
  const pdf = await readPdfNode(
    new Uint8Array(readFileSync(new URL(`../../../fixtures/pdf/${file}`, import.meta.url))),
  );
  if (!pdf.ok) throw new Error(pdf.message);
  return buildLayout(pdf);
}

describe('digital business invoices', () => {
  it('learns verified service headings, repairs wrapped names and reuses the ending on another page', async () => {
    const first = await layout('business-invoice-digital.pdf');
    const lines = first.pages.flatMap((p) => p.lines);
    const west = lines.find((l) => l.text.endsWith('West Depot'))!;
    let rule = learnExample(first, null, west.tokens.slice(-2), 'Name')!;
    expect(extractTable(first, rule).rows).toHaveLength(16);
    expect(extractTable(first, rule).rows.map((r) => r.groups.Name ?? '')).toEqual(
      businessRows.map((r) => r.Name),
    );
    const start = lines.find((l) => l.text.endsWith('Shared Customer Support'))!;
    const next = lines[lines.indexOf(start) + 1]!;
    rule = learnExample(first, rule, [...start.tokens.slice(-3), ...next.tokens], 'Name')!;
    expect(rule).not.toBeNull();
    rule = setTableEnd(
      rule,
      lines.find((l) => l.text === 'End of service summary')!,
    );
    for (const [file, endPage] of [
      ['business-invoice-digital.pdf', 5],
      ['business-invoice-shifted-ending.pdf', 6],
    ] as const) {
      const result = extractTable(await layout(file), rule);
      expect(result.end?.page).toBe(endPage);
      expect(result.issues ?? []).toEqual([]);
      expect(
        result.rows.map((r) => ({
          Name: r.groups.Name ?? '',
          PhoneNumber: r.groups.PhoneNumber,
          ExclGST: r.cells.ExclGST!.value,
          InclGST: r.cells.InclGST!.value,
        })),
      ).toEqual(businessRows);
    }
  });
});
