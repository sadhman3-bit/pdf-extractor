import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  NORTHLINE,
  northlinePages,
  northlineTotals,
  coastalPages,
  apexPages,
  coaPages,
  makeAbn,
} from './docs';
import { newDoc, drawPage } from './layout';

const PDF = join(__dirname, '..', '..', '..', 'fixtures', 'pdf');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('fixture generator', () => {
  it('regenerates the committed digital fixtures byte for byte', async () => {
    const build = async (
      title: string,
      pages: (m: import('./layout').Metrics) => import('./layout').PageLayout[],
    ) => {
      const { doc, fonts, metrics } = await newDoc(title);
      for (const p of pages(metrics)) drawPage(doc, fonts, p);
      return doc.save({ useObjectStreams: false });
    };
    const sep = await build('Northline Fuel statement sep26', (m) =>
      northlinePages(m, NORTHLINE.sep26!),
    );
    expect(sha(sep)).toBe(sha(readFileSync(join(PDF, 'northline-sep26.pdf'))));
    const telco = await build('Coastal Telco bill', coastalPages);
    expect(sha(telco)).toBe(sha(readFileSync(join(PDF, 'coastal-telco-sep26.pdf'))));
    const apex = await build('Apex Fleet invoice', apexPages);
    expect(sha(apex)).toBe(sha(readFileSync(join(PDF, 'apex-fleet-sep26.pdf'))));
    const coa = await build('Harbourside COA', coaPages);
    expect(sha(coa)).toBe(sha(readFileSync(join(PDF, 'harbourside-coa-a2391.pdf'))));
  });

  it('Northline September totals match the plan example', () => {
    expect(northlineTotals(NORTHLINE.sep26!)).toEqual({ total: 424.18, gst: 38.56 });
  });

  it('generated ABNs pass the checksum', () => {
    const W = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    for (const seed of [1, 2, 3, 101, 202]) {
      const d = makeAbn(seed).replace(/\s/g, '').split('').map(Number);
      const sum = d.reduce((s, v, i) => s + (i === 0 ? v - 1 : v) * W[i]!, 0);
      expect(sum % 89).toBe(0);
    }
  });
});
