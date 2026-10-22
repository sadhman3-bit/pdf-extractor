// Node entry: uses the pdf.js legacy build (tests, fixture tools, future unattended runner).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdf, openPdf, type PdfjsLib, type OpenOptions } from './read';

export * from './index';

const lib = pdfjs as unknown as PdfjsLib;

export function readPdfNode(data: Uint8Array, opts: OpenOptions = {}) {
  return readPdf(lib, data, opts);
}

export function openPdfNode(data: Uint8Array, opts: OpenOptions = {}) {
  return openPdf(lib, data, opts);
}
