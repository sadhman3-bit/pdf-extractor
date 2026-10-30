// The table at a glance: how many rows were found, what one row is, and where
// each column comes from. The first thing in the Mapper's rail.
import { rowKindOf, type RowKind, type TableResult, type TableRule } from '@pdfx/engine';
import { S } from '../strings';

type Kind = Exclude<RowKind, 'custom'>;
const KINDS: Kind[] = ['block', 'items', 'lines'];

export function RowsPanel({
  table,
  result,
  toCheck,
  onKind,
  onNextCheck,
}: {
  table: TableRule | null;
  result: TableResult | undefined;
  toCheck: number;
  onKind: (kind: Kind) => void;
  onNextCheck: () => void;
}) {
  if (!table)
    return (
      <section class="card stack rows-panel" aria-label={S.rows.title}>
        <h2 class="card-title">{S.rows.title}</h2>
        <p class="caption">{S.rows.none}</p>
      </section>
    );
  const kind = rowKindOf(table);
  const rows = result?.rows.length ?? 0;
  const groups = (table.groups ?? []).map((g) => g.name);
  const shown = table.outputColumns ?? [...table.columns.map((c) => c.name), ...groups];
  const from = (name: string) =>
    groups.includes(name)
      ? { text: S.rows.fromHeading, tone: 'heading' }
      : kind === 'block'
        ? { text: S.rows.fromTotal, tone: 'total' }
        : { text: S.rows.fromRow, tone: 'total' };
  return (
    <section class="card stack rows-panel" aria-label={S.rows.title}>
      <div class="rows-head">
        <h2 class="card-title">{S.rows.title}</h2>
        <span class="chip chip-success">{S.rows.found(rows)}</span>
        {toCheck ? (
          <button type="button" class="chip chip-warn chip-button" onClick={onNextCheck}>
            {S.rows.toCheck(toCheck)}
          </button>
        ) : null}
      </div>
      <fieldset class="row-kinds">
        <legend class="field">{S.rows.rowIs}</legend>
        {KINDS.map((k) => (
          <label key={k} class={`row-kind${kind === k ? ' row-kind-on' : ''}`}>
            <input type="radio" name="row-kind" checked={kind === k} onChange={() => onKind(k)} />
            <span>
              <strong>{S.rows.kinds[k]}</strong>
              {kind === k ? <span class="caption">{S.rows.kindHints[k]}</span> : null}
            </span>
          </label>
        ))}
        {kind === 'custom' ? <p class="caption">{S.rows.custom}</p> : null}
      </fieldset>
      <div class="stack-tight">
        <h3 class="field">{S.rows.columns}</h3>
        <ul class="row-columns">
          {shown.map((name) => {
            const f = from(name);
            return (
              <li key={name} class={`row-column row-column-${f.tone}`}>
                <span>{name}</span>
                <span class="caption">{f.text}</span>
              </li>
            );
          })}
        </ul>
        <p class="caption">{S.rows.addColumn}</p>
      </div>
    </section>
  );
}
