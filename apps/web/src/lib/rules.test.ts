import { describe, expect, it } from 'vitest';
import type { TableRule } from '@pdfx/engine';
import {
  headingRule,
  lineRules,
  readPattern,
  readRowStart,
  rowStartPattern,
  skipPattern,
  type LinePattern,
} from './rules';

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

describe('writing patterns from plain choices', () => {
  it('writes what readPattern reads back', () => {
    const choices: LinePattern[] = [
      { kind: 'startsWith', text: 'Total for' },
      { kind: 'exactly', text: 'Subtotal (page)' },
      { kind: 'capitals' },
      { kind: 'words' },
      { kind: 'pageNumbers' },
    ];
    for (const c of choices) expect(readPattern(skipPattern(c))).toEqual(c);
    expect(skipPattern({ kind: 'startsWith', text: 'Total for' })).toBe(
      String.raw`^Total for(?=\s|$)`,
    );
  });

  it('writes headings that copy the rest of the line, or a line on its own', () => {
    const h = headingRule('Telephone', { kind: 'startsWith', text: 'Telephone' });
    expect(h).toEqual({ name: 'Telephone', pattern: String.raw`^Telephone\s+(.+)$`, capture: 1 });
    expect(new RegExp(h.pattern).exec('Telephone 02 5550 0160')?.[1]).toBe('02 5550 0160');
    expect(headingRule('Company', { kind: 'capitals' })).toMatchObject({ lone: true });
  });

  it('reads and writes row starts as any text, a shape, or a start', () => {
    expect(readRowStart('\\S')).toEqual({ kind: 'any' });
    const date = String.raw`^\d{2}/\d{2}/\d{4}$`;
    expect(readRowStart(date)).toEqual({ kind: 'shape', example: '99/99/9999' });
    expect(rowStartPattern({ kind: 'shape', example: '99/99/9999' })).toBe(date);
    expect(readRowStart('^SVC')).toEqual({ kind: 'startsWith', text: 'SVC' });
    expect(rowStartPattern({ kind: 'startsWith', text: 'SVC' })).toBe('^SVC');
    expect(readRowStart('^(a|b)')).toEqual({ kind: 'pattern', pattern: '^(a|b)' });
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
