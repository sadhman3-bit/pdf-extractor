import type { FieldType, Template } from './template';
import type { SourceBox } from './fields';
import type { Extraction, Reason } from './extract';
import type { Value } from './parse';

export interface Correction {
  field: string;
  table?: string;
  row?: number;
  from: string | number | null;
  to: string | number | null;
}

export interface OutputMeta {
  file: string;
  sha256: string;
  extractedAt: string;
  reviewedBy?: string | null;
  corrections?: Correction[];
}

export const AUDIT_COLUMNS = [
  '_SourceFile',
  '_SourceSha256',
  '_Template',
  '_TemplateVersion',
  '_ExtractedAt',
  '_Status',
  '_ReviewedBy',
  '_Corrected',
] as const;

export interface ExtractionJson {
  schema: 'pdfx.extraction/1';
  source: { file: string; sha256: string; pages: number; ocr: boolean };
  template: { id: string; version: number } | null;
  status: Extraction['status'];
  reasons: Reason[];
  fields: Record<string, Value | null>;
  tables: Record<string, Record<string, Value | null>[]>;
  checks: {
    id: string;
    label: string;
    result: 'pass' | 'fail' | 'unknown';
    severity: 'error' | 'warning';
    message?: string;
  }[];
  confidence: { min: number };
  extractedAt: string;
  reviewedBy: string | null;
  corrections: Correction[];
}

/** Group columns of a table, in rule order. */
export function groupColumns(t: Template, table: string): string[] {
  return (t.tables ?? []).find((x) => x.name === table)?.groups?.map((g) => g.name) ?? [];
}

export function toJsonObject(
  result: Extraction,
  t: Template | null,
  meta: OutputMeta,
): ExtractionJson {
  const fields: Record<string, Value | null> = {};
  const tables: Record<string, Record<string, Value | null>[]> = {};
  if (t) {
    for (const f of t.fields) fields[f.name] = result.fields[f.name]?.value ?? null;
    for (const tb of t.tables ?? []) {
      const groups = groupColumns(t, tb.name);
      tables[tb.name] = (result.tables[tb.name]?.rows ?? []).map((row) => {
        const o: Record<string, Value | null> = {};
        for (const c of tb.columns) o[c.name] = row.cells[c.name]?.value ?? null;
        for (const g of groups) o[g] = row.groups[g] ?? null;
        return o;
      });
    }
  }
  return {
    schema: 'pdfx.extraction/1',
    source: { file: meta.file, sha256: meta.sha256, pages: result.pages, ocr: result.ocr },
    template: result.template ? { id: result.template.id, version: result.template.version } : null,
    status: result.status,
    reasons: result.reasons,
    fields,
    tables,
    checks: result.checks.map((c) => ({
      id: c.id,
      label: c.label,
      result: c.result,
      severity: c.severity,
      ...(c.message && c.result !== 'pass' ? { message: c.message } : {}),
    })),
    confidence: result.confidence,
    extractedAt: meta.extractedAt,
    reviewedBy: meta.reviewedBy ?? null,
    corrections: meta.corrections ?? [],
  };
}

export function toJson(result: Extraction, t: Template | null, meta: OutputMeta): string {
  return `${JSON.stringify(toJsonObject(result, t, meta), null, 2)}\n`;
}

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

export interface CsvFile {
  /** null for the single-table (or no-table) file; otherwise the table name for <base>.<Table>.csv. */
  table: string | null;
  content: string;
}

/**
 * Where each column of a shared layout comes from among a CSV's own columns
 * (null: not in this template, written empty), or null without a layout. The
 * layout applies to the main CSV: the first table's, or the only one.
 */
export function layoutOrder(
  t: Template,
  tableName: string | null,
  names: string[],
): (number | null)[] | null {
  if (!t.layout || tableName !== (t.tables?.[0]?.name ?? null)) return null;
  return t.layout.columns.map((n) => {
    const i = names.indexOf(n);
    return i >= 0 ? i : null;
  });
}

/**
 * CSV files for one extraction: one file, or one per table when the template has
 * more than one. Header fields repeat on every row; audit columns come last.
 */
export function toCsv(
  result: Extraction,
  t: Template,
  meta: OutputMeta,
  opts: { bom?: boolean } = {},
): CsvFile[] {
  const bom = (opts.bom ?? true) ? '﻿' : '';
  const corrected = (meta.corrections ?? []).length > 0;
  const audit = [
    meta.file,
    meta.sha256,
    t.id,
    String(t.version),
    meta.extractedAt,
    result.status,
    meta.reviewedBy ?? '',
    corrected ? 'true' : 'false',
  ];
  const fieldNames = t.fields.map((f) => f.name);
  const fieldCells = fieldNames.map((n) => result.fields[n]?.csv ?? '');
  const tables = t.tables ?? [];
  const build = (tableName: string | null): CsvFile => {
    const tb = tables.find((x) => x.name === tableName);
    const cols = tb ? tb.columns.map((c) => c.name) : [];
    const groups = tb ? groupColumns(t, tb.name) : [];
    const own = [...fieldNames, ...cols, ...groups];
    const order = layoutOrder(t, tb?.name ?? null, own);
    const arrange = (cells: string[]) =>
      order ? order.map((i) => (i === null ? '' : cells[i]!)) : cells;
    const lines = [csvLine([...(order ? t.layout!.columns : own), ...AUDIT_COLUMNS])];
    const rows = tb ? (result.tables[tb.name]?.rows ?? []) : [];
    if (!tb || !rows.length) {
      lines.push(
        csvLine([
          ...arrange([...fieldCells, ...cols.map(() => ''), ...groups.map(() => '')]),
          ...audit,
        ]),
      );
    } else {
      for (const row of rows) {
        lines.push(
          csvLine([
            ...arrange([
              ...fieldCells,
              ...cols.map((c) => row.cells[c]?.csv ?? ''),
              ...groups.map((g) => row.groups[g] ?? ''),
            ]),
            ...audit,
          ]),
        );
      }
    }
    return {
      table: tables.length > 1 ? tableName : null,
      content: bom + lines.join('\r\n') + '\r\n',
    };
  };
  if (tables.length <= 1) return [build(tables[0]?.name ?? null)];
  return tables.map((tb) => build(tb.name));
}

/** Output file base name for a source PDF: the file name without ".pdf". */
export function baseName(file: string): string {
  return file.replace(/\.pdf$/i, '');
}

export interface GridColumn {
  name: string;
  /** Bill detail (same on every row), table column, or heading copied onto rows. */
  kind: 'field' | 'column' | 'group';
  type: FieldType;
  /** A column of the shared layout that this template doesn't fill (written empty). */
  missing?: boolean;
}

export interface GridCell {
  /** As written to the CSV. */
  text: string;
  /** Text read from the page, when it differs from what is written. */
  raw?: string;
  error?: 'parse_failed' | 'required_missing' | 'not_found';
  /** Where the value sits, for showing it on the page. */
  box?: SourceBox;
}

export interface OutputGrid {
  table: string | null;
  columns: GridColumn[];
  rows: GridCell[][];
  /** Cells with an error, counting a bill detail once. */
  problems: number;
}

/**
 * One CSV file as a grid for the Mapper: the same columns and rows as `toCsv`
 * (without the audit columns), with each cell's problem and source box.
 */
export function outputGrid(
  result: Extraction,
  t: Template,
  tableName: string | null = t.tables?.[0]?.name ?? null,
): OutputGrid {
  const tb = (t.tables ?? []).find((x) => x.name === tableName);
  const groups = tb ? groupColumns(t, tb.name) : [];
  const columns: GridColumn[] = [
    ...t.fields.map((f) => ({ name: f.name, kind: 'field' as const, type: f.type ?? 'text' })),
    ...(tb?.columns ?? []).map((c) => ({
      name: c.name,
      kind: 'column' as const,
      type: c.type ?? 'text',
    })),
    ...groups.map((g) => ({ name: g, kind: 'group' as const, type: 'text' as const })),
  ];
  let problems = 0;
  const fieldCells: GridCell[] = t.fields.map((f) => {
    const r = result.fields[f.name];
    const cell: GridCell = { text: r?.csv ?? '' };
    if (r?.raw && r.raw !== cell.text) cell.raw = r.raw;
    if (r?.boxes[0]) cell.box = r.boxes[0];
    if (r?.error) {
      cell.error = r.error === 'parse_failed' ? 'parse_failed' : 'not_found';
      problems++;
    }
    return cell;
  });
  const rows = tb ? (result.tables[tb.name]?.rows ?? []) : [];
  // A shared layout picks and orders the columns; ones this template lacks are empty.
  const order = layoutOrder(
    t,
    tb?.name ?? null,
    columns.map((c) => c.name),
  );
  const shape = (g: OutputGrid): OutputGrid =>
    order
      ? {
          ...g,
          columns: order.map((i, k) =>
            i === null
              ? { name: t.layout!.columns[k]!, kind: 'field', type: 'text', missing: true }
              : g.columns[i]!,
          ),
          rows: g.rows.map((r) => order.map((i) => (i === null ? { text: '' } : r[i]!))),
        }
      : g;
  if (!rows.length) {
    return shape({
      table: tb?.name ?? null,
      columns,
      rows: [[...fieldCells, ...columns.slice(fieldCells.length).map(() => ({ text: '' }))]],
      problems,
    });
  }
  const out = rows.map((row) => [
    ...fieldCells,
    ...tb!.columns.map((c) => {
      const r = row.cells[c.name];
      const cell: GridCell = { text: r?.csv ?? '' };
      if (r && r.raw.trim() !== cell.text) cell.raw = r.raw;
      if (r?.boxes[0]) cell.box = r.boxes[0];
      if (r?.error) {
        cell.error = r.error;
        problems++;
      }
      return cell;
    }),
    ...groups.map((g) => ({ text: row.groups[g] ?? '' })),
  ]);
  return shape({ table: tb!.name, columns, rows: out, problems });
}
