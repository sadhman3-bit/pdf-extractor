import { describe, expect, it } from 'vitest';
import { buildLayout, extractWith, outputGrid, toCsv, type Template } from '../src';
import { tok, words, doc } from './helpers';

const template = (): Template =>
  ({
    schema: 'pdfx.template/1',
    id: 'g',
    name: 'Grid',
    version: 1,
    fingerprint: { mustContain: ['Statement'] },
    fields: [
      {
        id: 'f1',
        name: 'AccountNo',
        type: 'text',
        anchor: { labels: ['Account No'] },
        direction: 'right',
      },
    ],
    tables: [
      {
        id: 't',
        name: 'Items',
        header: { labels: ['Date', 'Description', 'Amount'], minMatch: 2 },
        columns: [
          { name: 'Date', header: 'Date', type: 'date', required: true },
          { name: 'Description', header: 'Description' },
          { name: 'Amount', header: 'Amount', type: 'currency' },
        ],
        rowStart: { column: 'Date', pattern: String.raw`^\d{2}/\d{2}/\d{4}$` },
        groups: [{ name: 'Card', pattern: String.raw`^Card (\d+)$`, capture: 1 }],
      },
    ],
  }) as Template;

const page = () => [
  ...words('Statement', 50, 40),
  ...words('Account No:', 50, 60),
  tok('A-77', 150, 60),
  tok('Date', 50, 100),
  ...words('Description', 150, 100),
  tok('Amount', 400, 100),
  ...words('Card 12', 50, 120),
  tok('01/09/2026', 50, 140),
  ...words('Fuel', 150, 140),
  tok('10.00', 400, 140),
  tok('02/09/2026', 50, 160),
  ...words('Oil', 150, 160),
  tok('ten', 400, 160),
];

describe('outputGrid', () => {
  it('matches the CSV and marks problem cells with where they are', () => {
    const t = template();
    const r = extractWith(buildLayout(doc(page())), t);
    const g = outputGrid(r, t);
    expect(g.columns.map((c) => `${c.kind}:${c.name}`)).toEqual([
      'field:AccountNo',
      'column:Date',
      'column:Description',
      'column:Amount',
      'group:Card',
    ]);
    // Same cells as the CSV, minus the audit columns.
    const csv = toCsv(r, t, { file: 'x.pdf', sha256: '0', extractedAt: 'now' }, { bom: false })[0]!
      .content;
    const lines = csv
      .trim()
      .split('\r\n')
      .slice(1)
      .map((l) => l.split(',').slice(0, 5));
    expect(g.rows.map((row) => row.map((c) => c.text))).toEqual(lines);
    expect(g.rows[0]!.map((c) => c.text)).toEqual(['A-77', '2026-09-01', 'Fuel', '10.00', '12']);
    const bad = g.rows[1]![3]!;
    expect(bad).toMatchObject({ text: '', raw: 'ten', error: 'parse_failed' });
    expect(bad.box?.page).toBe(1);
    expect(g.problems).toBe(1);
  });

  it('gives one row of bill details when there is no table', () => {
    const t = { ...template(), tables: [] };
    const g = outputGrid(extractWith(buildLayout(doc(page())), t), t);
    expect(g.table).toBeNull();
    expect(g.rows).toEqual([[expect.objectContaining({ text: 'A-77' })]]);
  });
});

describe('shared CSV layouts', () => {
  it('writes exactly the layout columns, in order, with empty ones it lacks', () => {
    const t = {
      ...template(),
      layout: { name: 'Telco', columns: ['Date', 'AccountNo', 'Amount', 'Period', 'Card'] },
    };
    const r = extractWith(buildLayout(doc(page())), t);
    const csv = toCsv(r, t, { file: 'a.pdf', sha256: '', extractedAt: '' })[0]!.content;
    const lines = csv.trimStart().split('\r\n');
    expect(lines[0]!.startsWith('Date,AccountNo,Amount,Period,Card,_SourceFile')).toBe(true);
    expect(lines[1]!.startsWith('2026-09-01,A-77,10.00,,12,')).toBe(true);
    const g = outputGrid(r, t);
    expect(g.columns.map((c) => `${c.name}${c.missing ? '?' : ''}`)).toEqual([
      'Date',
      'AccountNo',
      'Amount',
      'Period?',
      'Card',
    ]);
    expect(g.rows[0]!.map((c) => c.text)).toEqual(['2026-09-01', 'A-77', '10.00', '', '12']);
  });
});
