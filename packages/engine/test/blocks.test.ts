import { describe, it, expect } from 'vitest';
import {
  buildLayout,
  blockFromHeading,
  extractTable,
  extractWith,
  outputGrid,
  toCsv,
  toJsonObject,
  type TableRule,
  type Template,
} from '../src';
import { doc, words, tok } from './helpers';

const header = () => [
  ...words('Service Summary', 40, 100),
  tok('Excl', 410, 100),
  tok('Incl', 500, 100),
];
const heading = (n: string, y: number) => words(`Telephone ${n} AVC00000001`, 40, y);
const total = (n: string, y: number, ex = '45.45', inc = '50.00') => [
  ...words(`Total for ${n}`, 40, y),
  tok(ex, 410, y),
  tok(inc, 500, y),
];
const n1 = '02 5550 0160',
  n2 = '02 5550 0167';
const base: TableRule = {
  id: 't',
  name: 'Services',
  header: { labels: ['Service Summary', 'Excl', 'Incl'], minMatch: 2 },
  columns: [
    { name: 'Label', header: 'Service Summary', x0: 35, x1: 400 },
    { name: 'ExclGST', header: 'Excl', type: 'currency', required: true, x0: 400, x1: 490 },
    { name: 'InclGST', header: 'Incl', type: 'currency', required: true, x0: 490, x1: 570 },
  ],
  rowStart: { column: 'Label', pattern: '^Total for' },
  wrappedLines: 'ignore',
  end: { labels: ['Account total'], match: 'starts-with' },
  requireEnd: true,
};
const template = (t: TableRule): Template => ({
  schema: 'pdfx.template/1',
  id: 'test',
  name: 'Test',
  version: 1,
  fields: [],
  tables: [t],
  fingerprint: { mustContain: [] },
});
function setup() {
  const l = buildLayout(
    doc(
      [...header(), ...heading(n1, 120), ...words('Monthly charge', 40, 140)],
      [
        ...header(),
        ...total(n1, 130, '0.00', '0.00'),
        ...heading(n2, 150),
        ...total(n2, 180, '-45.45', '-50.00'),
        ...words('Account total', 40, 200),
      ],
    ),
  );
  const rule = {
    ...blockFromHeading(base, l.pages[0]!.lines[1]!),
    outputColumns: ['Name', 'PhoneNumber', 'ExclGST', 'InclGST'],
  };
  return { l, rule };
}
describe('repeating blocks', () => {
  it('keeps a selected wrapped heading and flags uncertain heading text', () => {
    const { rule } = setup();
    const l = buildLayout(
      doc([
        ...header(),
        ...heading(n1, 120).map((t) => ({ ...t, conf: 0.5 })),
        ...words('Branch reception', 40, 134),
        ...total(n1, 170),
        ...words('Account total', 40, 200),
      ]),
    );
    const ex = extractWith(l, template({ ...rule, block: { ...rule.block!, headingLines: 2 } }));
    expect(ex.tables.Services!.rows[0]!.groups.Name).toContain('Branch reception');
    expect(ex.status).toBe('review');
    expect(ex.reasons.some((r) => r.code === 'low_confidence' && r.column === 'Name')).toBe(true);
  });
  it('keeps complete names and phone numbers with totals across pages and exports four columns', () => {
    const { l, rule } = setup();
    const t = template(rule);
    const ex = extractWith(l, t);
    expect(ex.reasons).toEqual([]);
    const rows = ex.tables.Services!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.groups).toEqual({ Name: `Telephone ${n1} AVC00000001`, PhoneNumber: n1 });
    expect(rows[0]!.groupBoxes!.Name!.page).toBe(1);
    expect(rows[0]!.cells.ExclGST!.value).toBe(0);
    expect(rows[1]!.cells.InclGST!.value).toBe(-50);
    const grid = outputGrid(ex, t);
    expect(grid.columns.map((c) => c.name)).toEqual(rule.outputColumns);
    expect(grid.rows[0]![1]!.box?.page).toBe(1);
    const meta = { file: 'synthetic.pdf', sha256: '', extractedAt: '' };
    expect(toCsv(ex, t, meta)[0]!.content).toContain('Name,PhoneNumber,ExclGST,InclGST');
    expect(Object.keys(toJsonObject(ex, t, meta).tables.Services![0]!)).toEqual(rule.outputColumns);
  });
  it('flags orphan, missing and duplicate totals without reusing another heading', () => {
    const { rule } = setup();
    const l = buildLayout(
      doc([
        ...header(),
        ...total(n2, 110),
        ...heading(n1, 130),
        ...total(n2, 150),
        ...heading(n2, 170),
        ...total(n2, 190),
        ...total(n2, 210),
        ...words('Account total', 40, 230),
      ]),
    );
    const ex = extractWith(l, template(rule));
    expect(ex.status).toBe('review');
    expect(ex.tables.Services!.rows).toHaveLength(1);
    expect(ex.reasons.some((r) => r.message.includes('No matching total'))).toBe(true);
    expect(ex.reasons.some((r) => r.message.includes('More than one total'))).toBe(true);
    expect(ex.reasons.filter((r) => r.message.includes('no matching heading'))).toHaveLength(2);
  });
  it('flags missing endings and incomplete blocks when continuation is off', () => {
    const { l, rule } = setup();
    expect(extractTable(l, { ...rule, continuesOnNextPage: false }).issues).toHaveLength(2);
    expect(
      extractTable(l, { ...rule, end: { labels: ['Absent ending'] } }).issues?.some((i) =>
        i.message.includes('end of the table'),
      ),
    ).toBe(true);
  });
  it('supports another supplier label and a text-only block without phone assumptions', () => {
    const l = buildLayout(
      doc([
        ...header(),
        ...words('Department Accounts', 40, 120),
        ...total(n1, 150),
        ...words('Account total', 40, 180),
      ]),
    );
    const rule = blockFromHeading(base, l.pages[0]!.lines[1]!);
    expect(extractTable(l, rule).rows[0]!.groups.Name).toBe('Department Accounts');
  });
});
