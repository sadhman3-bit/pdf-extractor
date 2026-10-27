import type { BBox, DocLayout, Line, Token } from './types';
import type { ColumnRule, TableRule } from './template';
import { TOLERANCES } from './tolerances';
import { normToken, normTokens } from './normalize';
import { bboxOf, cx, furnitureLines, phrases } from './layout';
import { lineMatches } from './anchor';
import { applyCleaners, parseValue, type Value } from './parse';
import type { SourceBox } from './fields';

export interface CellResult {
  value: Value | null;
  csv: string;
  raw: string;
  conf: number;
  boxes: SourceBox[];
  error?: 'parse_failed' | 'required_missing';
}

export interface RowResult {
  cells: Record<string, CellResult>;
  groups: Record<string, string>;
  conf: number;
  page: number;
  bbox: BBox;
}

export interface ColumnBounds {
  name: string;
  x0: number;
  x1: number;
}

/** How the lines of a table were read, for showing each rule's reach. */
export interface LineStats {
  /** Heading lines, by the column they fill. */
  headings: Record<string, number>;
  /** Skipped lines, by index in the rule's `skip`. */
  skipped: number[];
  /** Lines joined onto the row above. */
  joined: number;
  /** Lines that were neither a row nor part of one (at most 500 listed). */
  unplaced: SourceBox[];
  unplacedCount: number;
  /** How each line of the table was read, for markers beside the page (first 20,000). */
  lines?: LineRole[];
}

export type LineRoleKind = 'header' | 'row' | 'part' | 'heading' | 'skip' | 'unplaced' | 'end';

export interface LineRole {
  page: number;
  y0: number;
  y1: number;
  role: LineRoleKind;
}

export interface TableResult {
  name: string;
  found: boolean;
  header?: SourceBox;
  end?: SourceBox;
  bounds: ColumnBounds[];
  rows: RowResult[];
  stats?: LineStats;
}

interface HeaderHit {
  page: number;
  lineIndex: number;
  /** Last line index used (two-line headers use two lines). */
  lastIndex: number;
  spans: Map<string, { x0: number; x1: number }>;
  bbox: BBox;
}

/** Finds a header label as a run of normalised tokens on the line. */
function findLabel(tokens: Token[], label: string): Token[] | null {
  const lt = normTokens(label);
  if (!lt.length) return null;
  const norm = tokens.map((t) => normToken(t.text));
  for (let i = 0; i + lt.length <= norm.length; i++) {
    let ok = true;
    for (let k = 0; k < lt.length; k++) {
      if (norm[i + k] !== lt[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return tokens.slice(i, i + lt.length);
  }
  return null;
}

function matchHeader(tokens: Token[], labels: string[]): Map<string, { x0: number; x1: number }> {
  const spans = new Map<string, { x0: number; x1: number }>();
  const sorted = [...tokens].sort((a, b) => a.x0 - b.x0);
  for (const label of labels) {
    const hit = findLabel(sorted, label);
    if (hit)
      spans.set(label, {
        x0: Math.min(...hit.map((t) => t.x0)),
        x1: Math.max(...hit.map((t) => t.x1)),
      });
  }
  return spans;
}

/** Finds the table header on one page, starting at a line index. */
export function findHeaderOnPage(
  lines: Line[],
  rule: TableRule,
  page: number,
  from = 0,
): HeaderHit | null {
  const labels = rule.header.labels;
  const need = Math.min(rule.header.minMatch ?? labels.length, labels.length);
  for (let i = from; i < lines.length; i++) {
    const one = matchHeader(lines[i]!.tokens, labels);
    if (one.size >= need) {
      return { page, lineIndex: i, lastIndex: i, spans: one, bbox: bboxOf(lines[i]!.tokens) };
    }
    const next = lines[i + 1];
    if (next && next.y0 - lines[i]!.y1 < Math.max(lines[i]!.y1 - lines[i]!.y0, 6) * 1.2) {
      const two = matchHeader([...lines[i]!.tokens, ...next.tokens], labels);
      if (two.size >= need && two.size > one.size) {
        return {
          page,
          lineIndex: i,
          lastIndex: i + 1,
          spans: two,
          bbox: bboxOf([...lines[i]!.tokens, ...next.tokens]),
        };
      }
    }
  }
  return null;
}

/**
 * Where the edge between two columns goes: in the last clear strip between the
 * left heading's end (a) and the right heading's start (b) that (almost) no
 * line of the table crosses. Halfway between the headings' centres (mid) when
 * there is no such strip, or no lines to go by.
 */
function gapBetween(a: number, b: number, mid: number, body: Line[]): number {
  const from = Math.floor(a);
  const n = Math.ceil(b) - from;
  if (!body.length || n < GAP_MIN) return mid;
  const cover = new Array<number>(n).fill(0);
  for (const line of body) {
    const hit = new Uint8Array(n);
    for (const t of line.tokens)
      for (let x = Math.max(0, Math.ceil(t.x0) - from); x < Math.min(n, t.x1 - from); x++)
        hit[x] = 1;
    for (let x = 0; x < n; x++) cover[x] = cover[x]! + hit[x]!;
  }
  // A stray wide line or two doesn't stop a strip counting as clear.
  const clear = Math.min(...cover) + Math.floor(body.length * 0.05);
  let best: [number, number] = [0, 0];
  for (let x = 0; x < n;) {
    if (cover[x]! > clear) {
      x++;
      continue;
    }
    let y = x;
    while (y < n && cover[y]! <= clear) y++;
    // The clear strip nearest the right heading: text spills right past its own
    // heading (a period after a description), numbers start at theirs.
    if (y - x >= GAP_MIN) best = [x, y];
    x = y;
  }
  // Narrower strips are the spaces between words.
  return best[1] - best[0] >= GAP_MIN ? from + (best[0] + best[1]) / 2 : mid;
}
const GAP_MIN = 5;

/** The lines under a header that show where its columns run: rows, not headings. */
export function bodyLines(lines: Line[], from: number, rule: TableRule): Line[] {
  const skip = compile(rule.skip);
  const body: Line[] = [];
  for (let i = from; i < lines.length && body.length < 60; i++) {
    const line = lines[i]!;
    if (rule.end && lineMatches(line, rule.end.labels, rule.end.match ?? 'starts-with')) break;
    if (phrases(line).length >= 2 && !skip.some((re) => re.test(line.text))) body.push(line);
  }
  return body;
}

/**
 * Column boundaries, unless set explicitly: in the gap between neighbouring
 * columns' words under the header (halfway between header centres without them).
 */
export function columnBounds(
  rule: TableRule,
  spans: Map<string, { x0: number; x1: number }>,
  body: Line[] = [],
): ColumnBounds[] {
  const placed = rule.columns
    .map((c) => {
      const s = spans.get(c.header);
      // Columns with both edges set sort by those, so breaks keep their order.
      const centre =
        c.x0 !== undefined && c.x1 !== undefined ? (c.x0 + c.x1) / 2 : s ? (s.x0 + s.x1) / 2 : null;
      return { c, centre };
    })
    .filter((p): p is { c: ColumnRule; centre: number } => p.centre !== null)
    .sort((a, b) => a.centre - b.centre);
  const edges = placed.slice(1).map((p, i) => {
    const prev = placed[i]!;
    const mid = (prev.centre + p.centre) / 2;
    const a = spans.get(prev.c.header)?.x1 ?? prev.centre;
    const b = spans.get(p.c.header)?.x0 ?? p.centre;
    return a < b ? gapBetween(a, b, mid, body) : mid;
  });
  return placed.map((p, i) => {
    const x0 = p.c.x0 ?? (i > 0 ? edges[i - 1]! : -Infinity);
    const x1 = p.c.x1 ?? (i < edges.length ? edges[i]! : Infinity);
    return { name: p.c.name, x0, x1 };
  });
}

function compile(patterns: string[] | undefined): RegExp[] {
  return (patterns ?? []).flatMap((p) => {
    try {
      return [new RegExp(p)];
    } catch {
      return [];
    }
  });
}

interface RawRow {
  cells: Map<string, Token[]>;
  groups: Record<string, string>;
  page: number;
}

/** Extracts one table across pages. */
export function extractTable(
  layout: DocLayout,
  rule: TableRule,
  opts: { decimal?: '.' | ',' } = {},
): TableResult {
  const result: TableResult = { name: rule.name, found: false, bounds: [], rows: [] };
  let header: HeaderHit | null = null;
  let startPage = 0;
  for (let pi = 0; pi < layout.pages.length; pi++) {
    const p = layout.pages[pi]!;
    header = findHeaderOnPage(p.lines, rule, p.page);
    if (header) {
      startPage = pi;
      break;
    }
  }
  if (!header) return result;
  result.found = true;
  result.header = { page: header.page, bbox: header.bbox };
  const headerLines = layout.pages[startPage]!.lines;
  const bounds = columnBounds(
    rule,
    header.spans,
    bodyLines(headerLines, header.lastIndex + 1, rule),
  );
  result.bounds = bounds;

  // An invalid pattern never matches but keeps its place, so counts line up with `rule.skip`.
  const skip = (rule.skip ?? []).map((p) => compile([p])[0] ?? /(?!)/);
  const groups = (rule.groups ?? []).flatMap((g) => {
    try {
      return [{ g, re: new RegExp(g.pattern) }];
    } catch {
      return [];
    }
  });
  let rowStart: { column: string; re: RegExp } | null = null;
  if (rule.rowStart) {
    try {
      rowStart = { column: rule.rowStart.column, re: new RegExp(rule.rowStart.pattern) };
    } catch {
      rowStart = null;
    }
  }
  const endMode = rule.end?.match ?? 'starts-with';
  const wrapped = rule.wrappedLines ?? 'join';
  const continues = rule.continuesOnNextPage ?? true;

  const groupValues: Record<string, string> = {};
  const raw: RawRow[] = [];
  let ended = false;
  const furniture = furnitureLines(layout);
  const stats: LineStats = {
    headings: {},
    skipped: (rule.skip ?? []).map(() => 0),
    joined: 0,
    unplaced: [],
    unplacedCount: 0,
    lines: [],
  };
  const mark = (line: Line, role: LineRoleKind) => {
    if (stats.lines!.length < 20000)
      stats.lines!.push({ page: line.page, y0: line.y0, y1: line.y1, role });
  };
  // Columns that take a row's later lines from another column ("Rental" under a description).
  const parts = rule.columns.filter((c) => c.partOf);
  const partFor = (name: string, toks: Token[]) =>
    parts.find(
      (c) =>
        c.partOf === name &&
        (c.x0 === undefined ||
          Math.abs(Math.min(...toks.map((t) => t.x0)) - c.x0) <= TOLERANCES.indent),
    );
  // Lines without a row start join the row above, but never across a group heading.
  let joinable = false;
  const colOf = (t: Token) => {
    const c = cx(t);
    return bounds.find((b) => c >= b.x0 && c < b.x1);
  };
  const lone = (line: Line) =>
    phrases(line).length === 1 &&
    !line.tokens.some((t) => rowStart && colOf(t)?.name === rowStart.column);

  for (let pi = startPage; pi < layout.pages.length && !ended; pi++) {
    const p = layout.pages[pi]!;
    let lines: Line[];
    if (pi === startPage) {
      for (const l of p.lines.slice(header.lineIndex, header.lastIndex + 1)) mark(l, 'header');
      lines = p.lines.slice(header.lastIndex + 1);
    } else {
      if (!continues) break;
      const again = findHeaderOnPage(p.lines, rule, p.page);
      lines = again
        ? p.lines.slice(again.lastIndex + 1)
        : p.lines.filter((l) => l.cy > p.height * TOLERANCES.pageTopSkip);
    }
    for (const line of lines) {
      if (rule.end && lineMatches(line, rule.end.labels, endMode)) {
        result.end = { page: p.page, bbox: [line.x0, line.y0, line.x1, line.y1] };
        mark(line, 'end');
        ended = true;
        break;
      }
      // A skipped line (such as a group's total) also closes the row above it.
      const si = skip.findIndex((re) => re.test(line.text));
      if (si >= 0) {
        stats.skipped[si] = (stats.skipped[si] ?? 0) + 1;
        mark(line, 'skip');
        joinable = false;
        continue;
      }
      if (furniture.has(line)) continue;
      const g = groups.find(
        ({ g, re }) =>
          re.test(line.text) &&
          (!g.lone || lone(line)) &&
          (g.x0 === undefined || Math.abs(line.x0 - g.x0) <= TOLERANCES.indent),
      );
      if (g) {
        const m = g.re.exec(line.text)!;
        groupValues[g.g.name] = (m[g.g.capture ?? 0] ?? m[0]).trim();
        stats.headings[g.g.name] = (stats.headings[g.g.name] ?? 0) + 1;
        mark(line, 'heading');
        joinable = false;
        continue;
      }
      const cells = new Map<string, Token[]>();
      for (const t of line.tokens) {
        const col = colOf(t);
        if (!col) continue;
        const arr = cells.get(col.name) ?? [];
        arr.push(t);
        cells.set(col.name, arr);
      }
      if (!cells.size) continue;
      const startsRow = rowStart
        ? rowStart.re.test(
            (cells.get(rowStart.column) ?? [])
              .map((t) => t.text)
              .join(' ')
              .trim(),
          )
        : true;
      if (startsRow) {
        raw.push({ cells, groups: { ...groupValues }, page: p.page });
        mark(line, 'row');
        joinable = true;
      } else if (wrapped === 'join' && joinable && raw.length) {
        const prev = raw[raw.length - 1]!;
        for (const [name, toks] of cells) {
          const to = partFor(name, toks)?.name ?? name;
          const arr = prev.cells.get(to) ?? [];
          arr.push(...toks);
          prev.cells.set(to, arr);
        }
        stats.joined++;
        mark(line, 'part');
      } else {
        stats.unplacedCount++;
        mark(line, 'unplaced');
        if (stats.unplaced.length < 500)
          stats.unplaced.push({ page: p.page, bbox: [line.x0, line.y0, line.x1, line.y1] });
      }
    }
  }

  result.rows = raw.map((r) => typeRow(rule, r, opts));
  result.stats = stats;
  return result;
}

function typeRow(rule: TableRule, r: RawRow, opts: { decimal?: '.' | ',' }): RowResult {
  const cells: Record<string, CellResult> = {};
  const all: Token[] = [];
  for (const col of rule.columns) {
    const toks = r.cells.get(col.name) ?? [];
    all.push(...toks);
    cells[col.name] = typeCell(col, toks, opts);
  }
  const conf = Math.min(1, ...Object.values(cells).map((c) => c.conf));
  return {
    cells,
    groups: r.groups,
    conf,
    page: r.page,
    bbox: bboxOf(all.length ? all : [{ x0: 0, y0: 0, x1: 0, y1: 0 }]),
  };
}

export function typeCell(
  col: ColumnRule,
  toks: Token[],
  opts: { decimal?: '.' | ',' } = {},
): CellResult {
  const raw = toks.map((t) => t.text).join(' ');
  const boxes = toks.length ? groupBoxes(toks) : [];
  const confTok = toks.length ? Math.min(...toks.map((t) => t.conf)) : 1;
  return typeCellText(col, raw, confTok, boxes, opts);
}

export function typeCellText(
  col: ColumnRule,
  raw: string,
  conf: number,
  boxes: SourceBox[],
  opts: { decimal?: '.' | ',' } = {},
): CellResult {
  const type = col.type ?? 'text';
  let cleaned = raw;
  try {
    cleaned = applyCleaners(raw, col.clean ?? ['trim', 'collapseSpaces']);
  } catch {
    /* unknown cleaner: use raw */
  }
  if (!cleaned) {
    return {
      value: null,
      csv: '',
      raw,
      conf: col.required ? 0 : conf,
      boxes,
      ...(col.required ? { error: 'required_missing' as const } : {}),
    };
  }
  const v = parseValue(cleaned, type, {
    dateFormats: col.dateFormats ?? ['DD/MM/YYYY'],
    decimal: opts.decimal ?? '.',
    creditMeansNegative: col.creditMeansNegative ?? true,
  });
  if (!v) return { value: null, csv: '', raw, conf: 0, boxes, error: 'parse_failed' };
  return { value: v.value, csv: v.csv, raw, conf, boxes };
}

function groupBoxes(toks: Token[]): SourceBox[] {
  const byPage = new Map<number, Token[]>();
  for (const t of toks) byPage.set(t.page, [...(byPage.get(t.page) ?? []), t]);
  return [...byPage].map(([page, ts]) => ({ page, bbox: bboxOf(ts) }));
}
