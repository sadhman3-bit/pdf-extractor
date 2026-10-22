import type { Token } from '@pdfx/engine';

export type Matrix = [number, number, number, number, number, number];

export function mul(m1: readonly number[], m2: readonly number[]): Matrix {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

export interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height?: number;
}

/** Width weight of one character when sharing an item's width between its words. */
const charWeight = (ch: string) => (/\s/.test(ch) ? 0.5 : 1);

/**
 * Converts pdf.js text items to word tokens in page coordinates (points, top-left
 * origin) using the viewport transform, so rotated pages come out upright.
 */
export function itemsToTokens(
  items: RawItem[],
  viewportTransform: readonly number[],
  scale: number,
  page: number,
): Token[] {
  const out: Token[] = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const tx = mul(viewportTransform, item.transform);
    const h = Math.hypot(tx[2], tx[3]);
    if (h <= 0) continue;
    const len = item.width * scale;
    const dirX = tx[0];
    const dirY = tx[1];
    const dn = Math.hypot(dirX, dirY) || 1;
    const ux = dirX / dn;
    const uy = dirY / dn;
    // Unit "up" vector in display space (y grows downward).
    const vx = uy;
    const vy = -ux;
    const chars = [...item.str];
    const total = chars.reduce((s, c) => s + charWeight(c), 0) || 1;
    let acc = 0;
    let word = '';
    let wordStart = 0;
    const flush = (endAcc: number) => {
      if (!word) return;
      const a = (wordStart / total) * len;
      const b = (endAcc / total) * len;
      const sx = tx[4] + ux * a;
      const sy = tx[5] + uy * a;
      const ex = tx[4] + ux * b;
      const ey = tx[5] + uy * b;
      const pts = [
        [sx - vx * 0.2 * h, sy - vy * 0.2 * h],
        [ex - vx * 0.2 * h, ey - vy * 0.2 * h],
        [sx + vx * 0.8 * h, sy + vy * 0.8 * h],
        [ex + vx * 0.8 * h, ey + vy * 0.8 * h],
      ];
      const xs = pts.map((p) => p[0]!);
      const ys = pts.map((p) => p[1]!);
      out.push({
        page,
        text: word,
        x0: round(Math.min(...xs)),
        y0: round(Math.min(...ys)),
        x1: round(Math.max(...xs)),
        y1: round(Math.max(...ys)),
        height: round(h),
        conf: 1,
      });
      word = '';
    };
    for (const ch of chars) {
      if (/\s/.test(ch)) {
        flush(acc);
        acc += charWeight(ch);
        wordStart = acc;
      } else {
        if (!word) wordStart = acc;
        word += ch;
        acc += charWeight(ch);
      }
    }
    flush(acc);
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
