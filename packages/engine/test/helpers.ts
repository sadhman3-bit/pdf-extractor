import type { DocText, Token } from '../src';

/** A token with Helvetica-ish width (0.5 em per character). y is the baseline. */
export function tok(text: string, x: number, y: number, size = 10, page = 1, conf = 1): Token {
  const w = text.length * size * 0.5;
  return {
    page,
    text,
    x0: x,
    y0: y - size * 0.8,
    x1: x + w,
    y1: y + size * 0.2,
    height: size,
    conf,
  };
}

/** Lays out a string's words with single spaces from x. */
export function words(text: string, x: number, y: number, size = 10, page = 1, conf = 1): Token[] {
  const out: Token[] = [];
  let cx = x;
  for (const w of text.split(' ')) {
    const t = tok(w, cx, y, size, page, conf);
    out.push(t);
    cx = t.x1 + size * 0.28;
  }
  return out;
}

export function doc(...pages: Token[][]): DocText {
  return {
    pages: pages.map((tokens, i) => ({
      page: i + 1,
      width: 595,
      height: 842,
      tokens: tokens.map((t) => ({ ...t, page: i + 1 })),
    })),
  };
}
