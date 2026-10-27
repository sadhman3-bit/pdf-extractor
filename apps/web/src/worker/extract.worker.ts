/// <reference lib="webworker" />
// Dedicated worker: reads PDF text with pdf.js and runs the engine, so the
// interface stays responsive.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readPdf, type PdfjsLib } from '@pdfx/pdf';
import {
  buildLayout,
  extractWith,
  processDocument,
  type DocLayout,
  type DocText,
  type EngineOptions,
  type Template,
  type TemplateSet,
} from '@pdfx/engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const BASE = import.meta.env.BASE_URL;
const OPTIONS = {
  wasmUrl: `${BASE}vendor/pdfjs/wasm/`,
  standardFontDataUrl: `${BASE}vendor/pdfjs/standard_fonts/`,
  cMapUrl: `${BASE}vendor/pdfjs/cmaps/`,
  cMapPacked: true,
  // pdf.js reads document.baseURI to decide this unless it is set; workers have no document.
  useWorkerFetch: false,
};

const scope = self as unknown as DedicatedWorkerGlobalScope;
// The Mapper's sample, laid out once and reused for every preview.
let loaded: { key: string; layout: DocLayout } | null = null;

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  let reply: WorkerResponse;
  try {
    if (msg.type === 'read') {
      const r = await readPdf(pdfjs as unknown as PdfjsLib, msg.bytes, { extra: OPTIONS });
      reply = r.ok
        ? { id: msg.id, type: 'read', ok: true, pages: r.pages }
        : {
            id: msg.id,
            type: 'read',
            ok: false,
            code: r.code,
            message: r.message,
            detail: r.detail ?? '',
          };
    } else if (msg.type === 'load') {
      loaded = { key: msg.key, layout: buildLayout({ pages: msg.pages }) };
      reply = { id: msg.id, type: 'load' };
    } else if (msg.type === 'preview') {
      if (loaded?.key !== msg.key) throw new Error('The sample is not loaded in the worker');
      reply = {
        id: msg.id,
        type: 'preview',
        extraction: extractWith(loaded.layout, msg.template as Template, msg.opts as EngineOptions),
      };
    } else {
      reply = {
        id: msg.id,
        type: 'process',
        extraction: processDocument(
          msg.doc as DocText,
          msg.sets as TemplateSet[],
          msg.opts as EngineOptions,
        ),
      };
    }
  } catch (err) {
    reply = {
      id: msg.id,
      type: 'error',
      message: String((err as Error)?.message ?? err),
      stack: String((err as Error)?.stack ?? ''),
    };
  }
  scope.postMessage(reply);
};
