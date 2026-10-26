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
/** The page colour from tokens.css (white in both themes). */
function paper(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || 'white';
}

/**
 * Renders a page into `canvas`. The page is drawn off screen and copied over only
 * when finished, so a resize mid-render never shows a half-drawn or garbled page.
 * Call `cancel` before starting another render of the same canvas.
 */
export function renderPage(
  page: PdfPage,
  canvas: HTMLCanvasElement,
  scale: number,
): { promise: Promise<void>; cancel: () => void } {
  const viewport = page.getViewport({ scale });
  const off = document.createElement('canvas');
  off.width = Math.ceil(viewport.width);
  off.height = Math.ceil(viewport.height);
  const ctx = off.getContext('2d');
  if (!ctx)
    return { promise: Promise.reject(new Error('Canvas is not available')), cancel: () => {} };
  ctx.fillStyle = paper();
  ctx.fillRect(0, 0, off.width, off.height);
  const task = page.render({ canvas: off, canvasContext: ctx, viewport });
  const promise = task.promise.then(() => {
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext('2d')?.drawImage(off, 0, 0);
    off.width = 0;
    off.height = 0;
  });
  return { promise, cancel: () => task.cancel() };
}
