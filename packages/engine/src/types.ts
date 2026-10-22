/** One word on a page. Points, origin top-left. */
export interface Token {
  page: number;
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  height: number;
  /** 1 for digital text; OCR word confidence / 100 for scanned text. */
  conf: number;
}

export interface PageText {
  page: number;
  width: number;
  height: number;
  tokens: Token[];
  /** True when the tokens came from OCR. */
  ocr?: boolean;
}

/** A whole document as tokens. */
export interface DocText {
  pages: PageText[];
}

export type BBox = [number, number, number, number];

export interface Line {
  page: number;
  tokens: Token[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Vertical centre. */
  cy: number;
  /** Raw text, tokens joined with single spaces. */
  text: string;
  /** Index of the line on its page (top to bottom). */
  index: number;
}

export interface Phrase {
  page: number;
  line: number;
  tokens: Token[];
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DocLayout {
  pages: { page: number; width: number; height: number; lines: Line[]; ocr: boolean }[];
}
