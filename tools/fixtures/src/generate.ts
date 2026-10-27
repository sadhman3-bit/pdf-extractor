// Generates every fixture PDF into fixtures/pdf. Deterministic: the same code
// produces the same bytes on every run (on the same machine for scanned files).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { chromium } from '@playwright/test';
import { newDoc, drawPage, pageHtml, rng, type PageLayout } from './layout';
import {
  NORTHLINE,
  northlinePages,
  coastalPages,
  apexPages,
  ridgewayPages,
  summitPages,
  coaPages,
} from './docs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PDF_DIR = join(ROOT, 'fixtures', 'pdf');

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: false });
}

async function digital(
  title: string,
  build: (m: import('./layout').Metrics) => PageLayout[],
  rotate: 0 | 90 = 0,
) {
  const { doc, fonts, metrics } = await newDoc(title);
  for (const page of build(metrics)) drawPage(doc, fonts, page, rotate);
  return save(doc);
}

async function scanned(title: string, pages: PageLayout[], seed: number): Promise<Uint8Array> {
  const browser = await chromium.launch();
  try {
    const dpi = 200;
    const scale = dpi / 72;
    const { doc } = await newDoc(title);
    const r = rng(seed);
    for (let i = 0; i < pages.length; i++) {
      const layout = pages[i]!;
      const ctx = await browser.newContext({
        viewport: { width: Math.round(layout.width), height: Math.round(layout.height) },
        deviceScaleFactor: scale,
      });
      const page = await ctx.newPage();
      const tilt = Math.round((r() - 0.5) * 80) / 100; // about ±0.4°
      await page.setContent(pageHtml(layout, seed + i, tilt));
      const png = await page.screenshot({ type: 'png', fullPage: false });
      await ctx.close();
      const img = await doc.embedPng(png);
      const p = doc.addPage([layout.width, layout.height]);
      p.drawImage(img, { x: 0, y: 0, width: layout.width, height: layout.height });
    }
    return save(doc);
  } finally {
    await browser.close();
  }
}

/** A hand-built PDF that uses the standard security handler with an unknown user password. */
function encryptedPdf(): Uint8Array {
  const hex = (seed: number, n: number) => {
    const r = rng(seed);
    return Array.from({ length: n }, () =>
      Math.floor(r() * 256)
        .toString(16)
        .padStart(2, '0'),
    ).join('');
  };
  const content = 'BT /F1 12 Tf 72 720 Td (secret) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Filter /Standard /V 1 /R 2 /O <${hex(11, 32)}> /U <${hex(12, 32)}> /P -3904 >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  const id = hex(13, 16);
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 5 0 R /ID [<${id}><${id}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function corruptPdf(): Uint8Array {
  const r = rng(99);
  const head = new TextEncoder().encode('%PDF-1.7\n%âã\n');
  const body = Uint8Array.from({ length: 2048 }, () => Math.floor(r() * 256));
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

async function blankPdf() {
  const { doc } = await newDoc('Blank');
  doc.addPage([595.28, 841.89]);
  return save(doc);
}

export async function generateAll(): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  for (const key of ['sep26', 'jun26', 'jul26', 'aug26'] as const) {
    files[`northline-${key}.pdf`] = await digital(`Northline Fuel statement ${key}`, (m) =>
      northlinePages(m, NORTHLINE[key]!),
    );
  }
  {
    const { metrics } = await newDoc('metrics');
    files['northline-sep26-card2-scan.pdf'] = await scanned(
      'Northline Fuel statement (scanned)',
      northlinePages(metrics, NORTHLINE.sep26card2!),
      4821,
    );
  }
  files['coastal-telco-sep26.pdf'] = await digital('Coastal Telco bill', coastalPages);
  files['apex-fleet-sep26.pdf'] = await digital('Apex Fleet invoice', apexPages);
  files['ridgeway-invoice-88231.pdf'] = await digital('Ridgeway invoice', ridgewayPages);
  files['harbourside-coa-a2391.pdf'] = await digital('Harbourside COA', coaPages);
  files['summit-voice-jan26.pdf'] = await digital('Summit Voice bill', summitPages);
  files['encrypted.pdf'] = encryptedPdf();
  files['corrupt.pdf'] = corruptPdf();
  files['rotated.pdf'] = await digital(
    'Northline Fuel statement (rotated)',
    (m) => northlinePages(m, NORTHLINE.sep26!).slice(0, 1),
    90,
  );
  files['blank.pdf'] = await blankPdf();
  return files;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  mkdirSync(PDF_DIR, { recursive: true });
  const files = await generateAll();
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(PDF_DIR, name), bytes);
    const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    console.log(`${name.padEnd(34)} ${String(bytes.length).padStart(9)} bytes  ${sha}`);
  }
}
