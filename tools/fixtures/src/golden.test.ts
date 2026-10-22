import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildLayout,
  extractWith,
  processDocument,
  type TemplateSet,
  type DocText,
} from '@pdfx/engine';
import { readPdfNode } from '@pdfx/pdf/node';
import { EXPECTED_DIR, PDF_DIR, goldenOutputs, loadTemplateSets, runFixture } from './goldens';

let sets: TemplateSet[];
beforeAll(() => {
  sets = loadTemplateSets();
});

const expected = (name: string) => readFileSync(join(EXPECTED_DIR, name), 'utf8');
const expectedJson = (name: string) => JSON.parse(expected(name));

async function tokens(file: string): Promise<DocText> {
  const r = await readPdfNode(new Uint8Array(readFileSync(join(PDF_DIR, file))));
  if (!r.ok) throw new Error(r.message);
  return { pages: r.pages };
}

describe('M2: header fields', () => {
  it.each([
    ['northline-sep26.pdf', 'northline-sep26.json'],
    ['apex-fleet-sep26.pdf', 'apex-fleet-sep26.json'],
    ['harbourside-coa-a2391.pdf', 'harbourside-coa-a2391.json'],
  ])('%s header fields match the golden', async (file, golden) => {
    const { result } = await runFixture(file, sets);
    const values = Object.fromEntries(Object.entries(result.fields).map(([k, v]) => [k, v.value]));
    expect(values).toEqual(expectedJson(golden).fields);
  });

  it('known values', async () => {
    const { result } = await runFixture('northline-sep26.pdf', sets);
    expect(result.fields.StatementNo!.value).toBe('ST-48213');
    expect(result.fields.StatementDate!.value).toBe('2026-09-30');
    expect(result.fields.TotalGST!.value).toBe(38.56);
    expect(result.fields.TotalDue!.value).toBe(424.18);
  });

  it('encrypted.pdf and corrupt.pdf give error with the right reasons', async () => {
    const enc = (await runFixture('encrypted.pdf', sets)).result;
    expect(enc.status).toBe('error');
    expect(enc.reasons[0]).toMatchObject({
      code: 'password_protected',
      message: 'This PDF is password protected.',
    });
    const bad = (await runFixture('corrupt.pdf', sets)).result;
    expect(bad.status).toBe('error');
    expect(bad.reasons[0]!.code).toBe('unreadable');
  });

  it('rotated.pdf extracts the same values as the upright page', async () => {
    const rot = (await runFixture('rotated.pdf', sets)).result;
    const sep = (await runFixture('northline-sep26.pdf', sets)).result;
    expect(rot.status).toBe('ok');
    for (const k of Object.keys(sep.fields))
      expect(rot.fields[k]!.value).toEqual(sep.fields[k]!.value);
    expect(rot.tables.Transactions!.rows.map((r) => r.cells.Amount!.value)).toEqual(
      sep.tables.Transactions!.rows.map((r) => r.cells.Amount!.value),
    );
  });

  it('the June layout picks up the alternate labels', async () => {
    const jun = (await runFixture('northline-jun26.pdf', sets)).result;
    expect(jun.status).toBe('ok');
    expect(jun.fields.TotalDue!.anchor!.label).toBe('Amount payable');
  });
});

describe('M3: tables', () => {
  const rows = async (file: string, table: string) =>
    (await runFixture(file, sets)).result.tables[table]!.rows;

  it('Northline: 6 rows', async () => {
    const r = await rows('northline-sep26.pdf', 'Transactions');
    expect(r).toHaveLength(6);
    expect(r.map((x) => x.cells.Amount!.value)).toEqual([98.45, 61.2, 75.36, 43.32, 88.15, 57.7]);
    expect(expectedJson('northline-sep26.json').tables.Transactions).toHaveLength(6);
  });

  it('Apex: 41 rows across 3 pages, credits negative', async () => {
    const r = await rows('apex-fleet-sep26.pdf', 'Items');
    expect(r).toHaveLength(41);
    expect(new Set(r.map((x) => x.page))).toEqual(new Set([1, 2, 3]));
    const credits = r.filter((x) => (x.cells.Amount!.value as number) < 0);
    expect(credits.length).toBeGreaterThan(0);
    for (const c of credits) expect(c.cells.Description!.value).toBe('Credit – price adjustment');
  });

  it('Coastal Telco: every call, with ServiceNumber filled in', async () => {
    const { coastalCalls } = await import('./docs');
    const calls = coastalCalls().calls;
    const r = await rows('coastal-telco-sep26.pdf', 'Calls');
    expect(r).toHaveLength(calls.length);
    r.forEach((row, i) => {
      expect(row.groups.ServiceNumber).toBe(calls[i]!.service);
      expect(row.cells.Amount!.value).toBe(calls[i]!.amount);
      expect(row.cells.Description!.value).toBe(
        [calls[i]!.description, calls[i]!.wrap].filter(Boolean).join(' '),
      );
    });
    expect(new Set(r.map((x) => x.groups.ServiceNumber)).size).toBe(3);
  });

  it('COA: all results, wrapped methods joined', async () => {
    const r = await rows('harbourside-coa-a2391.pdf', 'Results');
    expect(r).toHaveLength(8);
    expect(r.map((x) => x.cells.Method!.value)).toContain('Inductively coupled plasma (ICP-MS)');
    expect(r.map((x) => x.cells.Method!.value)).toContain('Karl Fischer titration');
    expect(r.find((x) => x.cells.Test!.value === 'Sulfated ash')!.cells.Specification!.value).toBe(
      '≤ 0.05',
    );
    expect(r.find((x) => x.cells.Test!.value === 'Particle size')!.cells.Specification!.value).toBe(
      '0.5 – 1.2',
    );
  });

  it.each([
    ['northline-sep26.pdf', 'northline-sep26.json'],
    ['apex-fleet-sep26.pdf', 'apex-fleet-sep26.json'],
    ['coastal-telco-sep26.pdf', 'coastal-telco-sep26.json'],
    ['harbourside-coa-a2391.pdf', 'harbourside-coa-a2391.json'],
  ])('%s tables match the golden', async (file, golden) => {
    const { out } = await goldenOutputs(file, sets);
    expect(JSON.parse(out[golden]!).tables).toEqual(expectedJson(golden).tables);
  });
});

describe('M4: outputs byte for byte', () => {
  it.each([
    'northline-sep26.pdf',
    'northline-jun26.pdf',
    'northline-jul26.pdf',
    'northline-aug26.pdf',
    'coastal-telco-sep26.pdf',
    'apex-fleet-sep26.pdf',
    'harbourside-coa-a2391.pdf',
    'rotated.pdf',
    'ridgeway-invoice-88231.pdf',
    'encrypted.pdf',
    'corrupt.pdf',
    'blank.pdf',
  ])('%s', async (file) => {
    const { out } = await goldenOutputs(file, sets);
    expect(Object.keys(out).length).toBeGreaterThan(0);
    for (const [name, content] of Object.entries(out)) expect(content, name).toBe(expected(name));
  });

  it('changing one amount gives review with the exact reason', async () => {
    const doc = await tokens('northline-sep26.pdf');
    const t = doc.pages[0]!.tokens.find((x) => x.text === '43.32')!;
    t.text = '34.32';
    const res = processDocument(doc, sets);
    expect(res.status).toBe('review');
    expect(res.reasons).toEqual([
      {
        code: 'check_failed',
        message: 'Amounts add up to $415.18, but Total Due is $424.18. Short by $9.00.',
      },
    ]);
  });

  it('a low-confidence value sends the file to review', async () => {
    const doc = await tokens('northline-sep26.pdf');
    doc.pages[0]!.tokens.find((x) => x.text === '$38.56')!.conf = 0.5;
    const res = processDocument(doc, sets);
    expect(res.status).toBe('review');
    expect(res.reasons[0]).toMatchObject({ code: 'low_confidence', field: 'TotalGST' });
    expect(res.confidence.min).toBe(0.5);
  });

  it('ambiguous when two templates match', async () => {
    const doc = await tokens('northline-sep26.pdf');
    const nl = sets.find((s) => s.id === 'northline-fuel-statement')!;
    const copy = {
      id: 'copy',
      versions: nl.versions.map((v) => ({ ...v, id: 'copy', name: 'Copy' })),
    };
    const res = processDocument(doc, [...sets, copy]);
    expect(res.status).toBe('ambiguous');
    expect(res.candidates.map((c) => c.id).sort()).toEqual(['copy', 'northline-fuel-statement']);
  });

  it('a missing required field is reported in plain English', async () => {
    const doc = await tokens('northline-sep26.pdf');
    const v2 = sets
      .find((s) => s.id === 'northline-fuel-statement')!
      .versions.find((v) => v.version === 2)!;
    const t = {
      ...v2,
      fields: v2.fields.map((f) =>
        f.name === 'TotalDue' ? { ...f, anchor: { labels: ['Grand total'] } } : f,
      ),
    };
    const res = extractWith(buildLayout(doc), t);
    expect(res.status).toBe('review');
    expect(res.reasons[0]).toEqual({
      code: 'missing_field',
      message: 'Couldn’t find Total Due: the label “Grand total” isn’t on the page.',
      field: 'TotalDue',
    });
  });
});
