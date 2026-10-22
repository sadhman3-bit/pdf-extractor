import type { PageText } from '@pdfx/engine';
import { itemsToTokens, type RawItem } from './tokens';

/** The subset of pdf.js we use, so browser and Node builds can both be passed in. */
export interface PdfjsLib {
  getDocument(src: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
}

export interface PdfViewport {
  width: number;
  height: number;
  scale: number;
  transform: number[];
}

export interface PdfPage {
  getViewport(o: { scale: number; rotation?: number }): PdfViewport;
  getTextContent(o?: Record<string, unknown>): Promise<{ items: unknown[] }>;
  render(o: Record<string, unknown>): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
}

export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}

export type OpenFailure = {
  ok: false;
  code: 'password_protected' | 'unreadable';
  message: string;
  detail?: string;
};
export type OpenResult = { ok: true; doc: PdfDocument; close(): Promise<void> } | OpenFailure;

export interface OpenOptions {
  /** Extra getDocument options (worker, wasmUrl, standardFontDataUrl, cMapUrl …). */
  extra?: Record<string, unknown>;
}

export async function openPdf(
  pdfjs: PdfjsLib,
  data: Uint8Array,
  opts: OpenOptions = {},
): Promise<OpenResult> {
  // pdf.js takes ownership of (detaches) the buffer, so give it a copy.
  const copy = data.slice();
  const task = pdfjs.getDocument({
    data: copy,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
    ...opts.extra,
  });
  try {
    const doc = await task.promise;
    if (!doc.numPages) {
      await task.destroy();
      return { ok: false, code: 'unreadable', message: 'This PDF has no pages.' };
    }
    return { ok: true, doc, close: () => task.destroy() };
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const name = (e as { name?: string })?.name ?? '';
    const detail = String((e as Error)?.message ?? e);
    if (name === 'PasswordException') {
      return {
        ok: false,
        code: 'password_protected',
        message: 'This PDF is password protected.',
        detail,
      };
    }
    return {
      ok: false,
      code: 'unreadable',
      message: 'This PDF can’t be read. It may be damaged or not a real PDF.',
      detail,
    };
  }
}

export async function pageText(doc: PdfDocument, n: number): Promise<PageText> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = (content.items as RawItem[]).filter((i) => typeof i.str === 'string');
  const tokens = itemsToTokens(items, vp.transform, vp.scale, n);
  page.cleanup();
  return { page: n, width: round(vp.width), height: round(vp.height), tokens };
}

export interface ReadResult {
  ok: true;
  pages: PageText[];
}

/** Opens a PDF and reads every page's text layer. */
export async function readPdf(
  pdfjs: PdfjsLib,
  data: Uint8Array,
  opts: OpenOptions = {},
): Promise<ReadResult | OpenFailure> {
  const opened = await openPdf(pdfjs, data, opts);
  if (!opened.ok) return opened;
  try {
    const pages: PageText[] = [];
    for (let i = 1; i <= opened.doc.numPages; i++) pages.push(await pageText(opened.doc, i));
    return { ok: true, pages };
  } catch (e) {
    return {
      ok: false,
      code: 'unreadable',
      message: 'This PDF can’t be read. It may be damaged or not a real PDF.',
      detail: String((e as Error)?.message ?? e),
    };
  } finally {
    await opened.close();
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
