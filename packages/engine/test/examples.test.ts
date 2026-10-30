import { describe, expect, it } from 'vitest';
import { buildLayout, extractTable, learnExample, parseTemplate, type TableRule } from '../src';
import { doc, tok, words } from './helpers';

const base: TableRule = {
  id: 'services',
  name: 'Services',
  header: { labels: ['Service Summary', 'Excl', 'Incl'], minMatch: 2 },
  columns: [
    { name: 'Label', header: 'Service Summary', x0: 30, x1: 400 },
    { name: 'ExclGST', header: 'Excl', type: 'currency', x0: 400, x1: 490 },
    { name: 'InclGST', header: 'Incl', type: 'currency', x0: 490, x1: 570 },
  ],
  rowStart: { column: 'Label', pattern: '^Total for' },
};
const header = () => [
  ...words('Service Summary', 40, 100),
  tok('Excl', 410, 100),
  tok('Incl', 500, 100),
];
const total = (n: string, y: number) => [
  ...words(`Total for ${n}`, 40, y),
  tok('45.45', 410, y),
  tok('50.00', 500, y),
];
function setup() {
  return buildLayout(
    doc(
      [
        ...header(),
        ...words('MobileNet 0400 555 010 West Depot', 40, 130),
        ...total('0400 555 010', 160),
        ...words('Telephone 02 5550 0120 East Office', 40, 190),
      ],
      [
        ...header(),
        ...total('02 5550 0120', 130),
        ...words('MobileNet 0400 555 020', 40, 160),
        ...total('0400 555 020', 190),
      ],
    ),
  );
}
describe('labelled examples', () => {
  it('learns two heading styles, carries across pages and leaves absent names blank', () => {
    const l = setup();
    const first = l.pages[0]!.lines.find((x) => x.text.includes('West Depot'))!;
    const second = l.pages[0]!.lines.find((x) => x.text.includes('East Office'))!;
    let rule = learnExample(l, base, first.tokens.slice(-2), 'Name')!;
    expect(extractTable(l, rule).rows.map((r) => r.groups.Name ?? '')).toEqual([
      'West Depot',
      'East Office',
      '',
    ]);
    rule = learnExample(l, rule, second.tokens.slice(-2), 'Name')!;
    const result = extractTable(l, rule);
    expect(result.rows.map((r) => r.groups.Name ?? '')).toEqual(['West Depot', 'East Office', '']);
    expect(result.rows.map((r) => r.groups.PhoneNumber)).toEqual([
      '0400 555 010',
      '02 5550 0120',
      '0400 555 020',
    ]);
    expect(result.rows[1]!.groupBoxes!.Name!.page).toBe(1);
    expect(result.rows[1]!.page).toBe(2);
    expect(result.issues ?? []).toEqual([]);
    expect(rule.outputColumns).toEqual(['Name', 'PhoneNumber', 'ExclGST', 'InclGST']);
    expect(
      parseTemplate({
        schema: 'pdfx.template/1',
        id: 'test',
        name: 'Test',
        version: 1,
        fingerprint: { mustContain: [] },
        fields: [],
        tables: [rule],
      }).ok,
    ).toBe(true);
  });
  it('renames an amount column from a cell and rejects a selection across columns', () => {
    const l = setup();
    const line = l.pages[0]!.lines.find((x) => x.text.startsWith('Total'))!;
    const rule = learnExample(l, base, [line.tokens.at(-2)!], 'Before tax')!;
    expect(extractTable(l, rule).rows[0]!.cells['Before tax']!.value).toBe(45.45);
    expect(learnExample(l, base, line.tokens.slice(-2), 'Amount')).toBeNull();
  });
  it('rejects disjoint or multi-line examples instead of inventing a rule', () => {
    const l = setup();
    const lines = l.pages[0]!.lines;
    expect(
      learnExample(l, base, [lines[1]!.tokens[0]!, lines[1]!.tokens.at(-1)!], 'Name'),
    ).toBeNull();
    expect(learnExample(l, base, [lines[1]!.tokens[0]!, lines[2]!.tokens[0]!], 'Name')).toBeNull();
    const line = lines.find((x) => x.text.includes('West Depot'))!;
    const learned = learnExample(l, base, line.tokens.slice(-2), 'Name')!;
    expect(learnExample(l, learned, line.tokens.slice(-1), 'Name')).toBeNull();
  });
});
