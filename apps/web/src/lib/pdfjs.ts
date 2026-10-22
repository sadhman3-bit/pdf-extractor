// pdf.js on the main thread (rendering for the mapper, review and OCR).
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { openPdf, pageText, type OpenResult, type PdfjsLib, type PdfPage } from '@pdfx/pdf';
import type { PageText } from '@pdfx/engine';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const BASE = import.meta.env.BASE_URL;

/** getDocument options pointing at our own copies of pdf.js data files. */
export const PDF_OPTIONS = {
  wasmUrl: `${BASE}vendor/pdfjs/wasm/`,
  standardFontDataUrl: `${BASE}vendor/pdfjs/standard_fonts/`,
  cMapUrl: `${BASE}vendor/pdfjs/cmaps/`,
  cMapPacked: true,
};

export const lib = pdfjs as unknown as PdfjsLib;

export function open(bytes: Uint8Array): Promise<OpenResult> {
  return openPdf(lib, bytes, { extra: PDF_OPTIONS });
}

export async function readPages(
  bytes: Uint8Array,
): Promise<{ ok: true; pages: PageText[] } | Extract<OpenResult, { ok: false }>> {
  const o = await open(bytes);
  if (!o.ok) return o;
  try {
    const pages: PageText[] = [];
    for (let i = 1; i <= o.doc.numPages; i++) pages.push(await pageText(o.doc, i));
    return { ok: true, pages };
  } finally {
    await o.close();
  }
}

/** Renders one page into a canvas at `scale` (CSS pixels per point × device pixel ratio). */
export async function renderPage(
  page: PdfPage,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<void> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
}
