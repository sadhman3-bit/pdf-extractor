import { describe, expect, it } from 'vitest';
import {
  parseExpr,
  evaluate,
  validateExpr,
  runCheck,
  defaultChecks,
  humanize,
  toCsv,
  toJson,
  type EvalContext,
  type Extraction,
  type Template,
} from '../src';

const ctx = (extra: Partial<EvalContext> = {}): EvalContext => ({
  fields: { TotalDue: 424.18, TotalGST: 38.56, Name: 'x', Missing: null },
  tables: {
    T: [
      { Amount: 98.45, Note: 'a' },
      { Amount: 325.73, Note: null },
    ],
  },
  tolerance: 0.01,
  ...extra,
});
const ev = (s: string, c = ctx()) => evaluate(parseExpr(s), c);

describe('expression parser', () => {
  it('respects precedence and parentheses', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('10 - 4 - 3')).toBe(3);
    expect(ev('8 / 4 / 2')).toBe(1);
    expect(ev('-2 * -3')).toBe(6);
    expect(ev('- (1 + 1)')).toBe(-2);
  });
  it('compares, with ~= using the tolerance', () => {
    expect(ev('sum(T.Amount) ~= TotalDue')).toBe(true);
    expect(ev('424.17 ~= TotalDue')).toBe(true);
    expect(ev('424.15 ~= TotalDue')).toBe(false);
    expect(ev('1 == 1')).toBe(true);
    expect(ev('1 != 1')).toBe(false);
    expect(ev('2 >= 2')).toBe(true);
    expect(ev('2 < 1')).toBe(false);
  });
  it('functions', () => {
    expect(ev('round(TotalDue / 11, 2)')).toBe(38.56);
    expect(ev('round(2.5)')).toBe(3);
    expect(ev('abs(-3)')).toBe(3);
    expect(ev('count(T)')).toBe(2);
    expect(ev('count(T.Note)')).toBe(1);
    expect(ev('min(T.Amount)')).toBe(98.45);
    expect(ev('max(T.Amount)')).toBe(325.73);
    expect(ev('avg(T.Amount)')).toBeCloseTo(212.09);
    expect(ev('max(1, 5, 3)')).toBe(5);
    expect(ev('exists(TotalDue)')).toBe(true);
    expect(ev('exists(Missing)')).toBe(false);
  });
  it('missing values make the result unknown', () => {
    expect(ev('Missing + 1')).toBeNull();
    expect(ev('Missing ~= 1')).toBeNull();
    expect(ev('Name > 1')).toBeNull();
    expect(ev('1 / 0')).toBeNull();
  });
  it('reports syntax errors with a position', () => {
    expect(() => parseExpr('1 +')).toThrow(/incomplete/);
    expect(() => parseExpr('sum(T.Amount')).toThrow(/Expected/);
    expect(() => parseExpr('foo(1)')).toThrow(/Unknown function/);
    expect(() => parseExpr('T.Amount > 1')).toThrow(/only be used inside/);
    expect(() => parseExpr('round(T.Amount)')).toThrow(/only be used inside/);
    expect(() => parseExpr('1 # 2')).toThrow(/Unexpected/);
    expect(() => parseExpr('exists(1)')).toThrow(/field name/);
  });
  it('validates names against a template', () => {
    const known = { fields: ['TotalDue'], tables: { T: ['Amount'] } };
    expect(validateExpr('sum(T.Amount) ~= TotalDue', known)).toBeNull();
    expect(validateExpr('sum(T.Price) ~= TotalDue', known)).toBe('Unknown column "T.Price"');
    expect(validateExpr('Total > 1', known)).toBe('Unknown field "Total"');
    expect(validateExpr('count(X) > 0', known)).toBe('Unknown table "X"');
  });
});

describe('checks', () => {
  const types = {
    TotalDue: 'currency' as const,
    'T.Amount': 'currency' as const,
    TotalGST: 'currency' as const,
  };
  const base = { fields: ctx().fields, tables: ctx().tables };
  it('passes, fails with a plain-English message, or is unknown', () => {
    expect(
      runCheck({ id: 'c', label: 'Sum', expr: 'sum(T.Amount) ~= TotalDue' }, base, types).result,
    ).toBe('pass');
    const fail = runCheck(
      { id: 'c', label: 'Sum', expr: 'sum(T.Amount) ~= TotalDue' },
      { ...base, tables: { T: [{ Amount: 98.45 }, { Amount: 316.73 }] } },
      types,
    );
    expect(fail.result).toBe('fail');
    expect(fail.message).toBe(
      'Amounts add up to $415.18, but Total Due is $424.18. Short by $9.00.',
    );
    const over = runCheck(
      { id: 'c', label: 'Sum', expr: 'sum(T.Amount) ~= TotalDue' },
      { ...base, fields: { ...base.fields, TotalDue: 400 } },
      types,
    );
    expect(over.message).toBe(
      'Amounts add up to $424.18, but Total Due is $400.00. Over by $24.18.',
    );
    const unknown = runCheck({ id: 'c', label: 'Has', expr: 'Missing > 0' }, base, types);
    expect(unknown).toMatchObject({
      result: 'unknown',
      message: 'Check “Has” couldn’t be worked out because Missing is missing.',
    });
    const gst = runCheck(
      { id: 'g', label: 'GST', expr: 'round(TotalDue / 11, 2) ~= TotalGST', tolerance: 0.02 },
      { ...base, fields: { ...base.fields, TotalGST: 30 } },
      types,
    );
    expect(gst.message).toBe(
      'Check “GST” failed: Total Due ÷ 11 is $38.56, but Total GST is $30.00.',
    );
  });
  it('humanises names', () => {
    expect(humanize('TotalDue')).toBe('Total Due');
    expect(humanize('TotalGST')).toBe('Total GST');
    expect(humanize('PONumber')).toBe('PO Number');
  });
  it('offers default checks', () => {
    const t: Template = {
      schema: 'pdfx.template/1',
      id: 'x',
      name: 'x',
      version: 0,
      fingerprint: { mustContain: [] },
      fields: [
        {
          id: '1',
          name: 'TotalDue',
          type: 'currency',
          required: true,
          anchor: { labels: ['Total Due'] },
        },
        { id: '2', name: 'TotalGST', type: 'currency', anchor: { labels: ['GST'] } },
      ],
      tables: [
        {
          id: 't',
          name: 'Lines',
          header: { labels: ['Amount'] },
          columns: [{ name: 'Amount', header: 'Amount', type: 'currency' }],
        },
      ],
    };
    expect(defaultChecks(t).map((c) => c.expr)).toEqual([
      'exists(TotalDue)',
      'sum(Lines.Amount) ~= TotalDue',
      'round(TotalDue / 11, 2) ~= TotalGST',
      'count(Lines) > 0',
    ]);
  });
});

describe('writers', () => {
  const t: Template = {
    schema: 'pdfx.template/1',
    id: 'tpl',
    name: 'Tpl',
    version: 3,
    fingerprint: { mustContain: ['x'] },
    fields: [{ id: '1', name: 'Name', anchor: { labels: ['Name'] } }],
    tables: [
      { id: 'a', name: 'A', header: { labels: ['X'] }, columns: [{ name: 'X', header: 'X' }] },
      {
        id: 'b',
        name: 'B',
        header: { labels: ['Y'] },
        columns: [{ name: 'Y', header: 'Y', type: 'number' }],
      },
    ],
  };
  const cell = (csv: string, value: string | number) => ({
    value,
    csv,
    raw: csv,
    conf: 1,
    boxes: [],
  });
  const result: Extraction = {
    status: 'ok',
    reasons: [],
    template: { id: 'tpl', name: 'Tpl', version: 3 },
    candidates: [],
    fields: {
      Name: {
        name: 'Name',
        type: 'text',
        required: false,
        value: 'Acme, "Ltd"',
        csv: 'Acme, "Ltd"',
        raw: '',
        conf: 1,
        boxes: [],
        via: 'anchor',
      },
    },
    tables: {
      A: {
        name: 'A',
        found: true,
        bounds: [],
        rows: [
          {
            cells: { X: cell('line1\nline2', 'line1\nline2') },
            groups: {},
            conf: 1,
            page: 1,
            bbox: [0, 0, 0, 0],
          },
        ],
      },
      B: { name: 'B', found: true, bounds: [], rows: [] },
    },
    checks: [],
    confidence: { min: 1 },
    pages: 1,
    ocr: false,
  };
  const meta = { file: 'a.pdf', sha256: 'abc', extractedAt: '2026-10-22T09:14:03Z' };
  it('writes one CSV per table when there are several, with RFC 4180 quoting, BOM and CRLF', () => {
    const files = toCsv(result, t, meta);
    expect(files.map((f) => f.table)).toEqual(['A', 'B']);
    expect(files[0]!.content).toBe(
      '﻿Name,X,_SourceFile,_SourceSha256,_Template,_TemplateVersion,_ExtractedAt,_Status,_ReviewedBy,_Corrected\r\n' +
        '"Acme, ""Ltd""","line1\nline2",a.pdf,abc,tpl,3,2026-10-22T09:14:03Z,ok,,false\r\n',
    );
    // A table with no rows still gives one row of header fields.
    expect(files[1]!.content.split('\r\n')[1]).toBe(
      '"Acme, ""Ltd""",,a.pdf,abc,tpl,3,2026-10-22T09:14:03Z,ok,,false',
    );
    expect(toCsv(result, t, meta, { bom: false })[0]!.content.startsWith('Name')).toBe(true);
  });
  it('marks corrected outputs', () => {
    const csv = toCsv(result, t, {
      ...meta,
      reviewedBy: 'Sam',
      corrections: [{ field: 'Name', from: 'a', to: 'b' }],
    })[0]!.content;
    expect(csv.split('\r\n')[1]!.endsWith(',ok,Sam,true')).toBe(true);
    const json = JSON.parse(
      toJson(result, t, {
        ...meta,
        reviewedBy: 'Sam',
        corrections: [{ field: 'Name', from: 'a', to: 'b' }],
      }),
    );
    expect(json.reviewedBy).toBe('Sam');
    expect(json.corrections).toEqual([{ field: 'Name', from: 'a', to: 'b' }]);
  });
  it('JSON follows pdfx.extraction/1 and is reproducible', () => {
    const a = toJson(result, t, meta);
    expect(a).toBe(toJson(result, t, meta));
    const j = JSON.parse(a);
    expect(Object.keys(j)).toEqual([
      'schema',
      'source',
      'template',
      'status',
      'reasons',
      'fields',
      'tables',
      'checks',
      'confidence',
      'extractedAt',
      'reviewedBy',
      'corrections',
    ]);
    expect(j.template).toEqual({ id: 'tpl', version: 3 });
  });
});
