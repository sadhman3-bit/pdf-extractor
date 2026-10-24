// Measures the digital performance targets (section 4.12) in Node with the same
// engine and pdf.js adapter the app runs in its worker. OCR is measured in the
// browser by the OCR end-to-end test. Run with `pnpm perf`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { processDocument } from '@pdfx/engine';
import { readPdfNode } from '@pdfx/pdf/node';
import { PDF_DIR, GOLDEN_FIXTURES, loadTemplateSets } from './goldens';

const sets = loadTemplateSets();
const bytesOf = (f: string) => new Uint8Array(readFileSync(join(PDF_DIR, f)));

async function extract(bytes: Uint8Array): Promise<void> {
  const r = await readPdfNode(bytes);
  if (r.ok) processDocument({ pages: r.pages }, sets);
}

async function time(fn: () => Promise<void>, runs = 5): Promise<number> {
  await fn(); // warm up pdf.js
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    await fn();
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)]!;
}

/** A 20-page digital PDF: the 14-page Coastal bill plus 6 of its pages again. */
async function twentyPages(): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytesOf('coastal-telco-sep26.pdf'));
  const out = await PDFDocument.create();
  const idx = [...src.getPageIndices(), ...src.getPageIndices().slice(0, 6)];
  for (const p of await out.copyPages(src, idx)) out.addPage(p);
  return out.save();
}

const digital = GOLDEN_FIXTURES.filter(
  (f) => !['encrypted.pdf', 'corrupt.pdf', 'blank.pdf'].includes(f),
);
const twoPage = bytesOf('northline-sep26.pdf');
const twenty = await twentyPages();
const fifty = Array.from({ length: 50 }, (_, i) => bytesOf(digital[i % digital.length]!));

const results = [
  { name: '2-page digital PDF', ms: await time(() => extract(twoPage)), target: 300 },
  { name: '20-page digital PDF', ms: await time(() => extract(twenty)), target: 2000 },
  {
    name: '50 digital PDFs',
    ms: await time(async () => {
      for (const b of fifty) await extract(b);
    }, 3),
    target: 30000,
  },
];

let failed = false;
for (const r of results) {
  const ok = r.ms < r.target;
  failed ||= !ok;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.ms.toFixed(0)} ms (target < ${r.target} ms)`,
  );
}
if (failed) process.exitCode = 1;
