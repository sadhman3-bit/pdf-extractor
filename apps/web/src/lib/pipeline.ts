// Extraction pipeline on the main thread: text via the worker, OCR for pages
// without text, then the engine in the worker.
import {
  errorExtraction,
  latest,
  type EngineOptions,
  type Extraction,
  type PageText,
  type Template,
  type TemplateSet,
} from '@pdfx/engine';
import { pagesNeedingOcr } from '@pdfx/pdf';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';
import { open } from './pdfjs';
import { ocrPage } from './ocr';
import { S } from '../strings';

/** The worker couldn't start: usually this tab still runs a version the site has replaced. */
export class WorkerGone extends Error {
  override name = 'WorkerGone';
  constructor(detail: string) {
    super(S.update.workerGone);
    this.stack = detail;
  }
}

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../worker/extract.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.type === 'error') {
        const err = new Error(e.data.message);
        if (e.data.stack) err.stack = e.data.stack;
        p.reject(err);
      } else p.resolve(e.data);
    };
    worker.onerror = (e) => {
      for (const p of pending.values())
        p.reject(
          e.message ? new Error(e.message) : new WorkerGone('The extraction worker stopped'),
        );
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

type Req = WorkerRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

function call(req: Req): Promise<WorkerResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const msg = { ...req, id } as WorkerRequest;
    if (msg.type === 'read') {
      const copy = msg.bytes.slice();
      getWorker().postMessage({ ...msg, bytes: copy }, [copy.buffer]);
    } else getWorker().postMessage(msg);
  });
}

export async function readText(bytes: Uint8Array) {
  const r = await call({ type: 'read', bytes });
  if (r.type !== 'read') throw new Error('Unexpected reply');
  return r;
}

export async function runEngine(
  pages: PageText[],
  sets: TemplateSet[],
  opts: EngineOptions,
): Promise<Extraction> {
  const r = await call({ type: 'process', doc: { pages }, sets, opts });
  if (r.type !== 'process') throw new Error('Unexpected reply');
  return r.extraction;
}

/** Keeps a document's layout in the worker under `key`, for `previewIn`. */
export async function loadForPreview(key: string, pages: PageText[]): Promise<void> {
  await call({ type: 'load', key, pages });
}

/** Extracts the document loaded under `key` with a draft template, in the worker. */
export async function previewIn(
  key: string,
  template: Template,
  opts: EngineOptions,
): Promise<Extraction> {
  const r = await call({ type: 'preview', key, template, opts });
  if (r.type !== 'preview') throw new Error('Unexpected reply');
  return r.extraction;
}

export interface Progress {
  ocrPage?: number;
  ocrPages?: number;
}

/** OCRs the given pages and returns the page list with those pages replaced. */
export async function ocrPages(
  bytes: Uint8Array,
  pages: PageText[],
  which: number[],
  onProgress?: (p: Progress) => void,
): Promise<PageText[]> {
  if (!which.length) return pages;
  const o = await open(bytes);
  if (!o.ok) return pages;
  try {
    const out = [...pages];
    for (let i = 0; i < which.length; i++) {
      const n = which[i]!;
      onProgress?.({ ocrPage: i + 1, ocrPages: which.length });
      const page = await o.doc.getPage(n);
      out[n - 1] = await ocrPage(page, n);
    }
    return out;
  } finally {
    await o.close();
  }
}

/** Text for every page, OCR where needed. */
export async function documentText(
  bytes: Uint8Array,
  mode: 'auto' | 'always' | 'never' = 'auto',
  onProgress?: (p: Progress) => void,
): Promise<
  | { ok: true; pages: PageText[] }
  | { ok: false; code: 'password_protected' | 'unreadable'; message: string }
> {
  const r = await readText(bytes);
  if (!r.ok) return r;
  return {
    ok: true,
    pages: await ocrPages(bytes, r.pages, pagesNeedingOcr(r.pages, mode), onProgress),
  };
}

/** Full extraction of one PDF against the given templates. */
export async function extractBytes(
  bytes: Uint8Array,
  sets: TemplateSet[],
  opts: EngineOptions,
  onProgress?: (p: Progress) => void,
): Promise<Extraction> {
  const r = await readText(bytes);
  if (!r.ok) return errorExtraction(r.code, r.message);
  let pages = r.pages;
  const need = pagesNeedingOcr(pages, 'auto');
  if (need.length) {
    // A template that matched on the text pages may say OCR is never wanted.
    const first = need.length < pages.length ? await runEngine(pages, sets, opts) : null;
    const t = first?.template ? sets.find((s) => s.id === first.template!.id) : undefined;
    const mode = t ? (latest(t).settings?.ocr ?? 'auto') : 'auto';
    if (mode !== 'never') pages = await ocrPages(bytes, pages, need, onProgress);
  }
  let ex = await runEngine(pages, sets, opts);
  const t = ex.template ? sets.find((s) => s.id === ex.template!.id) : undefined;
  if (t && latest(t).settings?.ocr === 'always') {
    const rest = pages.filter((p) => !p.ocr).map((p) => p.page);
    if (rest.length) {
      pages = await ocrPages(bytes, pages, rest, onProgress);
      ex = await runEngine(pages, sets, opts);
    }
  }
  return ex;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
