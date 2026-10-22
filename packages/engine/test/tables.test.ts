import { describe, expect, it } from 'vitest';
import { buildLayout, extractTable, columnBounds, type TableRule, type Token } from '../src';
import { tok, words, doc } from './helpers';

const rule = (extra: Partial<TableRule> = {}): TableRule => ({
  id: 't',
  name: 'T',
  header: { labels: ['Date', 'Description', 'Amount'], minMatch: 2 },
  columns: [
    { name: 'Date', header: 'Date', type: 'date', required: true },
    { name: 'Description', header: 'Description' },
    { name: 'Amount', header: 'Amount', type: 'currency', required: true },
  ],
  rowStart: { column: 'Date', pattern: '^\\d{2}/\\d{2}/\\d{4}$' },
  ...extra,
});

const header = (y: number): Token[] => [
  tok('Date', 50, y),
  ...words('Description', 150, y),
  tok('Amount', 400, y),
];
const row = (y: number, date: string, desc: string, amt: string): Token[] => [
  tok(date, 50, y),
  ...words(desc, 150, y),
  tok(amt, 400, y),
];

describe('tables', () => {
  it('finds the header and splits columns halfway between header centres', () => {
    const l = buildLayout(doc([...header(100), ...row(120, '01/09/2026', 'Fuel', '10.00')]));
    const t = extractTable(l, rule());
    expect(t.found).toBe(true);
    expect(t.bounds.map((b) => b.name)).toEqual(['Date', 'Description', 'Amount']);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]!.cells.Amount!.value).toBe(10);
  });

  it('explicit x0/x1 on columns override the defaults', () => {
    const r = rule();
    r.columns[1] = { ...r.columns[1]!, x0: 120, x1: 380 };
    const b = columnBounds(
      r,
      new Map([
        ['Date', { x0: 50, x1: 70 }],
        ['Amount', { x0: 400, x1: 430 }],
      ]),
    );
    expect(b.find((x) => x.name === 'Description')).toMatchObject({ x0: 120, x1: 380 });
  });

  it('joins wrapped lines to the row above, or ignores them', () => {
    const tokens = [
      ...header(100),
      ...row(120, '01/09/2026', 'Mobile call –', '1.00'),
      ...words('national roaming', 150, 134),
      ...row(150, '02/09/2026', 'Video call', '2.00'),
    ];
    const l = buildLayout(doc(tokens));
    const join = extractTable(l, rule());
    expect(join.rows.map((r) => r.cells.Description!.value)).toEqual([
      'Mobile call – national roaming',
      'Video call',
    ]);
    const ignore = extractTable(l, rule({ wrappedLines: 'ignore' }));
    expect(ignore.rows.map((r) => r.cells.Description!.value)).toEqual([
      'Mobile call –',
      'Video call',
    ]);
  });

  it('skips lines, stops at the end marker and sets group values', () => {
    const tokens = [
      ...header(100),
      ...words('Service 0491 570 156', 50, 115),
      ...row(130, '01/09/2026', 'A', '1.00'),
      ...words('Subtotal for this page', 50, 145),
      tok('1.00', 400, 145),
      ...words('Service 0491 570 157', 50, 160),
      ...row(175, '02/09/2026', 'B', '2.00'),
      ...words('Total calls', 50, 190),
      tok('3.00', 400, 190),
      ...row(205, '03/09/2026', 'after end', '9.00'),
    ];
    const t = extractTable(
      buildLayout(doc(tokens)),
      rule({
        skip: ['^Subtotal for this page'],
        end: { labels: ['Total calls'], match: 'starts-with' },
        groups: [{ name: 'Service', pattern: '^Service (\\d{4} \\d{3} \\d{3})$', capture: 1 }],
      }),
    );
    expect(t.rows.map((r) => [r.cells.Description!.value, r.groups.Service])).toEqual([
      ['A', '0491 570 156'],
      ['B', '0491 570 157'],
    ]);
    expect(t.end?.page).toBe(1);
  });

  it('continues on the next page after a repeated header', () => {
    const p1 = [...header(100), ...row(120, '01/09/2026', 'A', '1.00')];
    const p2 = [
      ...words('Running header', 50, 20),
      ...header(80),
      ...row(100, '02/09/2026', 'B', '2.00'),
    ];
    const t = extractTable(buildLayout(doc(p1, p2)), rule());
    expect(t.rows.map((r) => [r.page, r.cells.Description!.value])).toEqual([
      [1, 'A'],
      [2, 'B'],
    ]);
  });

  it('without a repeated header, skips the top 8% of the next page', () => {
    const p1 = [...header(100), ...row(120, '01/09/2026', 'A', '1.00')];
    const p2 = [
      ...row(30, '09/09/2026', 'running', '9.99'),
      ...row(100, '02/09/2026', 'B', '2.00'),
    ];
    const t = extractTable(buildLayout(doc(p1, p2)), rule());
    expect(t.rows.map((r) => r.cells.Description!.value)).toEqual(['A', 'B']);
  });

  it('stops at the page end when continuesOnNextPage is false', () => {
    const p1 = [...header(100), ...row(120, '01/09/2026', 'A', '1.00')];
    const p2 = [...row(100, '02/09/2026', 'B', '2.00')];
    const t = extractTable(buildLayout(doc(p1, p2)), rule({ continuesOnNextPage: false }));
    expect(t.rows).toHaveLength(1);
  });

  it('merges a two-line header', () => {
    const tokens = [
      tok('Date', 50, 100),
      ...words('Item', 150, 100),
      ...words('Description', 150, 111),
      tok('Amount', 400, 111),
      ...row(130, '01/09/2026', 'A', '1.00'),
    ];
    const r = rule({ header: { labels: ['Date', 'Item Description', 'Amount'], minMatch: 3 } });
    r.columns[1] = { name: 'Description', header: 'Item Description' };
    const t = extractTable(buildLayout(doc(tokens)), r);
    expect(t.found).toBe(true);
    expect(t.rows).toHaveLength(1);
  });

  it('flags failed cells in required columns with confidence 0', () => {
    const tokens = [...header(100), ...row(120, '01/09/2026', 'A', 'n/a')];
    const t = extractTable(buildLayout(doc(tokens)), rule());
    expect(t.rows[0]!.cells.Amount!.error).toBe('parse_failed');
    expect(t.rows[0]!.conf).toBe(0);
  });

  it('reports a missing table', () => {
    expect(extractTable(buildLayout(doc([tok('nothing', 50, 50)])), rule()).found).toBe(false);
  });
});
