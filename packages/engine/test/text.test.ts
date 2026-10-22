import { describe, expect, it } from 'vitest';
import { normalize, normTokens, buildLines, phrases, buildLayout, TOLERANCES } from '../src';
import { tok, words, doc } from './helpers';

describe('normalize', () => {
  it('lower-cases, collapses whitespace and strips trailing : # .', () => {
    expect(normalize('  Total   GST:  ')).toBe('total gst');
    expect(normalize('Invoice No.')).toBe('invoice no');
    expect(normalize('Ref #')).toBe('ref');
    expect(normalize('PO No.:')).toBe('po no');
  });
  it('maps curly quotes and dashes', () => {
    expect(normalize('Customer’s “ref”')).toBe('customer\'s "ref"');
    expect(normalize('A – B — C')).toBe('a - b - c');
  });
  it('applies NFKC', () => {
    expect(normalize('ＡＢＮ')).toBe('abn');
    expect(normalize('ﬁle')).toBe('file');
  });
  it('splits labels into tokens', () => {
    expect(normTokens('Statement No:')).toEqual(['statement', 'no']);
    expect(normTokens(': #')).toEqual([]);
  });
});

describe('lines and phrases', () => {
  it('groups tokens on the same baseline into one line, left to right', () => {
    const lines = buildLines([tok('B', 200, 100), tok('A', 50, 101), tok('C', 50, 130)]);
    expect(lines.map((l) => l.text)).toEqual(['A B', 'C']);
  });
  it('uses 0.45 × the smaller height for line membership', () => {
    const big = tok('Title', 50, 100, 20); // centre 94
    const near = tok('x', 300, 95, 10); // centre 92 → within 4.5
    const far = tok('y', 300, 108, 10); // centre 105 → 11 away
    const lines = buildLines([big, near, far]);
    expect(lines).toHaveLength(2);
    expect(TOLERANCES.lineCentre).toBe(0.45);
  });
  it('splits phrases on gaps wider than about one space', () => {
    const line = buildLines([...words('Total GST:', 50, 100), tok('$38.56', 200, 100)])[0]!;
    expect(phrases(line).map((p) => p.text)).toEqual(['Total GST:', '$38.56']);
  });
  it('keeps the gap threshold at 0.35 × height', () => {
    const a = tok('a', 0, 100);
    const b = tok('b', a.x1 + 3.4, 100);
    const c = tok('c', b.x1 + 3.6, 100);
    const line = buildLines([a, b, c])[0]!;
    expect(phrases(line).map((p) => p.text)).toEqual(['a b', 'c']);
  });
  it('builds a layout per page', () => {
    const l = buildLayout(doc([tok('one', 50, 50)], [tok('two', 50, 50)]));
    expect(l.pages.map((p) => p.lines[0]!.text)).toEqual(['one', 'two']);
  });
});
