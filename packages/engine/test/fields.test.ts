import { describe, expect, it } from 'vitest';
import {
  buildLayout,
  extractField,
  findAnchors,
  isValidAbn,
  findAbns,
  matchTemplates,
  chooseVersion,
  inferField,
  valueTokens,
  type FieldRule,
  type Template,
} from '../src';
import { tok, words, doc } from './helpers';

const field = (f: Partial<FieldRule> & { labels: string[] }): FieldRule => {
  const { labels, ...rest } = f;
  return { id: 'x', name: 'X', anchor: { labels }, ...rest };
};

const page = doc([
  ...words('NORTHLINE FUEL', 50, 60, 20),
  ...words('Statement No:', 340, 62),
  tok('ST-48213', 440, 62),
  ...words('Total GST:', 340, 168),
  tok('$38.56', 515, 168),
  ...words('Amount payable:', 340, 184),
  tok('$', 500, 184),
  tok('424.18', 508, 184),
  ...words('Customer', 50, 150),
  ...words('Brightwater Logistics Pty Ltd', 50, 164),
  ...words('Credit', 50, 230),
  tok('12.40', 120, 230),
  tok('CR', 148, 230),
  ...words('Ref', 300, 260),
  ...words('AB 12', 330, 260),
  tok('tail', 420, 260),
  ...words('Due', 300, 300),
  tok('21/10/2026', 300, 314),
  ...words('Left value', 50, 340),
  ...words('Label:', 200, 340),
]);
const layout = buildLayout(page);

describe('anchors', () => {
  it('matches labels exactly, ignoring trailing colons', () => {
    const hits = findAnchors(layout, ['Statement No'], 'exact', 'any');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.tokens.map((t) => t.text)).toEqual(['Statement', 'No:']);
  });
  it('does not match a label that is only the start of a longer phrase', () => {
    expect(findAnchors(layout, ['Total'], 'exact', 'any')).toHaveLength(0);
    expect(findAnchors(layout, ['Total'], 'starts-with', 'any')).toHaveLength(1);
  });
  it('supports contains and regex', () => {
    expect(findAnchors(layout, ['GST'], 'contains', 'any')).toHaveLength(1);
    expect(findAnchors(layout, ['^total\\s+gst'], 'regex', 'any')).toHaveLength(1);
  });
  it('falls back to alternate labels', () => {
    const hits = findAnchors(layout, ['Total Due', 'Amount payable'], 'exact', 'any');
    expect(hits[0]!.labelIndex).toBe(1);
  });
});

describe('fields', () => {
  it('right · token with pattern and cleaners', () => {
    const r = extractField(
      layout,
      field({
        labels: ['Statement No'],
        pattern: '^ST-\\d+$',
        take: 'token',
        clean: ['trim', 'upper'],
      }),
    );
    expect(r.value).toBe('ST-48213');
    expect(r.conf).toBe(1);
    expect(r.boxes[0]!.page).toBe(1);
  });
  it('right · currency joins adjacent tokens like "$ 424.18"', () => {
    const r = extractField(
      layout,
      field({ labels: ['Total Due', 'Amount payable'], type: 'currency' }),
    );
    expect(r.value).toBe(424.18);
    expect(r.raw).toBe('$ 424.18');
  });
  it('right · CR suffix makes a credit negative', () => {
    const r = extractField(layout, field({ labels: ['Credit'], type: 'currency' }));
    expect(r.value).toBe(-12.4);
  });
  it('below · phrase takes the whole phrase', () => {
    const r = extractField(layout, field({ labels: ['Customer'], direction: 'below' }));
    expect(r.value).toBe('Brightwater Logistics Pty Ltd');
  });
  it('below · date', () => {
    const r = extractField(layout, field({ labels: ['Due'], direction: 'below', type: 'date' }));
    expect(r.value).toBe('2026-10-21');
  });
  it('above', () => {
    const r = extractField(layout, field({ labels: ['21/10/2026'], direction: 'above' }));
    expect(r.value).toBe('Due');
  });
  it('left', () => {
    const r = extractField(layout, field({ labels: ['Label'], direction: 'left' }));
    expect(r.value).toBe('Left value');
  });
  it('take modes: phrase, rest-of-line, tokens:n, until-gap', () => {
    expect(extractField(layout, field({ labels: ['Ref'], take: 'phrase' })).value).toBe('AB 12');
    expect(extractField(layout, field({ labels: ['Ref'], take: 'rest-of-line' })).value).toBe(
      'AB 12 tail',
    );
    expect(extractField(layout, field({ labels: ['Ref'], take: 'tokens:1' })).value).toBe('AB');
    expect(extractField(layout, field({ labels: ['Ref'], take: 'until-gap' })).value).toBe('AB 12');
  });
  it('maxDistance limits right candidates', () => {
    const r = extractField(
      layout,
      field({ labels: ['Total GST'], type: 'currency', maxDistance: 50 }),
    );
    expect(r.error).toBe('value_missing');
  });
  it('reports a missing anchor', () => {
    expect(extractField(layout, field({ labels: ['Nope'] })).error).toBe('anchor_missing');
  });
  it('reports a value that fails to parse', () => {
    const r = extractField(
      layout,
      field({ labels: ['Statement No'], type: 'date', take: 'phrase' }),
    );
    expect(r.error).toBe('parse_failed');
    expect(r.conf).toBe(0);
  });
  it('falls back to the region with confidence × 0.7', () => {
    const r = extractField(
      layout,
      field({
        labels: ['Missing label'],
        type: 'currency',
        region: { page: 1, x0: 0.85, y0: 0.19, x1: 0.95, y1: 0.205 },
      }),
    );
    expect(r.via).toBe('region');
    expect(r.value).toBe(38.56);
    expect(r.conf).toBe(0.7);
  });
  it('page and occurrence select among repeated labels', () => {
    const two = buildLayout(
      doc(
        [...words('Total:', 50, 100), tok('1.00', 150, 100)],
        [...words('Total:', 50, 100), tok('2.00', 150, 100)],
      ),
    );
    const f = { labels: ['Total'], type: 'currency' as const };
    expect(extractField(two, field({ ...f })).value).toBe(1);
    expect(extractField(two, field({ ...f, page: 'last' })).value).toBe(2);
    expect(extractField(two, field({ ...f, occurrence: 'last' })).value).toBe(2);
    expect(extractField(two, field({ ...f, occurrence: 2 })).value).toBe(2);
    expect(extractField(two, field({ ...f, page: 2 })).value).toBe(2);
    expect(
      extractField(two, field({ ...f, hint: { page: 2, bbox: [150, 92, 170, 102] } })).value,
    ).toBe(2);
  });
});

describe('fingerprint', () => {
  it('validates ABNs with the checksum', () => {
    expect(isValidAbn('15 803 047 975')).toBe(true);
    expect(isValidAbn('15 803 047 976')).toBe(false);
    expect(findAbns('Northline Fuel ABN 15 803 047 975 more')).toEqual(['15 803 047 975']);
  });
  const t = (id: string, must: string[], extra: Partial<Template> = {}): Template => ({
    schema: 'pdfx.template/1',
    id,
    name: id,
    version: 1,
    fingerprint: { mustContain: must },
    fields: [],
    ...extra,
  });
  it('matches on page 1 text, mustNotContain and ABN digits', () => {
    const set = (x: Template) => ({ id: x.id, versions: [x] });
    expect(matchTemplates(layout, [set(t('a', ['Northline fuel']))])).toHaveLength(1);
    expect(
      matchTemplates(layout, [
        set(
          t('a', ['Northline fuel'], {
            fingerprint: { mustContain: ['Northline Fuel'], mustNotContain: ['Customer'] },
          }),
        ),
      ]),
    ).toHaveLength(0);
    expect(matchTemplates(layout, [set(t('a', ['Coastal']))])).toHaveLength(0);
    expect(
      matchTemplates(layout, [
        set(t('a', [], { fingerprint: { mustContain: ['Northline'], abn: '99 999 999 999' } })),
      ]),
    ).toHaveLength(0);
  });
  it('anyPage looks beyond page 1', () => {
    const two = buildLayout(doc([tok('front', 50, 50)], [tok('MARKER', 50, 50)]));
    const set = (x: Template) => ({ id: x.id, versions: [x] });
    expect(matchTemplates(two, [set(t('a', ['marker']))])).toHaveLength(0);
    expect(
      matchTemplates(two, [
        set(t('a', [], { fingerprint: { mustContain: ['marker'], anyPage: true } })),
      ]),
    ).toHaveLength(1);
  });
  it('chooses the newest version whose required anchors are all found', () => {
    const f = (labels: string[]): FieldRule => ({
      id: 'f',
      name: 'F',
      required: true,
      anchor: { labels },
    });
    const v1 = t('a', ['Northline'], { version: 1, fields: [f(['Total GST'])] });
    const v2 = t('a', ['Northline'], { version: 2, fields: [f(['GST total'])] });
    expect(chooseVersion(layout, { id: 'a', versions: [v1, v2] }).version).toBe(1);
    const v3 = t('a', ['Northline'], { version: 3, fields: [f(['Statement No'])] });
    expect(chooseVersion(layout, { id: 'a', versions: [v1, v2, v3] }).version).toBe(3);
    expect(chooseVersion(layout, { id: 'a', versions: [v2] }).version).toBe(2);
  });
});

describe('valueTokens and inferField', () => {
  const l = buildLayout(
    doc([
      ...words('Statement date', 50, 100),
      ...words('12 Mar 2026', 200, 100),
      ...words('Supplier', 50, 130),
      ...words('Coastal Telco Pty Ltd', 200, 130),
      ...words('ABN 15 803 228 941', 50, 160),
    ]),
  );
  const at = (text: string) =>
    l.pages[0]!.lines.flatMap((x) => x.tokens).find((t) => t.text === text)!;
  const text = (ts: { text: string }[]) => ts.map((t) => t.text).join(' ');

  it('widens a click on part of a date to the whole date', () => {
    const sel = valueTokens(l, at('Mar'));
    expect(text(sel)).toBe('12 Mar 2026');
    const inf = inferField(l, sel)!;
    expect(inf.rule.type).toBe('date');
    expect(inf.rule.take).toBe('phrase');
    expect(extractField(l, inf.rule).value).toBe('2026-03-12');
  });
  it('widens a click on a name to the rest of the phrase', () => {
    expect(text(valueTokens(l, at('Coastal')))).toBe('Coastal Telco Pty Ltd');
  });
  it('leaves out a label at the start of the same phrase', () => {
    const sel = valueTokens(l, at('803'));
    expect(text(sel)).toBe('15 803 228 941');
    expect(inferField(l, sel)!.rule.anchor.labels).toEqual(['ABN']);
  });
});
