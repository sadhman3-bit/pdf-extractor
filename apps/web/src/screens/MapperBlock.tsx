import type { TableRule, TableResult } from '@pdfx/engine';
import { MATCH_MODES } from '@pdfx/engine';
import { S } from '../strings';

/** The selected block and table limits, without hiding them in advanced settings. */
export function BlockPanel({
  table,
  result,
  onChange,
}: {
  table: TableRule;
  result?: TableResult;
  onChange: (t: TableRule) => void;
}) {
  const set = (patch: Partial<TableRule>) => onChange({ ...table, ...patch });
  const rename = (from: string, to: string) => {
    if (
      !to.trim() ||
      table.groups?.some((g) => g.name === to) ||
      table.columns.some((c) => c.name === to)
    )
      return;
    set({
      groups: table.groups?.map((g) => (g.name === from ? { ...g, name: to } : g)),
      outputColumns: table.outputColumns?.map((n) => (n === from ? to : n)),
      ...(table.block
        ? { block: { ...table.block, ...(table.block.keyGroup === from ? { keyGroup: to } : {}) } }
        : {}),
    });
  };
  return (
    <section class="card stack block-panel">
      {table.block ? (
        <>
          <h3 class="card-title">{S.mapper.block.title}</h3>
          <p class="caption">{S.mapper.block.hint}</p>
          {table.groups?.map((g, i) => (
            <label class="field" key={i}>
              {i === 0 ? S.mapper.block.name : S.mapper.block.phone}
              <input
                value={g.name}
                onChange={(e) => rename(g.name, (e.target as HTMLInputElement).value.trim())}
              />
            </label>
          ))}
          <details>
            <summary>{S.mapper.block.summary}</summary>
            <div class="stack">
              <label class="field">
                {S.mapper.block.match}
                <select
                  value={table.block.keyGroup ?? ''}
                  onChange={(e) =>
                    set({
                      block: {
                        ...table.block!,
                        keyGroup: (e.target as HTMLSelectElement).value || undefined,
                      },
                    })
                  }
                >
                  <option value="">{S.common.none}</option>
                  {table.groups?.map((g) => (
                    <option key={g.name} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field">
                {S.mapper.block.headingLines}
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={table.block.headingLines ?? 1}
                  onChange={(e) =>
                    set({
                      block: {
                        ...table.block!,
                        headingLines: Math.max(
                          1,
                          Math.min(5, Number((e.target as HTMLInputElement).value) || 1),
                        ),
                      },
                    })
                  }
                />
              </label>
              <label class="field">
                {S.mapper.block.heading}
                <input
                  value={table.block.headingPattern}
                  onChange={(e) =>
                    set({
                      block: {
                        ...table.block!,
                        headingPattern: (e.target as HTMLInputElement).value,
                      },
                    })
                  }
                />
              </label>
              <label class="field">
                {S.mapper.block.total}
                <input
                  value={table.block.rowKeyPattern ?? ''}
                  onChange={(e) =>
                    set({
                      block: {
                        ...table.block!,
                        rowKeyPattern: (e.target as HTMLInputElement).value || undefined,
                      },
                    })
                  }
                />
              </label>
            </div>
          </details>
        </>
      ) : null}
      <details open={!!table.block}>
        <summary>{S.mapper.block.boundaries}</summary>
        <div class="stack">
          <label class="field">
            {S.mapper.settings.header}
            <input
              value={table.header.labels.join(', ')}
              onChange={(e) => {
                const labels = (e.target as HTMLInputElement).value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (labels.length) set({ header: { ...table.header, labels } });
              }}
            />
          </label>
          <label class="field">
            {S.mapper.settings.end}
            <input
              value={table.end?.labels.join(', ') ?? ''}
              onChange={(e) => {
                const labels = (e.target as HTMLInputElement).value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                set({
                  end: labels.length
                    ? { labels, match: table.end?.match ?? 'starts-with' }
                    : undefined,
                });
              }}
            />
          </label>
          <label class="field">
            {S.mapper.block.endMode}
            <select
              value={table.end?.match ?? 'starts-with'}
              disabled={!table.end}
              onChange={(e) =>
                set({
                  end: {
                    ...table.end!,
                    match: (e.target as HTMLSelectElement).value as NonNullable<
                      TableRule['end']
                    >['match'],
                  },
                })
              }
            >
              {MATCH_MODES.map((m) => (
                <option key={m} value={m}>
                  {S.options.match[m]}
                </option>
              ))}
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={table.requireEnd ?? false}
              disabled={!table.end}
              onChange={(e) => set({ requireEnd: (e.target as HTMLInputElement).checked })}
            />
            {S.mapper.block.endRequired}
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={table.continuesOnNextPage ?? true}
              onChange={(e) => set({ continuesOnNextPage: (e.target as HTMLInputElement).checked })}
            />
            {S.mapper.table.continues}
          </label>
        </div>
      </details>
      {result?.issues?.length ? (
        <div class="banner banner-danger" role="status">
          <strong>{S.mapper.block.issues}</strong>
          {result.issues.map((p, i) => (
            <p key={i}>{p.message}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
