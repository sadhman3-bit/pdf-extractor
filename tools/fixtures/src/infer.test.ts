import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildLayout,
  inferField,
  inferTable,
  suggestFields,
  suggestFingerprint,
  suggestLabelFixes,
  suggestTable,
  extractTable,
  extractField,
  applyEdits,
  processDocument,
  type DocLayout,
} from '@pdfx/engine';
import { readPdfNode } from '@pdfx/pdf/node';
import { PDF_DIR, loadTemplateSets } from './goldens';

async function layoutOf(file: string): Promise<DocLayout> {
  const r = await readPdfNode(new Uint8Array(readFileSync(join(PDF_DIR, file))));
  if (!r.ok) throw new Error(r.message);
  return buildLayout({ pages: r.pages });
}
const token = (l: DocLayout, text: string, page = 1) =>
  l.pages[page - 1]!.lines.flatMap((x) => x.tokens).find((t) => t.text === text)!;

describe('click-to-map inference', () => {
  it('infers anchor, direction, type and preset name from a click', async () => {
    const l = await layoutOf('northline-sep26.pdf');
    const gst = inferField(l, [token(l, '$38.56')])!;
    expect(gst.rule).toMatchObject({
      name: 'TotalGST',
      type: 'currency',
      direction: 'right',
      anchor: { labels: ['Total GST'] },
    });
    expect(extractField(l, gst.rule).value).toBe(38.56);
    const no = inferField(l, [token(l, 'ST-48213')])!;
    expect(no.rule).toMatchObject({ name: 'StatementNo', type: 'text', take: 'token' });
    const date = inferField(l, [token(l, '30/09/2026')])!;
    expect(date.rule).toMatchObject({
      name: 'StatementDate',
      type: 'date',
      dateFormats: ['DD/MM/YYYY'],
    });
  });

  it('falls back to the label directly above', async () => {
    const l = await layoutOf('northline-sep26.pdf');
    const r = inferField(l, [token(l, 'Brightwater')])!;
    expect(r.rule.direction).toBe('below');
    expect(r.rule.anchor.labels).toEqual(['Account holder']);
  });

  it('suggests label/value pairs and the ABN', async () => {
    const l = await layoutOf('northline-sep26.pdf');
    const names = suggestFields(l).map((s) => s.rule.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'StatementNo',
        'StatementDate',
        'AccountNo',
        'TotalGST',
        'TotalDue',
        'SupplierABN',
      ]),
    );
    const abn = suggestFields(l).find((s) => s.rule.name === 'SupplierABN')!;
    expect(extractField(l, abn.rule).value).toBe('15 803 047 975');
  });

  it('suggests a fingerprint', async () => {
    const l = await layoutOf('northline-sep26.pdf');
    expect(suggestFingerprint(l)).toMatchObject({
      mustContain: ['NORTHLINE FUEL', 'Fuel card statement'],
      abn: '15 803 047 975',
    });
  });

  it('builds a table from one click on the first row', async () => {
    const l = await layoutOf('northline-sep26.pdf');
    const t = inferTable(l, token(l, '03/09/2026'), 'Transactions')!;
    expect(t.rule.columns.map((c) => [c.name, c.type])).toEqual([
      ['Date', 'date'],
      ['Card', 'text'],
      ['Site', 'text'],
      ['Product', 'text'],
      ['Litres', 'number'],
      ['Amount', 'currency'],
    ]);
    expect(t.rule.end).toEqual({ labels: ['Subtotal'], match: 'starts-with' });
    expect(extractTable(l, t.rule).rows).toHaveLength(6);
    expect(suggestTable(l)?.rule.columns).toHaveLength(6);
  });

  it('builds the COA results table from a header click', async () => {
    const l = await layoutOf('harbourside-coa-a2391.pdf');
    const t = inferTable(l, token(l, 'Specification'), 'Results')!;
    expect(t.rule.columns.map((c) => c.name)).toEqual([
      'Test',
      'Method',
      'Specification',
      'Result',
      'Unit',
    ]);
    expect(t.rule.rowStart).toEqual({ column: 'Test', pattern: '\\S' });
    t.rule.end = { labels: ['Conclusion'], match: 'starts-with' };
    const rows = extractTable(l, t.rule).rows;
    expect(rows).toHaveLength(8);
    expect(rows[5]!.cells.Method!.value).toBe('Inductively coupled plasma (ICP-MS)');
  });
});

describe('diagnostics', () => {
  it('offers the June labels as fixes for the v1 template', async () => {
    const sets = loadTemplateSets();
    const v1 = sets
      .find((s) => s.id === 'northline-fuel-statement')!
      .versions.find((v) => v.version === 1)!;
    const jun = await layoutOf('northline-jun26.pdf');
    const fixes = suggestLabelFixes(jun, v1);
    expect(fixes.map((f) => [f.field, f.label])).toEqual([
      ['TotalGST', 'GST included'],
      ['TotalDue', 'Amount payable'],
    ]);
    const sep = await layoutOf('northline-sep26.pdf');
    expect(suggestLabelFixes(sep, v1)).toEqual([]);
  });
});

describe('review edits', () => {
  it('re-checks after a correction', async () => {
    const sets = loadTemplateSets();
    const r = await readPdfNode(new Uint8Array(readFileSync(join(PDF_DIR, 'northline-sep26.pdf'))));
    if (!r.ok) throw new Error();
    r.pages[0]!.tokens.find((t) => t.text === '43.32')!.text = '34.32';
    const ex = processDocument({ pages: r.pages }, sets);
    expect(ex.status).toBe('review');
    const t = sets
      .find((s) => s.id === 'northline-fuel-statement')!
      .versions.find((v) => v.version === 2)!;
    const fixed = applyEdits(ex, t, [
      { table: 'Transactions', row: 3, column: 'Amount', to: '43.32' },
    ]);
    expect(fixed.extraction.status).toBe('ok');
    expect(fixed.corrections).toEqual([
      { field: 'Amount', table: 'Transactions', row: 3, from: 34.32, to: 43.32 },
    ]);
    const bad = applyEdits(ex, t, [{ table: 'Transactions', row: 3, column: 'Amount', to: 'abc' }]);
    expect(bad.extraction.status).toBe('review');
  });
});
