import type { DocLayout, DocText, Line, Phrase, Token } from './types';
import { TOLERANCES } from './tolerances';
import { normalize } from './normalize';

/** Groups tokens into lines (top to bottom), each sorted left to right. */
export function buildLines(tokens: Token[]): Line[] {
  const sorted = [...tokens].sort((a, b) => cy(a) - cy(b) || a.x0 - b.x0);
  const groups: { tokens: Token[]; cy: number; minH: number }[] = [];
  for (const t of sorted) {
    const c = cy(t);
    const g = groups[groups.length - 1];
    if (g && Math.abs(c - g.cy) <= TOLERANCES.lineCentre * Math.min(t.height, g.minH)) {
      g.tokens.push(t);
      g.cy = g.tokens.reduce((s, x) => s + cy(x), 0) / g.tokens.length;
      g.minH = Math.min(g.minH, t.height);
    } else {
      groups.push({ tokens: [t], cy: c, minH: t.height });
    }
  }
  return groups.map((g, index) => {
    const toks = g.tokens.sort((a, b) => a.x0 - b.x0);
    return {
      page: toks[0]!.page,
      tokens: toks,
      x0: Math.min(...toks.map((t) => t.x0)),
      y0: Math.min(...toks.map((t) => t.y0)),
      x1: Math.max(...toks.map((t) => t.x1)),
      y1: Math.max(...toks.map((t) => t.y1)),
      cy: g.cy,
      text: toks.map((t) => t.text).join(' '),
      index,
    };
  });
}

export const cy = (t: { y0: number; y1: number }) => (t.y0 + t.y1) / 2;
export const cx = (t: { x0: number; x1: number }) => (t.x0 + t.x1) / 2;

/** Splits a line into phrases: runs of tokens separated by about one space. */
export function phrases(line: Line): Phrase[] {
  const out: Phrase[] = [];
  let cur: Token[] = [];
  const push = () => {
    if (!cur.length) return;
    out.push(makePhrase(line, cur));
    cur = [];
  };
  for (const t of line.tokens) {
    const prev = cur[cur.length - 1];
    if (prev && t.x0 - prev.x1 > TOLERANCES.phraseGap * Math.min(prev.height, t.height)) push();
    cur.push(t);
  }
  push();
  return out;
}

export function makePhrase(line: { page: number; index: number }, tokens: Token[]): Phrase {
  return {
    page: line.page,
    line: line.index,
    tokens,
    text: tokens.map((t) => t.text).join(' '),
    x0: Math.min(...tokens.map((t) => t.x0)),
    y0: Math.min(...tokens.map((t) => t.y0)),
    x1: Math.max(...tokens.map((t) => t.x1)),
    y1: Math.max(...tokens.map((t) => t.y1)),
  };
}

export function buildLayout(doc: DocText): DocLayout {
  return {
    pages: doc.pages.map((p) => ({
      page: p.page,
      width: p.width,
      height: p.height,
      lines: buildLines(p.tokens),
      ocr: !!p.ocr,
    })),
  };
}

/** Normalised text of a page, one line per row. */
export function pageNormText(lines: Line[]): string {
  return lines.map((l) => normalize(l.text)).join('\n');
}

export function bboxOf(
  tokens: { x0: number; y0: number; x1: number; y1: number }[],
): [number, number, number, number] {
  return [
    r2(Math.min(...tokens.map((t) => t.x0))),
    r2(Math.min(...tokens.map((t) => t.y0))),
    r2(Math.max(...tokens.map((t) => t.x1))),
    r2(Math.max(...tokens.map((t) => t.y1))),
  ];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const furnitureCache = new WeakMap<DocLayout, Set<Line>>();

/**
 * Page headers and footers: lines near the top or bottom of the page whose text
 * (numbers aside) repeats at the same height on most pages. Tables ignore them.
 */
export function furnitureLines(layout: DocLayout): Set<Line> {
  const cached = furnitureCache.get(layout);
  if (cached) return cached;
  const out = new Set<Line>();
  const n = layout.pages.length;
  if (n >= 3) {
    const byKey = new Map<string, Line[]>();
    for (const p of layout.pages) {
      const m = p.height * TOLERANCES.furnitureMargin;
      for (const l of p.lines) {
        if (l.cy > m && l.cy < p.height - m) continue;
        const key = `${Math.round(l.cy / 3)}|${l.text.replace(/\d+/g, '#')}`;
        const arr = byKey.get(key) ?? [];
        if (arr[arr.length - 1]?.page !== l.page) arr.push(l);
        byKey.set(key, arr);
      }
    }
    const need = Math.max(3, Math.ceil(n * TOLERANCES.furniturePages));
    for (const ls of byKey.values()) if (ls.length >= need) ls.forEach((l) => out.add(l));
  }
  furnitureCache.set(layout, out);
  return out;
}
