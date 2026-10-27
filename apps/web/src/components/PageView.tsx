import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BBox, Token } from '@pdfx/engine';
import type { PdfDocument, PdfPage } from '@pdfx/pdf';
import { open, renderPage } from '../lib/pdfjs';
import { S } from '../strings';

export interface Mark {
  bbox: BBox;
  kind: 'field' | 'suggest' | 'table' | 'end' | 'error' | 'selected';
  label?: string;
  /** The field being edited: drawn with a stronger outline. */
  active?: boolean;
  tag?: 'accent' | 'warn';
}

/** The column breaks of a mapped table, edited on a ruler along its top. */
export interface Ruler {
  /** Top of the table on this page and its foot, in points. */
  y0: number;
  y1: number;
  /** Outer edges of the table, then the breaks between its columns, left to right. */
  x0: number;
  x1: number;
  breaks: number[];
  /** Column names, one more than the breaks. */
  names: string[];
  onAdd: (x: number) => void;
  /**
   * record: a new undo step (a drag records only its first move, so it undoes as one);
   * settle: the move is over, so the columns' types can be checked again.
   */
  onMove: (i: number, x: number, how: { record: boolean; settle: boolean }) => void;
  onRemove: (i: number) => void;
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
  ruler?: Ruler | undefined;
  /** A small panel drawn on the page under a line (above it near the page foot), from x. */
  overlay?: { bbox: BBox; x: number; node: ComponentChildren } | undefined;
  onToken?: (t: Token, shift: boolean) => void;
  /** Words inside a box dragged across the page. */
  onTokens?: (ts: Token[]) => void;
  /** The words a click on this word would take, highlighted on hover. */
  expand?: (t: Token) => Token[];
  onEscape?: () => void;
  /** Page Up and Page Down on the page: -1 or +1. */
  onPage?: (delta: number) => void;
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
    ruler,
    overlay,
    onToken,
    onTokens,
    expand,
    onEscape,
    focusBox,
  } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(
    null,
  );
  const [band, setBand] = useState<BBox | null>(null);
  const [hover, setHover] = useState<Token[]>([]);
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
    // Resizing re-renders; cancel the render still in flight for the old size.
    const r = renderPage(pdfPage, canvas.current, scale * ratio);
    r.promise.catch(() => undefined);
    return () => r.cancel();
  }, [pdfPage, scale]);

  useEffect(() => {
    if (!focusBox || !wrap.current || !size) return;
    const el = wrap.current;
    el.scrollTop = Math.max(0, focusBox[1] * scale - el.clientHeight / 3);
    el.scrollLeft = Math.max(0, focusBox[0] * scale - el.clientWidth / 3);
  }, [focusBox, scale, size]);

  const lines = useMemo(() => readingOrder(tokens), [tokens]);
  const flat = useMemo(() => lines.flat(), [lines]);
  useEffect(() => {
    setFocus(-1);
    setHover([]);
  }, [tokens]);

  /** Pointer position in PDF points. */
  const at = (e: PointerEvent) => {
    const r = pageBox.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const norm = (b: BBox): BBox => [
    Math.min(b[0], b[2]),
    Math.min(b[1], b[3]),
    Math.max(b[0], b[2]),
    Math.max(b[1], b[3]),
  ];
  const onDown = (e: PointerEvent) => {
    if (!onTokens || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.ruler, .page-pop')) return;
    const p = at(e);
    drag.current = { x: p.x, y: p.y, px: p.x, py: p.y, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    if (!d.moved) {
      if (Math.hypot(p.x - d.x, p.y - d.y) * scale < 6) return;
      d.moved = true;
      pageBox.current!.setPointerCapture(e.pointerId);
      setHover([]);
    }
    d.px = p.x;
    d.py = p.y;
    setBand([d.x, d.y, p.x, p.y]);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return setBand(null);
    const [x0, y0, x1, y1] = norm([d.x, d.y, d.px, d.py]);
    setBand(null);
    // A word counts when its centre is inside the box.
    const inside = flat.filter((t) => {
      const cx = (t.x0 + t.x1) / 2;
      const cy = (t.y0 + t.y1) / 2;
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    });
    if (inside.length) onTokens?.(inside);
  };

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
    if ((e.target as HTMLElement).closest('.page-pop, .ruler')) return;
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
    } else if ((e.key === 'PageDown' || e.key === 'PageUp') && props.onPage) {
      e.preventDefault();
      props.onPage(e.key === 'PageDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      onEscape?.();
    } else if (e.key === 'Home') {
      e.preventDefault();
      moveFocus(0);
    }
  };

  const pointing = useRef(false);
  const sel = new Set(selected);
  const hovered = new Set(hover);
  const focused = flat[focus];

  return (
    <div
      class="viewer"
      ref={wrap}
      tabIndex={0}
      role="group"
      aria-label={props.label ?? S.mapper.viewerLabel(page)}
      onKeyDown={onKey}
      onPointerDownCapture={() => {
        pointing.current = true;
      }}
      onFocus={() => {
        // Tabbing in starts at the first word. A click must not: moving there
        // scrolls the page out from under the pointer and the click is lost.
        const byPointer = pointing.current;
        pointing.current = false;
        if (!byPointer && focus < 0 && flat.length && onToken) moveFocus(0);
      }}
    >
      <div
        class="page-box"
        ref={pageBox}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
          setBand(null);
        }}
        style={size ? { width: `${size.w * scale}px`, height: `${size.h * scale}px` } : undefined}
      >
        <canvas ref={canvas} aria-hidden="true" />
        {onToken
          ? flat.map((t, i) => (
              <div
                key={i}
                class={`tok${sel.has(t) ? ' tok-selected' : ''}${hovered.has(t) ? ' tok-hover' : ''}${focused === t ? ' tok-focus' : ''}`}
                style={box([t.x0, t.y0, t.x1, t.y1])}
                aria-hidden="true"
                data-text={t.text}
                onMouseEnter={() => {
                  if (!drag.current?.moved) setHover(expand ? expand(t) : [t]);
                }}
                onMouseLeave={() => setHover([])}
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
            class={`mark mark-${m.kind === 'selected' ? 'field' : m.kind}${m.active ? ' mark-active' : ''}`}
            style={box(m.bbox)}
            aria-hidden="true"
          >
            {m.label ? (
              <span class={`tag mark-label${m.tag === 'warn' ? ' tag-warn' : ''}`}>{m.label}</span>
            ) : null}
          </div>
        ))}
        {band ? <div class="band" style={box(norm(band))} aria-hidden="true" /> : null}
        {ruler ? <RulerBar r={ruler} scale={scale} /> : null}
        {overlay && size ? (
          <div
            class={`page-pop${overlay.bbox[3] > size.h * 0.62 ? ' page-pop-above' : ''}`}
            style={{
              left: `${Math.max(4, Math.min(overlay.x * scale, size.w * scale - 344))}px`,
              top: `${(overlay.bbox[3] > size.h * 0.62 ? overlay.bbox[1] - 4 : overlay.bbox[3] + 4) * scale}px`,
            }}
          >
            {overlay.node}
          </div>
        ) : null}
      </div>
      <span class="sr-only" aria-live="polite">
        {spoken}
      </span>
    </div>
  );
}

/**
 * A ruler along the top of a table: click it to add a column break, drag a
 * break to move it, × to remove it. The lines down the table never block clicks.
 */
function RulerBar({ r, scale }: { r: Ruler; scale: number }) {
  const drag = useRef<{
    i: number;
    startX: number;
    startPt: number;
    at: number;
    moved: boolean;
  } | null>(null);
  const bar = useRef<HTMLButtonElement>(null);
  const edges = [r.x0, ...r.breaks, r.x1];
  const top = r.y0 * scale - 22;
  const round = (x: number) => Math.round(x * 100) / 100;
  return (
    <div
      class="ruler"
      style={{ left: `${r.x0 * scale}px`, top: `${top}px`, width: `${(r.x1 - r.x0) * scale}px` }}
    >
      <button
        type="button"
        ref={bar}
        class="ruler-bar"
        aria-label={S.mapper.ruler.add}
        title={S.mapper.ruler.add}
        onClick={(e) => {
          if (e.detail === 0) {
            // From the keyboard: split the widest column in the middle.
            let w = 0;
            for (let i = 0; i + 1 < edges.length; i++)
              if (edges[i + 1]! - edges[i]! > edges[w + 1]! - edges[w]!) w = i;
            r.onAdd(round((edges[w]! + edges[w + 1]!) / 2));
            return;
          }
          const box = bar.current!.getBoundingClientRect();
          r.onAdd(round(r.x0 + (e.clientX - box.left) / scale));
        }}
      />
      {r.names.map((n, i) => (
        <span
          key={`n${i}`}
          class="ruler-name"
          aria-hidden="true"
          style={{
            left: `${(edges[i]! - r.x0) * scale}px`,
            width: `${(edges[i + 1]! - edges[i]!) * scale}px`,
          }}
        >
          {n}
        </span>
      ))}
      {r.breaks.map((x, i) => (
        <div key={`b${i}`} class="break" style={{ left: `${(x - r.x0) * scale}px` }}>
          <div
            class="break-line"
            aria-hidden="true"
            style={{ height: `${Math.max(20, (r.y1 - r.y0) * scale + 22)}px` }}
          />
          <button
            type="button"
            class="break-handle"
            aria-label={S.mapper.ruler.handle(r.names[i] ?? '', r.names[i + 1] ?? '')}
            title={S.mapper.ruler.handleTitle}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowRight' ? 1 : -1);
                r.onMove(i, round(x + step), { record: true, settle: true });
              } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                r.onRemove(i);
              }
            }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { i, startX: e.clientX, startPt: x, at: x, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || (!d.moved && Math.abs(e.clientX - d.startX) < 2)) return;
              d.at = round(d.startPt + (e.clientX - d.startX) / scale);
              r.onMove(d.i, d.at, { record: !d.moved, settle: false });
              d.moved = true;
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (d?.moved) r.onMove(d.i, d.at, { record: false, settle: true });
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          />
          <button
            type="button"
            class="break-remove"
            aria-label={S.mapper.ruler.remove(r.names[i] ?? '', r.names[i + 1] ?? '')}
            title={S.mapper.ruler.removeTitle}
            onClick={() => r.onRemove(i)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
