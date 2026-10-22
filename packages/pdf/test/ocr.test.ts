import { describe, expect, it } from 'vitest';
import { ocrToTokens, pagesNeedingOcr } from '../src';

describe('OCR conversion', () => {
  it('converts pixel boxes to points and confidence to 0..1, using the line height', () => {
    const toks = ocrToTokens(
      [
        {
          paragraphs: [
            {
              lines: [
                {
                  bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
                  words: [
                    { text: 'Total', confidence: 96, bbox: { x0: 300, y0: 90, x1: 360, y1: 120 } },
                    { text: 'no', confidence: 61.5, bbox: { x0: 370, y0: 100, x1: 390, y1: 120 } },
                    { text: ' ', confidence: 0, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
      1,
      3,
    );
    expect(toks).toEqual([
      { page: 1, text: 'Total', x0: 100, y0: 30, x1: 120, y1: 40, height: 10, conf: 0.96 },
      { page: 1, text: 'no', x0: 123.33, y0: 30, x1: 130, y1: 40, height: 10, conf: 0.62 },
    ]);
  });
  it('chooses pages for OCR', () => {
    const p = (n: number, k: number) => ({
      page: n,
      width: 1,
      height: 1,
      tokens: Array.from({ length: k }, () => ({
        page: n,
        text: 'x',
        x0: 0,
        y0: 0,
        x1: 1,
        y1: 1,
        height: 1,
        conf: 1,
      })),
    });
    expect(pagesNeedingOcr([p(1, 50), p(2, 3)], 'auto')).toEqual([2]);
    expect(pagesNeedingOcr([p(1, 50), p(2, 3)], 'always')).toEqual([1, 2]);
    expect(pagesNeedingOcr([p(1, 50), p(2, 3)], 'never')).toEqual([]);
  });
});
