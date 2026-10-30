import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPdfNode } from '@pdfx/pdf/node';
import {
  buildLayout,
  extractTable,
  findBlocks,
  rowKindOf,
  setRowKind,
  suggestTable,
} from '@pdfx/engine';
import { businessRows } from './business';

async function layout(file: string) {
  const pdf = await readPdfNode(
    new Uint8Array(readFileSync(new URL(`../../../fixtures/pdf/${file}`, import.meta.url))),
  );
  if (!pdf.ok) throw new Error(pdf.message);
  return buildLayout(pdf);
}

describe('what one row is', () => {
  it('finds each block from heading to total on its own', async () => {
    const l = await layout('business-invoice-digital.pdf');
    const rule = findBlocks(l, suggestTable(l)!.rule)!;
    expect(rowKindOf(rule)).toBe('block');
    const result = extractTable(l, rule);
    expect(
      result.rows.map((r) => ({
        Name: r.groups.Name ?? '',
        PhoneNumber: r.groups.PhoneNumber,
        ExclGST: r.cells.ExclGST!.value,
        InclGST: r.cells.InclGST!.value,
      })),
    ).toEqual(businessRows);
    // Each row's box runs from its heading down to its total.
    const first = result.rows[0]!;
    const lines = l.pages.flatMap((p) => p.lines);
    const heading = lines.find((x) => x.text.endsWith('West Depot'))!;
    expect(first.span?.[0]?.bbox[1]).toBeLessThanOrEqual(heading.y0);
    expect(first.span?.[0]?.bbox[3]).toBeGreaterThanOrEqual(first.bbox[3]);
  });

  it('switches between blocks, item lines and every line, and back', async () => {
    const l = await layout('summit-voice-jan26.pdf');
    const block = findBlocks(l, suggestTable(l)!.rule)!;
    expect(block).not.toBeNull();
    const totals = extractTable(l, block).rows.length;
    const items = setRowKind(l, block, 'items')!;
    expect(rowKindOf(items)).toBe('items');
    const itemRows = extractTable(l, items).rows;
    expect(itemRows.length).toBeGreaterThan(totals);
    // Every item keeps its block's heading values, and no total becomes an item.
    expect(itemRows.every((r) => r.groups.PhoneNumber)).toBe(true);
    expect(itemRows.some((r) => /^Total/.test(r.cells.ServiceSummary?.raw ?? ''))).toBe(false);
    const lines = setRowKind(l, items, 'lines')!;
    expect(rowKindOf(lines)).toBe('lines');
    expect(extractTable(l, lines).rows.length).toBeGreaterThanOrEqual(itemRows.length);
    const back = setRowKind(l, lines, 'block')!;
    expect(rowKindOf(back)).toBe('block');
    expect(extractTable(l, back).rows.length).toBe(totals);
  });
});
