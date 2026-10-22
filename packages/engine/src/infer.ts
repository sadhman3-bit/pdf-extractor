// Mapper helpers: guessing rules from clicks, suggestions on a new sample, and
// one-click fixes for samples that fail. Pure functions over the layout.
import type { BBox, DocLayout, Line, Phrase, Token } from './types';
import type { ColumnRule, Direction, FieldRule, FieldType, TableRule, Template } from './template';
import { bboxOf, cx, cy, phrases } from './layout';
import { normalize, normTokens } from './normalize';
import { guessDateFormat, inferType, parseDate, parseNumber, DATE_GUESS_FORMATS } from './parse';
import { findAbns } from './fingerprint';
import { findAnchors } from './anchor';
import { TOLERANCES } from './tolerances';
import { fieldDefaults } from './template';

export const PRESETS: { name: string; labels: string[]; type: FieldType }[] = [
  {
    name: 'InvoiceNumber',
    labels: ['Invoice No', 'Invoice Number', 'Tax Invoice No'],
    type: 'text',
  },
  { name: 'StatementNo', labels: ['Statement No', 'Statement Number'], type: 'text' },
  { name: 'AccountNo', labels: ['Account No', 'Account Number'], type: 'text' },
  { name: 'InvoiceDate', labels: ['Invoice Date', 'Date'], type: 'date' },
  { name: 'StatementDate', labels: ['Statement Date'], type: 'date' },
  { name: 'DueDate', labels: ['Due Date', 'Payment Due'], type: 'date' },
  { name: 'SupplierABN', labels: ['ABN'], type: 'text' },
  { name: 'PONumber', labels: ['PO', 'PO Number', 'Purchase Order', 'Order No'], type: 'text' },
  { name: 'TotalGST', labels: ['Total GST', 'GST', 'GST included'], type: 'currency' },
  {
    name: 'TotalDue',
    labels: ['Total Due', 'Amount Due', 'Amount payable', 'Total'],
    type: 'currency',
  },
  { name: 'LotNumber', labels: ['Batch', 'Lot', 'Batch No', 'Lot No'], type: 'text' },
  { name: 'ManufactureDate', labels: ['Manufacture Date', 'Mfg Date', 'DOM'], type: 'date' },
  { name: 'ExpiryDate', labels: ['Expiry', 'Exp Date', 'Best Before'], type: 'date' },
  { name: 'ProductCode', labels: ['Product Code', 'Item Code', 'Part No'], type: 'text' },
];

const LABEL_WORDS = [
  'no',
  'number',
  '#',
  'date',
  'total',
  'gst',
  'amount',
  'due',
  'account',
  'invoice',
  'statement',
  'po',
  'order',
  'batch',
  'lot',
  'expiry',
];

/** Preset for an anchor label, if any. */
export function presetFor(label: string): (typeof PRESETS)[number] | undefined {
  const n = normalize(label);
  return PRESETS.find((p) => p.labels.some((l) => normalize(l) === n));
}

/** "Total amount (inc GST)" → "TotalAmountIncGST". */
export function nameFromLabel(label: string): string {
  const words = label
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const name = words
    .map((w) =>
      w === w.toUpperCase() && w.length <= 4 ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
  return /^\p{L}/u.test(name) ? name : `Field${name}`;
}

function lineOfToken(layout: DocLayout, t: Token): Line | undefined {
  return layout.pages.find((p) => p.page === t.page)?.lines.find((l) => l.tokens.includes(t));
}

/** Text of a label phrase without the trailing colon. */
const labelText = (p: Phrase) => p.text.replace(/\s*[:#]+$/, '').trim();

export interface InferredField {
  rule: FieldRule;
  value: string;
  anchorBox: BBox;
}

/**
 * Guesses a field from the token(s) a person clicked: the anchor is the nearest
 * phrase to the left on the same line, otherwise the phrase directly above.
 */
export function inferField(
  layout: DocLayout,
  selected: Token[],
  existing: string[] = [],
): InferredField | null {
  if (!selected.length) return null;
  const sel = [...selected].sort((a, b) => a.x0 - b.x0);
  const first = sel[0]!;
  const line = lineOfToken(layout, first);
  if (!line) return null;
  const page = layout.pages.find((p) => p.page === first.page)!;
  const value = sel.map((t) => t.text).join(' ');
  let anchor: Phrase | undefined;
  let direction: Direction = 'right';
  const lefts = phrases(line).filter(
    (p) => p.x1 <= first.x0 + 0.5 && !p.tokens.some((t) => sel.includes(t)),
  );
  // Same-phrase label like "ABN 15 803 …": the start of the selected token's own phrase.
  const own = phrases(line).find((p) => p.tokens.includes(first));
  if (lefts.length) {
    anchor = lefts[lefts.length - 1];
  } else if (own && own.tokens[0] !== first && /\p{L}/u.test(own.tokens[0]!.text)) {
    const before = own.tokens.slice(0, own.tokens.indexOf(first));
    anchor = {
      ...own,
      tokens: before,
      text: before.map((t) => t.text).join(' '),
      ...boxOf(before),
    };
  } else {
    const idx = page.lines.indexOf(line);
    for (let i = idx - 1; i >= Math.max(0, idx - 3) && !anchor; i--) {
      const above = phrases(page.lines[i]!).filter(
        (p) =>
          p.x1 >= first.x0 - TOLERANCES.verticalWiden &&
          p.x0 <= sel[sel.length - 1]!.x1 + TOLERANCES.verticalWiden,
      );
      if (above.length) {
        anchor = above.sort((a, b) => Math.abs(a.x0 - first.x0) - Math.abs(b.x0 - first.x0))[0];
        direction = 'below';
      }
    }
  }
  if (!anchor) return null;
  const label = labelText(anchor) || anchor.text;
  const type = inferType(value);
  const preset = presetFor(label);
  let name = preset?.name ?? nameFromLabel(label);
  if (existing.includes(name)) {
    let n = 2;
    while (existing.includes(`${name}${n}`)) n++;
    name = `${name}${n}`;
  }
  const ownPhrase = phrases(line).find((p) => p.tokens.includes(first));
  let take: string;
  if (type !== 'text') take = 'token';
  else if (sel.length === 1) take = 'token';
  else if (
    ownPhrase &&
    ownPhrase.tokens.length === sel.length &&
    ownPhrase.tokens.every((t) => sel.includes(t))
  )
    take = 'phrase';
  else take = `tokens:${sel.length}`;
  const rule: FieldRule = {
    id: `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name,
    type,
    required: true,
    anchor: { labels: [label], match: 'exact' },
    direction,
    take,
    page: layout.pages.length > 1 ? first.page : 'any',
    hint: { page: first.page, bbox: bboxOf(sel) },
  };
  if (type === 'date') rule.dateFormats = [guessDateFormat(value) ?? 'DD/MM/YYYY'];
  if (layout.pages.length === 1) delete rule.page;
  return { rule, value, anchorBox: bboxOf(anchor.tokens) };
}

function boxOf(tokens: Token[]) {
  const b = bboxOf(tokens);
  return { x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
}

/** Field rules suggested on loading a sample: label/value pairs and ABNs. */
export function suggestFields(layout: DocLayout, existing: FieldRule[] = []): InferredField[] {
  const out: InferredField[] = [];
  const used = new Set(existing.map((f) => f.name));
  const usedLabels = new Set(existing.flatMap((f) => f.anchor.labels.map(normalize)));
  const page = layout.pages[0];
  if (!page) return out;
  for (const line of page.lines) {
    const ps = phrases(line);
    for (let i = 0; i < ps.length - 1; i++) {
      const p = ps[i]!;
      const v = ps[i + 1]!;
      const label = labelText(p);
      const n = normalize(label);
      if (!n || usedLabels.has(n)) continue;
      const words = n.split(' ');
      const labelish = /[:#]$/.test(p.text) || words.some((w) => LABEL_WORDS.includes(w));
      if (!labelish || words.length > 5) continue;
      const vt = v.text;
      const isValue =
        !!parseDate(vt, DATE_GUESS_FORMATS) ||
        !!parseNumber(vt) ||
        /^[A-Z0-9][A-Z0-9-/]*\d[A-Z0-9-/]*$/i.test(vt);
      if (!isValue) continue;
      const inf = inferField(layout, v.tokens, [...used]);
      if (!inf) continue;
      if (used.has(inf.rule.name)) continue;
      inf.rule.required = !!presetFor(label);
      used.add(inf.rule.name);
      usedLabels.add(n);
      out.push(inf);
    }
  }
  const text = page.lines.map((l) => l.text).join('\n');
  for (const abn of findAbns(text)) {
    if (used.has('SupplierABN')) break;
    const line = page.lines.find((l) => l.text.includes(abn));
    if (!line) continue;
    const digits = abn.split(' ');
    const idx = line.tokens.findIndex((t, k) =>
      digits.every((d, j) => line.tokens[k + j]?.text === d),
    );
    if (idx < 1) continue;
    const valueTokens = line.tokens.slice(idx, idx + digits.length);
    const labelTok = line.tokens[idx - 1]!;
    out.push({
      rule: {
        id: `fabn`,
        name: 'SupplierABN',
        type: 'text',
        required: false,
        anchor: { labels: [labelText({ text: labelTok.text } as Phrase) || 'ABN'], match: 'exact' },
        direction: 'right',
        take: `tokens:${digits.length}`,
        hint: { page: page.page, bbox: bboxOf(valueTokens) },
      },
      value: abn,
      anchorBox: bboxOf([labelTok]),
    });
    used.add('SupplierABN');
  }
  return out;
}

/** Fingerprint suggestion: the largest text near the top of page 1, the line after it, and any ABN. */
export function suggestFingerprint(layout: DocLayout): Template['fingerprint'] {
  const page = layout.pages[0];
  if (!page) return { mustContain: [] };
  const top = page.lines.filter((l) => l.cy < page.height * 0.2);
  const pool = top.length ? top : page.lines.slice(0, 5);
  const biggest = [...pool].sort(
    (a, b) =>
      Math.max(...b.tokens.map((t) => t.height)) - Math.max(...a.tokens.map((t) => t.height)),
  )[0];
  const must: string[] = [];
  if (biggest) {
    must.push(phrases(biggest)[0]!.text);
    const next = page.lines[page.lines.indexOf(biggest) + 1];
    if (next && next.cy < page.height * 0.2) {
      const p = phrases(next)[0]!.text;
      if (!/\d/.test(p) && p.length <= 40) must.push(p);
    }
  }
  const abn = findAbns(page.lines.map((l) => l.text).join('\n'))[0];
  return { mustContain: must, mustNotContain: [], ...(abn ? { abn } : {}), anyPage: false };
}

// ---------------------------------------------------------------- tables

function isHeaderish(line: Line): boolean {
  const ps = phrases(line);
  return (
    ps.length >= 2 &&
    ps.every(
      (p) =>
        !parseNumber(p.text) && !parseDate(p.text, DATE_GUESS_FORMATS) && /\p{L}/u.test(p.text),
    )
  );
}

/** True when most phrases of `row` start or sit under a phrase of `header`. */
function alignsWith(header: Line, row: Line): boolean {
  const hp = phrases(header);
  const rp = phrases(row);
  if (hp.length < rp.length - 1 || rp.length < 2) return false;
  const under = rp.filter((r) =>
    hp.some((h) => Math.abs(h.x0 - r.x0) <= 6 || (r.x0 < h.x1 && r.x1 > h.x0)),
  );
  return under.length >= Math.ceil(rp.length * 0.6);
}

export interface InferredTable {
  rule: TableRule;
  headerLine: Line;
}

/** Builds a table rule from one click on a header cell or a cell in the first data row. */
export function inferTable(
  layout: DocLayout,
  clicked: Token,
  name = 'Items',
): InferredTable | null {
  const page = layout.pages.find((p) => p.page === clicked.page);
  if (!page) return null;
  const line = page.lines.find((l) => l.tokens.includes(clicked));
  if (!line) return null;
  let idx = page.lines.indexOf(line);
  // A first row of plain text looks like a header too, so prefer a header-like
  // line just above whose columns line up with the clicked row.
  const above = page.lines.slice(Math.max(0, idx - 4), idx).reverse();
  let header: Line | undefined = above.find((l) => isHeaderish(l) && alignsWith(l, line));
  if (!header && isHeaderish(line)) header = line;
  if (!header) header = above.find(isHeaderish);
  if (!header) return null;
  idx = page.lines.indexOf(header);
  const hp = phrases(header);
  const used = new Set<string>();
  const columns: ColumnRule[] = hp.map((p) => {
    let n = nameFromLabel(p.text);
    while (used.has(n)) n = `${n}2`;
    used.add(n);
    return { name: n, header: p.text, type: 'text' };
  });
  const centres = hp.map((p) => (p.x0 + p.x1) / 2);
  const colOf = (t: Token) => {
    const c = cx(t);
    let best = 0;
    for (let i = 0; i < centres.length; i++) {
      const lo = i === 0 ? -Infinity : (centres[i - 1]! + centres[i]!) / 2;
      const hi = i === centres.length - 1 ? Infinity : (centres[i]! + centres[i + 1]!) / 2;
      if (c >= lo && c < hi) best = i;
    }
    return best;
  };
  // Types from the data rows below the header (up to 5 lines with a value in most columns).
  const body = page.lines.slice(idx + 1, idx + 8);
  const firstRow = body[0];
  const cellsOf = (l: Line) => {
    const cells: string[] = columns.map(() => '');
    for (const t of l.tokens) {
      const k = colOf(t);
      cells[k] = cells[k] ? `${cells[k]} ${t.text}` : t.text;
    }
    return cells;
  };
  const sample = body
    .map(cellsOf)
    .filter((c) => c.filter(Boolean).length >= Math.max(2, columns.length - 2));
  columns.forEach((col, k) => {
    const vals = sample.map((c) => c[k]!).filter(Boolean);
    if (!vals.length) return;
    const types = vals.map((v) => inferType(v));
    const all = (t: FieldType) =>
      types.every((x) => x === t || (t === 'currency' && x === 'number'));
    if (all('date')) {
      col.type = 'date';
      col.dateFormats = [guessDateFormat(vals[0]!) ?? 'DD/MM/YYYY'];
    } else if (types.every((x) => x === 'number' || x === 'currency')) {
      col.type =
        vals.some((v) => /\$|CR$/i.test(v)) ||
        /amount|total|price|cost|charge|value/i.test(col.name)
          ? 'currency'
          : vals.every((v) => /^-?\d+$/.test(v))
            ? 'integer'
            : 'number';
    } else if (vals.every((v) => /^-?\d+$/.test(v))) {
      col.type = 'integer';
    }
  });
  const startCol = columns.find((c) => c.type === 'date') ?? columns[0]!;
  const firstVal = firstRow ? (cellsOf(firstRow)[columns.indexOf(startCol)] ?? '') : '';
  const datePattern = (v: string) =>
    v
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\d/g, '\\d')
      .replace(/(\\d)+/g, (m) => `\\d{${m.length / 2}}`);
  const rowStart =
    startCol.type === 'date' && firstVal
      ? { column: startCol.name, pattern: `^${datePattern(firstVal)}$` }
      : { column: startCol.name, pattern: '\\S' };
  const amount = [...columns].reverse().find((c) => c.type === 'currency' || c.type === 'number');
  if (amount && amount.type === 'currency') amount.required = true;
  startCol.required = true;
  // End marker: the first line below the rows that starts with Subtotal/Total.
  let end: TableRule['end'];
  for (const l of page.lines.slice(idx + 1)) {
    const first = phrases(l)[0];
    if (first && /^(sub)?total/i.test(first.text)) {
      end = { labels: [labelText(first).split(' ')[0]!], match: 'starts-with' };
      break;
    }
  }
  const rule: TableRule = {
    id: `t${Date.now().toString(36)}`,
    name,
    header: { labels: hp.map((p) => p.text), minMatch: Math.max(2, Math.ceil(hp.length * 0.6)) },
    columns,
    boundaries: 'from-header',
    rowStart,
    wrappedLines: 'join',
    ...(end ? { end } : {}),
    skip: ['Page \\d+ of \\d+$'],
    continuesOnNextPage: true,
    groups: [],
  };
  return { rule, headerLine: header };
}

/** A table suggestion: a header line followed by 3+ aligned lines with a date or number column. */
export function suggestTable(layout: DocLayout): InferredTable | null {
  for (const page of layout.pages) {
    for (let i = 0; i < page.lines.length - 3; i++) {
      const h = page.lines[i]!;
      if (!isHeaderish(h) || phrases(h).length < 3) continue;
      const next = page.lines.slice(i + 1, i + 4);
      const ok = next.every((l) => {
        const ps = phrases(l);
        return (
          ps.length >= phrases(h).length - 1 &&
          ps.some((p) => !!parseDate(p.text, DATE_GUESS_FORMATS) || !!parseNumber(p.text))
        );
      });
      if (ok) return inferTable(layout, h.tokens[0]!, 'Items');
    }
  }
  return null;
}

// ---------------------------------------------------------------- diagnostics

export interface LabelFix {
  field: string;
  label: string;
  page: number;
  bbox: BBox;
  score: number;
}

const tokenSet = (s: string) => new Set(normTokens(s));
function similarity(a: string, b: string): number {
  const x = tokenSet(a);
  const y = tokenSet(b);
  const inter = [...x].filter((t) => y.has(t)).length;
  return inter / Math.max(1, Math.min(x.size, y.size));
}

/**
 * For a required field whose anchor is missing in a sample, finds a phrase on a
 * line with a value of the right type near the field's usual position, and
 * proposes it as another label.
 */
export function suggestLabelFix(
  layout: DocLayout,
  f: FieldRule,
  takenLabels: string[] = [],
): LabelFix | null {
  const d = fieldDefaults(f);
  if (findAnchors(layout, f.anchor.labels, d.match, d.page).length) return null;
  const preset = PRESETS.find((p) => p.name === f.name);
  const synonyms = [...(preset?.labels ?? []), ...f.anchor.labels];
  const taken = new Set(takenLabels.map(normalize));
  let best: LabelFix | null = null;
  for (const page of layout.pages) {
    if (f.hint && f.hint.page !== page.page) continue;
    const hy = f.hint ? (f.hint.bbox[1] + f.hint.bbox[3]) / 2 : null;
    for (const line of page.lines) {
      if (hy !== null && Math.abs(line.cy - hy) > page.height * TOLERANCES.hintWindow) continue;
      const ps = phrases(line);
      for (let i = 0; i < ps.length - 1; i++) {
        const label = labelText(ps[i]!);
        if (!label || !/\p{L}/u.test(label) || taken.has(normalize(label))) continue;
        const valueText = ps.slice(i + 1).map((p) => p.text);
        const typed = valueText.some((v) => {
          if (d.type === 'date') return !!parseDate(v, d.dateFormats);
          if (d.type === 'text') return true;
          return !!parseNumber(v, { integer: d.type === 'integer' });
        });
        if (!typed) continue;
        const syn = synonyms.some((s) => normalize(s) === normalize(label)) ? 2 : 0;
        const sim = Math.max(...f.anchor.labels.map((l) => similarity(l, label)));
        const near =
          hy === null ? 0 : 1 - Math.abs(line.cy - hy) / (page.height * TOLERANCES.hintWindow);
        const score = syn + sim + near * 0.5;
        if (score <= 0.5) continue;
        if (!best || score > best.score)
          best = { field: f.name, label, page: page.page, bbox: bboxOf(ps[i]!.tokens), score };
      }
    }
  }
  return best;
}

/** Proposes label fixes for every required field missing in a sample; never offers one label twice. */
export function suggestLabelFixes(layout: DocLayout, t: Template): LabelFix[] {
  const taken = t.fields.flatMap((f) => f.anchor.labels);
  const candidates = t.fields
    .filter((f) => f.required)
    .map((f) => ({ f, all: allFixes(layout, f, taken) }))
    .filter((x) => x.all.length);
  const out: LabelFix[] = [];
  const used = new Set<string>();
  // Assign the strongest pairs first.
  const pairs = candidates.flatMap((c) => c.all).sort((a, b) => b.score - a.score);
  const done = new Set<string>();
  for (const p of pairs) {
    if (done.has(p.field) || used.has(normalize(p.label))) continue;
    out.push(p);
    done.add(p.field);
    used.add(normalize(p.label));
  }
  return t.fields.flatMap((f) => out.filter((o) => o.field === f.name));
}

function allFixes(layout: DocLayout, f: FieldRule, taken: string[]): LabelFix[] {
  const out: LabelFix[] = [];
  const blocked = [...taken];
  for (let i = 0; i < 4; i++) {
    const fix = suggestLabelFix(layout, f, blocked);
    if (!fix) break;
    out.push(fix);
    blocked.push(fix.label);
  }
  return out;
}

export { cy as centreY };
