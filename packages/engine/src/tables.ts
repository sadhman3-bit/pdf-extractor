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

export interface TableResult {
  name: string;
  found: boolean;
  header?: SourceBox;
  end?: SourceBox;
  bounds: ColumnBounds[];
  rows: RowResult[];
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

/** Column boundaries: halfway between neighbouring header centres, unless set explicitly. */
export function columnBounds(
  rule: TableRule,
  spans: Map<string, { x0: number; x1: number }>,
): ColumnBounds[] {
  const placed = rule.columns
    .map((c) => {
      const s = spans.get(c.header);
      const centre = s
        ? (s.x0 + s.x1) / 2
        : c.x0 !== undefined && c.x1 !== undefined
          ? (c.x0 + c.x1) / 2
          : null;
      return { c, centre };
    })
    .filter((p): p is { c: ColumnRule; centre: number } => p.centre !== null)
    .sort((a, b) => a.centre - b.centre);
  return placed.map((p, i) => {
    const prev = placed[i - 1];
    const next = placed[i + 1];
    const x0 = p.c.x0 ?? (prev ? (prev.centre + p.centre) / 2 : -Infinity);
    const x1 = p.c.x1 ?? (next ? (p.centre + next.centre) / 2 : Infinity);
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
  const bounds = columnBounds(rule, header.spans);
  result.bounds = bounds;

  const skip = compile(rule.skip);
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
        ended = true;
        break;
      }
      // A skipped line (such as a group's total) also closes the row above it.
      if (skip.some((re) => re.test(line.text))) {
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
        joinable = true;
      } else if (wrapped === 'join' && joinable && raw.length) {
        const prev = raw[raw.length - 1]!;
        for (const [name, toks] of cells) {
          const arr = prev.cells.get(name) ?? [];
          arr.push(...toks);
          prev.cells.set(name, arr);
        }
      }
    }
  }

  result.rows = raw.map((r) => typeRow(rule, r, opts));
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
