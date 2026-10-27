import { describe, expect, it } from 'vitest';
import type { TableRule } from '@pdfx/engine';
import { lineRules, readPattern } from './rules';

describe('readPattern', () => {
  it('reads the patterns the Mapper writes', () => {
    expect(readPattern(String.raw`^Total for(?=\s|$)`)).toEqual({
      kind: 'startsWith',
      text: 'Total for',
    });
    expect(readPattern(String.raw`^Telephone\s+(.+)$`)).toEqual({
      kind: 'startsWith',
      text: 'Telephone',
    });
    expect(readPattern(String.raw`^Services and equipment rental$`)).toEqual({
      kind: 'exactly',
      text: 'Services and equipment rental',
    });
    expect(readPattern(String.raw`^Subtotal \(page\)$`)).toEqual({
      kind: 'exactly',
      text: 'Subtotal (page)',
    });
    expect(readPattern(String.raw`^[^a-z\d]+$`)).toEqual({ kind: 'capitals' });
    expect(readPattern(String.raw`^(?=.*[a-z])[^\d]+$`)).toEqual({ kind: 'words' });
    expect(readPattern(String.raw`Page \d+ of \d+$`)).toEqual({ kind: 'pageNumbers' });
  });

  it('shows anything else as the pattern', () => {
    expect(readPattern(String.raw`^\d{2}/\d{2}$`)).toEqual({
      kind: 'pattern',
      pattern: String.raw`^\d{2}/\d{2}$`,
    });
    expect(readPattern('^Card (\\d+)$')).toMatchObject({ kind: 'pattern' });
  });
});

describe('lineRules', () => {
  it('lists row start, headings, skipped lines and the end in order', () => {
    const t = {
      id: 't',
      name: 'Items',
      header: { labels: ['Item'] },
      columns: [{ name: 'Item', header: 'Item' }],
      rowStart: { column: 'Item', pattern: '\\S' },
      groups: [{ name: 'Telephone', pattern: String.raw`^Telephone\s+(.+)$`, capture: 1 }],
      skip: [String.raw`Page \d+ of \d+$`],
      end: { labels: ['Call details'] },
    } as TableRule;
    expect(lineRules(t).map((r) => `${r.kind}:${r.name ?? ''}:${r.match.kind}`)).toEqual([
      'row:Item:words',
      'heading:Telephone:startsWith',
      'skip::pageNumbers',
      'end::startsWith',
    ]);
  });
});
