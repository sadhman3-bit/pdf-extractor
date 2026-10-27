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
  addColumnAt,
  addBreak,
  partColumnFor,
  rowsLike,
  tableFromBox,
  setTableStart,
  setTableEnd,
  moveOuter,
  moveBreak,
  removeBreak,
  tableFrame,
  furnitureLines,
  phrases,
  groupFor,
  skipPatternFor,
  type DocLayout,
  type TableRule,
} from '@pdfx/engine';
import { summitIncl, summitServices } from './docs';
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

  it('keeps an all-digit invoice number as text', async () => {
    const l = await layoutOf('ridgeway-invoice-88231.pdf');
    const no = inferField(l, [token(l, '88231')])!;
    expect(no.rule).toMatchObject({ name: 'InvoiceNumber', type: 'text' });
    expect(extractField(l, no.rule).value).toBe('88231');
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

  it('finds the COA header above a first row that is all text', async () => {
    const l = await layoutOf('harbourside-coa-a2391.pdf');
    const t = inferTable(l, token(l, 'Appearance'), 'Results')!;
    expect(t.rule.columns.map((c) => c.name)).toEqual([
      'Test',
      'Method',
      'Specification',
      'Result',
      'Unit',
    ]);
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

describe('mapping a grouped service summary', () => {
  it('builds rows with headings, skipped totals, extra columns and an end', async () => {
    const l = await layoutOf('summit-voice-jan26.pdf');
    expect(l.pages.length).toBeGreaterThanOrEqual(3);
    const line = (start: string) =>
      l.pages.flatMap((p) => p.lines).find((x) => x.text.startsWith(start))!;
    let rule = inferTable(l, token(l, 'Summary'))!.rule;
    // A per-service total repeats, so it is skipped rather than ending the table.
    expect(rule.end).toBeUndefined();
    expect(rule.skip).toContain(skipPatternFor(line('Total for')));
    const telephone = groupFor(line('Telephone'), []);
    const section = groupFor(line('Services and'), ['Telephone']);
    const company = groupFor(line('BRIGHTWATER LOGISTICS'), ['Telephone', 'Section']);
    expect([telephone.name, section.name, company.name]).toEqual([
      'Telephone',
      'Section',
      'Company',
    ]);
    rule = { ...rule, groups: [telephone, section, company] };
    let t = extractTable(l, rule);
    const period = line('Rental').tokens.find((x) => x.text === '25')!;
    rule = addColumnAt(l, rule, t.bounds, period)!.rule;
    t = extractTable(l, rule);
    rule = addColumnAt(l, rule, t.bounds, token(l, 'Main'))!.rule;
    rule = { ...rule, end: { labels: [line('Call details').text], match: 'starts-with' } };
    t = extractTable(l, rule);
    const items = summitServices().flatMap((s) =>
      s.sections.flatMap((sec) => sec.items.map((it) => ({ s, sec, it }))),
    );
    expect(items.some(({ it }) => it.cr)).toBe(true);
    expect(items.some(({ it }) => it.wrap)).toBe(true);
    expect(t.rows).toHaveLength(items.length);
    t.rows.forEach((r, i) => {
      const { s, sec, it } = items[i]!;
      expect(r.cells.Item!.raw).toBe(it.code);
      expect(r.cells.ServiceSummary!.value).toBe(it.qty);
      // A wrapped description line joins the description; it is not a section heading.
      expect(r.cells.Column6!.raw).toBe(
        [it.description, it.wrap, it.label].filter(Boolean).join(' '),
      );
      expect(r.cells.Column5!.raw).toBe(it.period);
      // Credits read as negative, whether printed "-90.91" or "90.91CR".
      expect(r.cells.ExclGST!.value).toBe(it.excl);
      expect(r.cells.InclGST!.value).toBe(summitIncl(it));
      expect(r.groups).toEqual({
        Telephone: `${s.number} ${s.avc}`,
        Section: sec.title,
        Company: s.company,
      });
    });
  });

  it('adds, moves and removes column breaks from the ruler', async () => {
    const l = await layoutOf('summit-voice-jan26.pdf');
    const line = (start: string) =>
      l.pages.flatMap((p) => p.lines).find((x) => x.text.startsWith(start))!;
    const first = inferTable(l, token(l, 'Summary'))!.rule;
    const groups = [
      groupFor(line('Telephone'), []),
      groupFor(line('Services and'), ['Telephone']),
      groupFor(line('BRIGHTWATER LOGISTICS'), ['Telephone', 'Section']),
    ];
    const end = { labels: [line('Call details').text], match: 'starts-with' as const };
    const start = { ...first, groups, end };
    const names = (r: TableRule) => tableFrame(l, r)!.bounds.map((b) => b.name);
    const period = line('Rental').tokens.find((x) => x.text === '25')!;
    // A break just left of the period: the period becomes a column of its own.
    const added = addBreak(l, start, period.x0 - 1)!;
    expect(added.column.name).toBe('Column5');
    expect(names(added.rule)).toEqual(['Item', 'ServiceSummary', 'Column5', 'ExclGST', 'InclGST']);
    // The next break, halfway to the Excl GST heading, cuts the period: drag it past.
    const periodEnd = Math.max(
      ...l.pages
        .flatMap((p) => p.lines)
        .flatMap((x) => phrases(x))
        .filter((p) => / to \d/.test(p.text))
        .map((p) => p.x1),
    );
    const moved = moveBreak(l, added.rule, 2, periodEnd + 2, true)!;
    const items = summitServices().flatMap((s) => s.sections.flatMap((sec) => sec.items));
    const rows = extractTable(l, moved).rows;
    expect(rows).toHaveLength(items.length);
    rows.forEach((r, i) => {
      expect(r.cells.Column5!.raw).toBe(items[i]!.period);
      expect(r.cells.ExclGST!.value).toBe(items[i]!.excl);
    });
    // No break where a column would be too narrow.
    expect(addBreak(l, moved, period.x0)).toBeNull();
    // Moving a break never crosses its neighbours.
    const f = tableFrame(l, moved)!;
    const far = moveBreak(l, moved, 1, 99999)!;
    expect(tableFrame(l, far)!.bounds[2]!.x0).toBe(f.bounds[2]!.x1 - 4);
    // Removing it joins the two columns again; the named one keeps its name.
    const removed = removeBreak(l, added.rule, 1)!;
    expect(names(removed)).toEqual(names(start));
    expect(extractTable(l, removed).rows.map((r) => r.cells.ServiceSummary!.raw)).toEqual(
      extractTable(l, start).rows.map((r) => r.cells.ServiceSummary!.raw),
    );
  });

  it('marks how each line was read, and puts second lines in a column of their own', async () => {
    const l = await layoutOf('summit-voice-jan26.pdf');
    const line = (start: string) =>
      l.pages.flatMap((p) => p.lines).find((x) => x.text.startsWith(start))!;
    const first = inferTable(l, token(l, 'Summary'))!.rule;
    const groups = [
      groupFor(line('Telephone'), []),
      groupFor(line('Services and'), ['Telephone']),
      groupFor(line('BRIGHTWATER LOGISTICS'), ['Telephone', 'Section']),
    ];
    const end = { labels: [line('Call details').text], match: 'starts-with' as const };
    let rule: TableRule = { ...first, groups, end };
    rule = addBreak(l, rule, line('Rental').tokens.find((x) => x.text === '25')!.x0 - 1)!.rule;
    const t = extractTable(l, rule);
    const roleOf = (x: { page: number; y0: number }) =>
      t.stats!.lines!.find((r) => r.page === x.page && r.y0 === x.y0)?.role;
    expect(roleOf(line('Item'))).toBe('header');
    expect(roleOf(line('Telephone'))).toBe('heading');
    expect(roleOf(line('Total for'))).toBe('skip');
    expect(roleOf(line('Rental'))).toBe('part');
    expect(roleOf(line('Call details'))).toBe('end');
    expect(t.stats!.lines!.filter((r) => r.role === 'row')).toHaveLength(t.rows.length);
    // "Rental" lines get a column; a wrapped description (further left) stays put.
    const part = partColumnFor(l, rule, line('Rental'))!;
    expect(part.column).toMatchObject({ name: 'Detail', partOf: 'ServiceSummary' });
    const rows = extractTable(l, part.rule).rows;
    const items = summitServices().flatMap((s) => s.sections.flatMap((sec) => sec.items));
    rows.forEach((r, i) => {
      const it = items[i]!;
      expect(r.cells.Detail!.raw).toBe(it.label ?? '');
      expect(r.cells.ServiceSummary!.raw).toBe(
        [it.qty, it.description, it.wrap].filter((x) => x !== undefined && x !== '').join(' '),
      );
    });
    // Only one such column per column.
    expect(partColumnFor(l, part.rule, line('Rental'))).toBeNull();
  });

  it('makes one row per service from its "Total for" line', async () => {
    const l = await layoutOf('summit-voice-jan26.pdf');
    const line = (start: string) =>
      l.pages.flatMap((p) => p.lines).find((x) => x.text.startsWith(start))!;
    const first = inferTable(l, token(l, 'Summary'))!.rule;
    const end = { labels: [line('Call details').text], match: 'starts-with' as const };
    const rule = { ...first, end, groups: [groupFor(line('Telephone'), [])] };
    const totals = rowsLike(l, rule, line('Total for'))!;
    const formerlyEnded = rowsLike(
      l,
      { ...rule, end: { labels: ['Total for'], match: 'starts-with' }, requireEnd: true },
      line('Total for'),
    )!;
    expect(formerlyEnded.end).toBeUndefined();
    expect(formerlyEnded.requireEnd).toBe(false);
    expect(extractTable(l, formerlyEnded).rows).toHaveLength(summitServices().length);
    expect(totals.rowStart).toEqual({ column: 'ServiceSummary', pattern: '^Total for' });
    const rows = extractTable(l, totals).rows;
    expect(rows.flatMap((r) => Object.values(r.cells).filter((c) => c.error))).toEqual([]);
    const services = summitServices();
    expect(rows).toHaveLength(services.length);
    rows.forEach((r, i) => {
      const s = services[i]!;
      const items = s.sections.flatMap((sec) => sec.items);
      expect(r.groups.Telephone).toBe(`${s.number} ${s.avc}`);
      expect(r.cells.ServiceSummary!.raw).toContain(`Total for ${s.number.slice(0, 7)}`);
      expect(r.cells.ExclGST!.value).toBeCloseTo(
        items.reduce((a, it) => a + it.excl, 0),
        2,
      );
      expect(r.cells.InclGST!.value).toBeCloseTo(
        items.reduce((a, it) => a + summitIncl(it), 0),
        2,
      );
    });
  });

  it('maps a table from a box drawn round it, and moves its start and end', async () => {
    const l = await layoutOf('summit-voice-jan26.pdf');
    const p1 = l.pages[0]!;
    const head = p1.lines.find((x) => x.text.startsWith('Item'))!;
    const last = p1.lines.filter((x) => /^SVC/.test(x.text)).pop()!;
    // A box from the header to the page's last rows: the table runs on over the pages.
    const all = tableFromBox(l, 1, [40, head.y0 - 2, 560, last.y1 + 30])!;
    expect(all.header.labels).toEqual(phrases(head).map((p) => p.text));
    expect(all.end).toBeUndefined();
    expect(extractTable(l, all).rows.length).toBeGreaterThan(20);
    // A box that stops above the first "Total for" line ends the table there.
    const total = p1.lines.find((x) => x.text.startsWith('Total for'))!;
    const short = tableFromBox(l, 1, [40, head.y0 - 2, 560, total.y0 - 1])!;
    expect(short.end).toEqual({ labels: ['Total for'], match: 'starts-with' });
    expect(extractTable(l, short).rows).toHaveLength(1);
    // Dragging the end down to the page foot lets it run on; the start can move too.
    expect(setTableEnd(short, null).end).toBeUndefined();
    const tel = p1.lines.find((x) => x.text.startsWith('Telephone'))!;
    const moved = setTableStart(l, all, tel)!;
    expect(moved.header.labels[0]).toMatch(/^Telephone/);
    // The sides of the box are the table's outer edges.
    const narrow = moveOuter(l, all, 'right', 530)!;
    expect(tableFrame(l, narrow)!.bounds.at(-1)!.x1).toBe(530);
  });

  it('ignores page headers and footers, and suggests no per-service totals', async () => {
    const l = await layoutOf('summit-voice-jan26.pdf');
    const furniture = [...furnitureLines(l)].map((x) => x.text);
    expect(furniture.filter((x) => x.startsWith('Summit Voice Pty Ltd'))).toHaveLength(
      l.pages.length,
    );
    expect(furniture.some((x) => x.startsWith('Telephone'))).toBe(false);
    const names = suggestFields(l).map((f) => f.rule.name);
    expect(names.filter((n) => n.startsWith('TotalFor'))).toEqual([]);
  });
});

describe('table suggestion on a grouped bill', () => {
  it('suggests the header that repeats on every page, not a later one-off table', async () => {
    const l = await layoutOf('summit-voice-jan26.pdf');
    const t = suggestTable(l)!;
    expect(t.rule.header.labels).toEqual(['Item', 'Service Summary', 'Excl GST $', 'Incl GST $']);
  });
});
