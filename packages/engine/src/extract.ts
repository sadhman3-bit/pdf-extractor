import type { BBox, DocLayout, DocText } from './types';
import { latest, type Template, type TemplateSet } from './template';
import { buildLayout } from './layout';
import { fingerprintMatches, matchTemplates } from './fingerprint';
import { findAnchors } from './anchor';
import { extractField, type FieldResult } from './fields';
import { extractTable, type TableResult } from './tables';
import { runCheck, typeMap, humanize, type CheckResult } from './checks';
import { fieldDefaults } from './template';

export type Status = 'ok' | 'review' | 'unknown' | 'ambiguous' | 'error';

export type ReasonCode =
  | 'password_protected'
  | 'unreadable'
  | 'no_text'
  | 'unknown_template'
  | 'ambiguous_template'
  | 'missing_field'
  | 'parse_failed'
  | 'table_not_found'
  | 'row_parse_failed'
  | 'check_failed'
  | 'check_unknown'
  | 'low_confidence';

export interface Reason {
  code: ReasonCode;
  message: string;
  field?: string;
  table?: string;
  row?: number;
  column?: string;
  page?: number;
  bbox?: BBox;
}

export interface Extraction {
  status: Status;
  reasons: Reason[];
  template: { id: string; name: string; version: number } | null;
  candidates: { id: string; name: string }[];
  fields: Record<string, FieldResult>;
  tables: Record<string, TableResult>;
  checks: CheckResult[];
  confidence: { min: number };
  pages: number;
  ocr: boolean;
}

export interface EngineOptions {
  /** Global confidence threshold; a template's own setting wins. */
  confidenceThreshold?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function emptyExtraction(status: Status, layout: DocLayout | null): Extraction {
  return {
    status,
    reasons: [],
    template: null,
    candidates: [],
    fields: {},
    tables: {},
    checks: [],
    confidence: { min: 0 },
    pages: layout?.pages.length ?? 0,
    ocr: !!layout?.pages.some((p) => p.ocr),
  };
}

/** An extraction for a PDF that couldn't be opened. */
export function errorExtraction(
  code: 'password_protected' | 'unreadable' | 'no_text',
  message: string,
  pages = 0,
): Extraction {
  const e = emptyExtraction('error', null);
  e.pages = pages;
  e.reasons = [{ code, message }];
  return e;
}

/** Version choice: newest first, the first whose required anchors are all found. */
export function chooseVersion(layout: DocLayout, set: TemplateSet): Template {
  const versions = [...set.versions].sort((a, b) => b.version - a.version);
  const matching = versions.filter((v) => fingerprintMatches(layout, v));
  const pool = matching.length ? matching : versions;
  for (const v of pool) {
    const required = v.fields.filter((f) => f.required);
    const ok = required.every((f) => {
      const d = fieldDefaults(f);
      return findAnchors(layout, f.anchor.labels, d.match, d.page).length > 0;
    });
    if (ok) return v;
  }
  return pool[0] ?? latest(set);
}

/** Runs one template against a document and works out status and reasons. */
export function extractWith(layout: DocLayout, t: Template, opts: EngineOptions = {}): Extraction {
  const decimal = t.settings?.decimal ?? '.';
  const threshold = t.settings?.confidenceThreshold ?? opts.confidenceThreshold ?? 0.8;
  const out = emptyExtraction('ok', layout);
  out.template = { id: t.id, name: t.name, version: t.version };

  for (const f of t.fields) out.fields[f.name] = extractField(layout, f, { decimal });
  for (const tb of t.tables ?? []) out.tables[tb.name] = extractTable(layout, tb, { decimal });

  const reasons: Reason[] = [];
  for (const f of t.fields) {
    const r = out.fields[f.name]!;
    const box = r.boxes[0] ?? r.anchor;
    if (r.error && r.required) {
      if (r.error === 'parse_failed') {
        reasons.push({
          code: 'parse_failed',
          message: `${humanize(f.name)} was found but “${r.raw ?? ''}” isn’t a valid ${r.type}.`,
          field: f.name,
          ...(box ? { page: box.page, bbox: box.bbox } : {}),
        });
      } else {
        const label = f.anchor.labels[0]!;
        reasons.push({
          code: 'missing_field',
          message:
            r.error === 'anchor_missing'
              ? `Couldn’t find ${humanize(f.name)}: the label “${label}” isn’t on the page.`
              : `Couldn’t find a value for ${humanize(f.name)} next to “${r.anchor?.label ?? label}”.`,
          field: f.name,
          ...(r.anchor ? { page: r.anchor.page, bbox: r.anchor.bbox } : {}),
        });
      }
    } else if (r.error === 'parse_failed') {
      reasons.push({
        code: 'parse_failed',
        message: `${humanize(f.name)} was found but “${r.raw ?? ''}” isn’t a valid ${r.type}.`,
        field: f.name,
        ...(box ? { page: box.page, bbox: box.bbox } : {}),
      });
    }
  }

  for (const tb of t.tables ?? []) {
    const res = out.tables[tb.name]!;
    if (!res.found) {
      reasons.push({
        code: 'table_not_found',
        message: `Couldn’t find the ${humanize(tb.name)} table: no line has its column headings.`,
        table: tb.name,
      });
      continue;
    }
    res.rows.forEach((row, i) => {
      for (const col of tb.columns) {
        const c = row.cells[col.name]!;
        if (c.error === 'parse_failed' || c.error === 'required_missing') {
          if (c.error === 'required_missing' || col.required) {
            reasons.push({
              code: 'row_parse_failed',
              message:
                c.error === 'required_missing'
                  ? `Row ${i + 1} of ${humanize(tb.name)} has no ${humanize(col.name)}.`
                  : `Row ${i + 1} of ${humanize(tb.name)}: “${c.raw}” isn’t a valid ${col.type ?? 'text'} for ${humanize(col.name)}.`,
              table: tb.name,
              row: i,
              column: col.name,
              page: row.page,
              bbox: c.boxes[0]?.bbox ?? row.bbox,
            });
          }
        }
      }
    });
  }

  // Checks
  const ctx = {
    fields: Object.fromEntries(Object.entries(out.fields).map(([k, v]) => [k, v.value])),
    tables: Object.fromEntries(
      (t.tables ?? []).map((tb) => [
        tb.name,
        out.tables[tb.name]!.rows.map((r) =>
          Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, c.value])),
        ),
      ]),
    ),
  };
  const types = typeMap(t);
  out.checks = (t.checks ?? [])
    .filter((c) => c.enabled !== false)
    .map((c) => runCheck(c, ctx, types));
  for (const c of out.checks) {
    if (c.severity !== 'error' || c.result === 'pass') continue;
    reasons.push({
      code: c.result === 'fail' ? 'check_failed' : 'check_unknown',
      message: c.message ?? c.label,
    });
  }

  // Confidence
  const confs: number[] = [];
  for (const f of t.fields) {
    const r = out.fields[f.name]!;
    if (r.value !== null || r.required) confs.push(r.conf);
  }
  for (const tb of t.tables ?? [])
    for (const row of out.tables[tb.name]!.rows) confs.push(row.conf);
  out.confidence = { min: r2(confs.length ? Math.min(...confs) : 1) };

  for (const f of t.fields) {
    const r = out.fields[f.name]!;
    if (r.value !== null && r.conf < threshold) {
      reasons.push({
        code: 'low_confidence',
        message: `${humanize(f.name)} was read as “${r.csv}” with low confidence (${Math.round(r.conf * 100)}%).`,
        field: f.name,
        ...(r.boxes[0] ? { page: r.boxes[0].page, bbox: r.boxes[0].bbox } : {}),
      });
    }
  }
  for (const tb of t.tables ?? []) {
    out.tables[tb.name]!.rows.forEach((row, i) => {
      for (const col of tb.columns) {
        const c = row.cells[col.name]!;
        if (c.value !== null && c.conf < threshold) {
          reasons.push({
            code: 'low_confidence',
            message: `Row ${i + 1} ${humanize(col.name)} was read as “${c.csv}” with low confidence (${Math.round(c.conf * 100)}%).`,
            table: tb.name,
            row: i,
            column: col.name,
            page: row.page,
            bbox: c.boxes[0]?.bbox ?? row.bbox,
          });
        }
      }
    });
  }

  out.reasons = reasons;
  out.status = reasons.length ? 'review' : 'ok';
  return out;
}

/** Full pipeline from tokens: fingerprint, version choice, extraction, status. */
export function processDocument(
  doc: DocText,
  sets: TemplateSet[],
  opts: EngineOptions = {},
): Extraction {
  const layout = buildLayout(doc);
  const tokens = layout.pages.reduce((s, p) => s + p.lines.length, 0);
  if (!tokens)
    return errorExtraction(
      'no_text',
      'This PDF has no readable text, even after OCR.',
      layout.pages.length,
    );
  const matches = matchTemplates(layout, sets);
  if (!matches.length) {
    const e = emptyExtraction('unknown', layout);
    e.reasons = [
      {
        code: 'unknown_template',
        message: 'No template matches this file. Create a template for this supplier.',
      },
    ];
    return e;
  }
  if (matches.length > 1) {
    const e = emptyExtraction('ambiguous', layout);
    e.candidates = matches.map((m) => ({ id: m.id, name: latest(m).name }));
    e.reasons = [
      {
        code: 'ambiguous_template',
        message: `This file matches more than one template: ${e.candidates.map((c) => c.name).join(', ')}.`,
      },
    ];
    return e;
  }
  const set = matches[0]!;
  return extractWith(layout, chooseVersion(layout, set), opts);
}
