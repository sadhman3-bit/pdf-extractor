import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BBox, Token } from '@pdfx/engine';
import type { PdfDocument, PdfPage } from '@pdfx/pdf';
import { open, renderPage } from '../lib/pdfjs';
import { S } from '../strings';

export interface Mark {
  bbox: BBox;
  kind: 'field' | 'suggest' | 'table' | 'end' | 'error' | 'selected';
  label?: string;
  tag?: 'accent' | 'warn';
}

export interface Divider {
  x: number;
  label: string;
  y0: number;
  y1: number;
  onMove: (x: number) => void;
}

export type Zoom = 'fit' | 1 | 1.5;

/** Opens a PDF once per byte array. */
export function usePdf(bytes: Uint8Array | null) {
  const [state, setState] = useState<{
    doc: PdfDocument | null;
    pages: number;
    error: string | null;
  }>({ doc: null, pages: 0, error: null });
  useEffect(() => {
    if (!bytes) {
      setState({ doc: null, pages: 0, error: null });
      return;
    }
    let close: (() => Promise<void>) | null = null;
    let cancelled = false;
    void open(bytes).then((o) => {
      if (!o.ok) {
        if (!cancelled) setState({ doc: null, pages: 0, error: o.message });
        return;
      }
      close = o.close;
      if (cancelled) void o.close();
      else setState({ doc: o.doc, pages: o.doc.numPages, error: null });
    });
    return () => {
      cancelled = true;
      // Drop the document before closing it so no viewer keeps using it.
      setState({ doc: null, pages: 0, error: null });
      if (close) void close();
    };
  }, [bytes]);
  return state;
}

const PT = 96 / 72;

/** Tokens in reading order: lines top to bottom, left to right. */
function readingOrder(tokens: Token[]): Token[][] {
  const sorted = [...tokens].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const lines: Token[][] = [];
  for (const t of sorted) {
    const last = lines[lines.length - 1];
    const c = (t.y0 + t.y1) / 2;
    if (
      last &&
      Math.abs((last[0]!.y0 + last[0]!.y1) / 2 - c) <= 0.45 * Math.min(last[0]!.height, t.height)
    )
      last.push(t);
    else lines.push([t]);
  }
  return lines.map((l) => l.sort((a, b) => a.x0 - b.x0));
}

export function PageView(props: {
  doc: PdfDocument;
  page: number;
  zoom: Zoom;
  tokens?: Token[];
  marks?: Mark[];
  selected?: Token[];
  dividers?: Divider[];
  onToken?: (t: Token, shift: boolean) => void;
  onEscape?: () => void;
  /** Scroll this box into view after rendering. */
  focusBox?: BBox | null;
  label?: string;
}) {
  const {
    doc,
    page,
    zoom,
    tokens = [],
    marks = [],
    selected = [],
    dividers = [],
    onToken,
    onEscape,
    focusBox,
  } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [pdfPage, setPdfPage] = useState<PdfPage | null>(null);
  const [focus, setFocus] = useState<number>(-1);
  const [spoken, setSpoken] = useState('');

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    // getPage throws synchronously on a document that has just been closed.
    void Promise.resolve()
      .then(() => doc.getPage(page))
      .then((p) => {
        if (!alive) return;
        const vp = p.getViewport({ scale: 1 });
        setSize({ w: vp.width, h: vp.height });
        setPdfPage(p);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [doc, page]);

  const scale = zoom === 'fit' ? Math.max(0.3, (width - 34) / (size?.w ?? 595)) : zoom * PT;

  useEffect(() => {
    if (!pdfPage || !canvas.current) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    void renderPage(pdfPage, canvas.current, scale * ratio).catch(() => undefined);
  }, [pdfPage, scale]);

  useEffect(() => {
    if (!focusBox || !wrap.current || !size) return;
    const el = wrap.current;
    el.scrollTop = Math.max(0, focusBox[1] * scale - el.clientHeight / 3);
    el.scrollLeft = Math.max(0, focusBox[0] * scale - el.clientWidth / 3);
  }, [focusBox, scale, size]);

  const lines = useMemo(() => readingOrder(tokens), [tokens]);
  const flat = useMemo(() => lines.flat(), [lines]);
  useEffect(() => setFocus(-1), [tokens]);

  const box = (b: BBox) => ({
    left: `${b[0] * scale}px`,
    top: `${b[1] * scale}px`,
    width: `${Math.max(2, (b[2] - b[0]) * scale)}px`,
    height: `${Math.max(2, (b[3] - b[1]) * scale)}px`,
  });

  const moveFocus = (i: number) => {
    const t = flat[i];
    if (!t) return;
    setFocus(i);
    setSpoken(S.mapper.tokenLabel(t.text));
    const el = wrap.current;
    if (el) {
      const y = t.y0 * scale;
      if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - 40)
        el.scrollTop = Math.max(0, y - el.clientHeight / 3);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (!onToken || !flat.length) return;
    const cur = flat[focus];
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      moveFocus(
        focus < 0
          ? 0
          : Math.max(0, Math.min(flat.length - 1, focus + (e.key === 'ArrowRight' ? 1 : -1))),
      );
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!cur) return moveFocus(0);
      const li = lines.findIndex((l) => l.includes(cur));
      const target = lines[li + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!target) return;
      const x = (cur.x0 + cur.x1) / 2;
      const best = target.reduce((a, b) =>
        Math.abs((b.x0 + b.x1) / 2 - x) < Math.abs((a.x0 + a.x1) / 2 - x) ? b : a,
      );
      moveFocus(flat.indexOf(best));
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (cur) {
        e.preventDefault();
        onToken(cur, e.shiftKey);
      }
    } else if (e.key === 'Escape') {
      onEscape?.();
    } else if (e.key === 'Home') {
      e.preventDefault();
      moveFocus(0);
    }
  };

  const sel = new Set(selected);
  const focused = flat[focus];

  return (
    <div
      class="viewer"
      ref={wrap}
      tabIndex={0}
      role="group"
      aria-label={props.label ?? S.mapper.viewerLabel(page)}
      onKeyDown={onKey}
      onFocus={() => {
        if (focus < 0 && flat.length && onToken) moveFocus(0);
      }}
    >
      <div
        class="page-box"
        style={size ? { width: `${size.w * scale}px`, height: `${size.h * scale}px` } : undefined}
      >
        <canvas ref={canvas} aria-hidden="true" />
        {onToken
          ? flat.map((t, i) => (
              <div
                key={i}
                class={`tok${sel.has(t) ? ' tok-selected' : ''}${focused === t ? ' tok-focus' : ''}`}
                style={box([t.x0, t.y0, t.x1, t.y1])}
                aria-hidden="true"
                data-text={t.text}
                onClick={(e) => {
                  setFocus(i);
                  onToken(t, (e as MouseEvent).shiftKey);
                }}
              />
            ))
          : null}
        {marks.map((m, i) => (
          <div
            key={`m${i}`}
            class={`mark mark-${m.kind === 'selected' ? 'field' : m.kind}`}
            style={box(m.bbox)}
            aria-hidden="true"
          >
            {m.label ? (
              <span class={`tag mark-label${m.tag === 'warn' ? ' tag-warn' : ''}`}>{m.label}</span>
            ) : null}
          </div>
        ))}
        {dividers.map((d, i) => (
          <DividerHandle key={`d${i}`} d={d} scale={scale} />
        ))}
      </div>
      <span class="sr-only" aria-live="polite">
        {spoken}
      </span>
    </div>
  );
}

function DividerHandle({ d, scale }: { d: Divider; scale: number }) {
  const drag = useRef<{ startX: number; startPt: number } | null>(null);
  return (
    <button
      type="button"
      class="divider-handle"
      aria-label={d.label}
      style={{
        left: `${d.x * scale}px`,
        top: `${d.y0 * scale}px`,
        height: `${Math.max(20, (d.y1 - d.y0) * scale)}px`,
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          d.onMove(Math.round((d.x + (e.key === 'ArrowRight' ? 2 : -2)) * 100) / 100);
        }
      }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startPt: d.x };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        d.onMove(
          Math.round((drag.current.startPt + (e.clientX - drag.current.startX) / scale) * 100) /
            100,
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    />
  );
}
