import type {
  DocText,
  EngineOptions,
  Extraction,
  PageText,
  Template,
  TemplateSet,
} from '@pdfx/engine';

export type WorkerRequest =
  | { id: number; type: 'read'; bytes: Uint8Array }
  | { id: number; type: 'process'; doc: DocText; sets: TemplateSet[]; opts: EngineOptions }
  /** Keeps one document's layout in the worker for repeated Mapper previews. */
  | { id: number; type: 'load'; key: string; pages: PageText[] }
  /** Extracts the loaded document with a draft template. */
  | { id: number; type: 'preview'; key: string; template: Template; opts: EngineOptions };

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
  | { id: number; type: 'load' }
  | { id: number; type: 'preview'; extraction: Extraction }
  | { id: number; type: 'error'; message: string; stack?: string };
