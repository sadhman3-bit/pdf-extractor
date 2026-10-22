import type { Template } from './template';
import { assess, type EngineOptions, type Extraction } from './extract';
import { applyCleaners, parseValue } from './parse';
import { typeCellText } from './tables';
import type { Correction } from './output';

/** One edit a person made in review. `to` is the text they typed. */
export interface Edit {
  field?: string;
  table?: string;
  row?: number;
  column?: string;
  to: string;
}

/**
 * Applies edits to an extraction and re-assesses it. Edited values count as
 * fully confident. Returns the new extraction and the corrections list.
 */
export function applyEdits(
  original: Extraction,
  t: Template,
  edits: Edit[],
  opts: EngineOptions = {},
): { extraction: Extraction; corrections: Correction[] } {
  const ex: Extraction = structuredClone(original);
  const decimal = t.settings?.decimal ?? '.';
  const corrections: Correction[] = [];
  for (const e of edits) {
    if (e.field) {
      const rule = t.fields.find((f) => f.name === e.field);
      const r = ex.fields[e.field];
      if (!rule || !r) continue;
      const before = original.fields[e.field]?.csv ?? '';
      if (e.to === before) continue;
      const cleaned = applyCleaners(e.to, ['trim', 'collapseSpaces']);
      const v = cleaned
        ? parseValue(cleaned, rule.type ?? 'text', {
            dateFormats: [...(rule.dateFormats ?? []), 'DD/MM/YYYY', 'YYYY-MM-DD'],
            decimal,
            creditMeansNegative: rule.creditMeansNegative ?? true,
          })
        : null;
      r.raw = e.to;
      r.value = v?.value ?? null;
      r.csv = v?.csv ?? '';
      r.conf = v || !cleaned ? 1 : 0;
      if (v) delete r.error;
      else r.error = cleaned ? 'parse_failed' : 'value_missing';
      corrections.push({
        field: e.field,
        from: original.fields[e.field]?.value ?? null,
        to: r.value,
      });
    } else if (e.table && e.column !== undefined && e.row !== undefined) {
      const tb = t.tables?.find((x) => x.name === e.table);
      const col = tb?.columns.find((c) => c.name === e.column);
      const row = ex.tables[e.table]?.rows[e.row];
      if (!tb || !col || !row) continue;
      const beforeCell = original.tables[e.table]!.rows[e.row]!.cells[e.column]!;
      if (e.to === beforeCell.csv) continue;
      const cell = typeCellText(
        { ...col, dateFormats: [...(col.dateFormats ?? []), 'DD/MM/YYYY', 'YYYY-MM-DD'] },
        e.to,
        1,
        beforeCell.boxes,
        { decimal },
      );
      row.cells[e.column] = cell;
      row.conf = Math.min(1, ...Object.values(row.cells).map((c) => c.conf));
      corrections.push({
        field: e.column,
        table: e.table,
        row: e.row,
        from: beforeCell.value,
        to: cell.value,
      });
    }
  }
  return { extraction: assess(ex, t, opts), corrections };
}
