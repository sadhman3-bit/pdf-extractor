// A CSV layout shared across suppliers: the columns every bill's CSV should have,
// in order. Each one is either found in this template or filled from one of its
// own columns (which renames that column to the layout's name).
import { useState } from 'preact/hooks';
import type { Template } from '@pdfx/engine';
import { S } from '../strings';

export interface CsvLayout {
  name: string;
  columns: string[];
}

export function LayoutPanel({
  draft,
  layouts,
  own,
  onUse,
  onSave,
  onFill,
}: {
  draft: Template;
  /** Layouts saved in this workspace. */
  layouts: CsvLayout[];
  /** This template's own CSV columns, in order. */
  own: string[];
  onUse: (layout: CsvLayout | null) => void;
  onSave: (name: string) => void;
  /** Fills a layout column from one of the template's own columns. */
  onFill: (column: string, from: string) => void;
}) {
  const [name, setName] = useState('');
  const layout = draft.layout;
  const spare = own.filter((n) => !layout?.columns.includes(n));
  const missing = layout?.columns.filter((c) => !own.includes(c)) ?? [];
  return (
    <details class="card rail-more" open={!!layout}>
      <summary>{S.layout.title(layout?.name ?? null, missing.length)}</summary>
      <div class="stack">
        <p class="caption">{S.layout.hint}</p>
        <label class="field">
          {S.layout.use}
          <select
            value={layout?.name ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              onUse(layouts.find((l) => l.name === v) ?? null);
            }}
          >
            <option value="">{S.layout.own}</option>
            {layouts.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
            {layout && !layouts.some((l) => l.name === layout.name) ? (
              <option value={layout.name}>{layout.name}</option>
            ) : null}
          </select>
        </label>
        {layout ? (
          <>
            <ul class="layout-list">
              {layout.columns.map((c) => (
                <li key={c} class="layout-row">
                  <span class="mono">{c}</span>
                  {own.includes(c) ? (
                    <span class="chip chip-success">{S.layout.found}</span>
                  ) : (
                    <select
                      aria-label={S.layout.fillFrom(c)}
                      value=""
                      onChange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        if (v) onFill(c, v);
                      }}
                    >
                      <option value="">{S.layout.notFound}</option>
                      {spare.map((n) => (
                        <option key={n} value={n}>
                          {S.layout.from(n)}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              ))}
            </ul>
            {spare.length ? <p class="caption">{S.layout.left(spare.join(', '))}</p> : null}
          </>
        ) : null}
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSave(name.trim());
            setName('');
          }}
        >
          <input
            type="text"
            aria-label={S.layout.newName}
            placeholder={S.layout.newPlaceholder}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <button type="submit" class="btn btn-small" disabled={!name.trim() || !own.length}>
            {S.layout.save}
          </button>
        </form>
      </div>
    </details>
  );
}
