import type { PageText, Token } from '@pdfx/engine';

/** The parts of a tesseract.js result we read (blocks → paragraphs → lines → words). */
export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBox;
}
export interface OcrLine {
  bbox: OcrBox;
  words: OcrWord[];
}
export interface OcrBlock {
  paragraphs: { lines: OcrLine[] }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Converts OCR word boxes (pixels at `scale` × points) to tokens in points.
 * Each word takes its line's vertical extent so words of one line stay on one
 * line even when their letters differ in height.
 */
export function ocrToTokens(
  blocks: OcrBlock[] | null | undefined,
  page: number,
  scale: number,
): Token[] {
  const out: Token[] = [];
  for (const b of blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const line of p.lines ?? []) {
        const words = (line.words ?? []).filter((w) => w.text && w.text.trim());
        if (!words.length) continue;
        const y0 = Math.min(...words.map((w) => w.bbox.y0));
        const y1 = Math.max(...words.map((w) => w.bbox.y1));
        for (const w of words) {
          out.push({
            page,
            text: w.text.trim(),
            x0: r2(w.bbox.x0 / scale),
            y0: r2(y0 / scale),
            x1: r2(w.bbox.x1 / scale),
            y1: r2(y1 / scale),
            height: r2((y1 - y0) / scale),
            conf: Math.max(0, Math.min(1, r2(w.confidence / 100))),
          });
        }
      }
    }
  }
  return out;
}

export function ocrPageText(
  blocks: OcrBlock[] | null | undefined,
  page: number,
  width: number,
  height: number,
  scale: number,
): PageText {
  return { page, width, height, tokens: ocrToTokens(blocks, page, scale), ocr: true };
}

/** Pages that need OCR: fewer than `min` text tokens, or every page when the setting is "always". */
export function pagesNeedingOcr(
  pages: PageText[],
  mode: 'auto' | 'always' | 'never',
  min = 10,
): number[] {
  if (mode === 'never') return [];
  if (mode === 'always') return pages.map((p) => p.page);
  return pages.filter((p) => p.tokens.length < min).map((p) => p.page);
}
