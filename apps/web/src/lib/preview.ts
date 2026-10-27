// Live extraction of the Mapper's sample. Small documents run on the main thread
// so the page updates at once; long ones run in the worker, debounced, and only
// the newest result is kept.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  extractWith,
  type DocLayout,
  type Extraction,
  type PageText,
  type Template,
} from '@pdfx/engine';
import { loadForPreview, previewIn } from './pipeline';
import { testHooks } from '../app/testing';

/** Above this many words, previews run in the worker. */
export const WORKER_WORDS = 20000;
const DEBOUNCE_MS = 150;

let nextKey = 1;

export function usePreview(
  pages: PageText[] | null,
  layout: DocLayout | null,
  draft: Template | null,
  confidenceThreshold: number,
): {
  result: Extraction | null;
  /** The template `result` was extracted with (it may trail the draft by one edit). */
  basis: Template | null;
  busy: boolean;
} {
  const words = useMemo(() => (pages ?? []).reduce((n, p) => n + p.tokens.length, 0), [pages]);
  const inWorker = words > (testHooks()?.previewWorkerWords ?? WORKER_WORDS);
  const key = useMemo(() => (pages && inWorker ? `doc${nextKey++}` : null), [pages, inWorker]);
  const loaded = useRef<Promise<void> | null>(null);
  const seq = useRef(0);
  const [late, setLate] = useState<{ result: Extraction; key: string; basis: Template } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  // Small documents: straight away.
  const now = useMemo(() => {
    if (inWorker || !layout || !draft) return null;
    try {
      return extractWith(layout, draft, { confidenceThreshold });
    } catch {
      return null;
    }
  }, [inWorker, layout, draft, confidenceThreshold]);

  useEffect(() => {
    loaded.current = key && pages ? loadForPreview(key, pages) : null;
  }, [key, pages]);

  useEffect(() => {
    if (!inWorker || !key || !draft) return;
    const mine = ++seq.current;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        await loaded.current;
        const result = await previewIn(key, draft, { confidenceThreshold });
        if (mine === seq.current) setLate({ result, key, basis: draft });
      } catch {
        /* a failed preview keeps the last good one */
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [inWorker, key, draft, confidenceThreshold]);

  if (!inWorker) return { result: now, basis: now ? draft : null, busy: false };
  return late && late.key === key
    ? { result: late.result, basis: late.basis, busy }
    : { result: null, basis: null, busy };
}
