import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readPdfNode } from '../src/node';

const DIR = join(__dirname, '..', '..', '..', 'fixtures', 'pdf');
const files = readdirSync(DIR).filter((f) => f.endsWith('.pdf'));
const bad = new Set(['encrypted.pdf', 'corrupt.pdf']);

describe('fixtures open in pdf.js', () => {
  it.each(files.filter((f) => !bad.has(f)))('%s opens', async (f) => {
    const res = await readPdfNode(new Uint8Array(readFileSync(join(DIR, f))));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pages.length).toBeGreaterThan(0);
    const words = res.pages.reduce((s, p) => s + p.tokens.length, 0);
    if (f.includes('scan') || f === 'blank.pdf') expect(words).toBe(0);
    else expect(words).toBeGreaterThan(20);
  });

  it('encrypted.pdf reports password_protected', async () => {
    const res = await readPdfNode(new Uint8Array(readFileSync(join(DIR, 'encrypted.pdf'))));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('password_protected');
  });

  it('corrupt.pdf reports unreadable', async () => {
    const res = await readPdfNode(new Uint8Array(readFileSync(join(DIR, 'corrupt.pdf'))));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unreadable');
  });

  it('page counts', async () => {
    const pages = async (f: string) => {
      const r = await readPdfNode(new Uint8Array(readFileSync(join(DIR, f))));
      return r.ok ? r.pages.length : -1;
    };
    expect(await pages('northline-sep26.pdf')).toBe(2);
    expect(await pages('coastal-telco-sep26.pdf')).toBe(14);
    expect(await pages('apex-fleet-sep26.pdf')).toBe(3);
  });
});
