import type { DocText, EngineOptions, Extraction, PageText, TemplateSet } from '@pdfx/engine';

export type WorkerRequest =
  | { id: number; type: 'read'; bytes: Uint8Array }
  | { id: number; type: 'process'; doc: DocText; sets: TemplateSet[]; opts: EngineOptions };

export type WorkerResponse =
  | { id: number; type: 'read'; ok: true; pages: PageText[] }
  | {
      id: number;
      type: 'read';
      ok: false;
      code: 'password_protected' | 'unreadable';
      message: string;
      detail: string;
    }
  | { id: number; type: 'process'; extraction: Extraction }
  | { id: number; type: 'error'; message: string };
