// OCR in the browser with self-hosted tesseract.js files. One worker is reused for a whole run.
import { createWorker, OEM, type Worker } from 'tesseract.js';
import { ocrPageText, type OcrBlock, type PdfPage } from '@pdfx/pdf';
import type { PageText } from '@pdfx/engine';
import { renderPage } from './pdfjs';

const BASE = import.meta.env.BASE_URL;
/** About 216 DPI. */
export const OCR_SCALE = 3;

let worker: Promise<Worker> | null = null;

function abs(path: string): string {
  return new URL(path, location.href).href;
}

export function getOcrWorker(): Promise<Worker> {
  if (!worker) {
    worker = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: abs(`${BASE}vendor/tesseract/worker.min.js`),
      corePath: abs(`${BASE}vendor/tesseract-core`),
      langPath: abs(`${BASE}vendor/tessdata`),
      workerBlobURL: false,
      gzip: true,
    }).catch((e) => {
      worker = null;
      throw e;
    });
  }
  return worker;
}

export async function terminateOcr(): Promise<void> {
  if (!worker) return;
  const w = worker;
  worker = null;
  await (await w).terminate();
}

/** Renders a page at 3× on the main thread and reads it with tesseract.js. */
export async function ocrPage(page: PdfPage, pageNo: number): Promise<PageText> {
  const canvas = document.createElement('canvas');
  await renderPage(page, canvas, OCR_SCALE);
  const vp = page.getViewport({ scale: 1 });
  const w = await getOcrWorker();
  const bitmap = await createImageBitmap(canvas);
  const res = await w.recognize(canvas, {}, { blocks: true, text: false });
  bitmap.close();
  canvas.width = 0;
  canvas.height = 0;
  const blocks = (res.data as unknown as { blocks: OcrBlock[] | null }).blocks;
  return ocrPageText(
    blocks,
    pageNo,
    Math.round(vp.width * 100) / 100,
    Math.round(vp.height * 100) / 100,
    OCR_SCALE,
  );
}
