// The Mapper's output dock: the CSV as it will be written, for the whole sample,
// under the page. Only the rows in view are drawn, so long bills stay smooth.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GridCell, OutputGrid } from '@pdfx/engine';
import { S } from '../strings';

const ROW_H = 28;
const HEIGHT = { small: 196, large: 440 } as const;

export function OutputDock({
  grid,
  busy,
  onCell,
  onDownload,
  onRename,
  issues = [],
}: {
  grid: OutputGrid | null;
  busy: boolean;
  /** A cell was chosen: show its value on the page. */
  onCell: (cell: GridCell, column: string) => void;
  onDownload: () => void;
  onRename: (from: string, to: string) => void;
  issues?: string[];
}) {
  const [size, setSize] = useState<'small' | 'large' | 'closed'>('small');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [top, setTop] = useState(0);
  const [customHeight, setCustomHeight] = useState<number | null>(null);
  const rows = useMemo(
    () =>
      (grid?.rows ?? [])
        .map((cells, index) => ({ cells, index }))
        .filter((r) => !onlyProblems || r.cells.some((c) => c.error)),
    [grid, onlyProblems],
  );
  const empty = !grid || !grid.columns.length;
  const height = size === 'closed' ? 0 : (customHeight ?? HEIGHT[size]);
  const first = Math.max(0, Math.floor(top / ROW_H) - 5);
  const shown = rows.slice(first, first + Math.ceil(height / ROW_H) + 10);
  const problems = grid?.problems ?? 0;
  const ref = useRef<HTMLElement>(null);

  // Toasts and scrolled-to words stay clear of the dock.
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() =>
      root.style.setProperty('--dock-space', `${el.offsetHeight}px`),
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--dock-space');
    };
  }, []);

  return (
    <section ref={ref} class="output-dock" aria-labelledby="output-title">
      <div class="output-head">
        {!empty && size !== 'closed' ? (
          <label class="dock-resize">
            <span class="sr-only">{S.mapper.block.size}</span>
            <input
              type="range"
              min="100"
              max="440"
              step="20"
              value={height}
              onInput={(e) => setCustomHeight(Number((e.target as HTMLInputElement).value))}
            />
          </label>
        ) : null}
        <h2 id="output-title" class="card-title">
          {S.mapper.output.title}
        </h2>
        {empty ? null : (
          <>
            <span class="chip">{S.mapper.output.rows(grid.rows.length)}</span>
            {problems ? (
              <button
                type="button"
                class={`chip chip-danger chip-button${onlyProblems ? ' on' : ''}`}
                aria-pressed={onlyProblems}
                onClick={() => {
                  setOnlyProblems(!onlyProblems);
                  setTop(0);
                }}
              >
                {S.mapper.output.problems(problems)}
              </button>
            ) : issues.length ? (
              <span class="chip chip-danger">{S.mapper.block.issues}</span>
            ) : (
              <span class="chip chip-success">{S.mapper.output.noProblems}</span>
            )}
          </>
        )}
        {busy ? (
          <span class="caption" role="status">
            {S.mapper.output.updating}
          </span>
        ) : null}
        <span class="grow" />
        {empty ? null : (
          <button type="button" class="btn btn-small" onClick={onDownload}>
            {S.mapper.output.download}
          </button>
        )}
        {size !== 'closed' ? (
          <button
            type="button"
            class="btn btn-small btn-text"
            onClick={() => {
              setCustomHeight(null);
              setSize(size === 'small' ? 'large' : 'small');
            }}
          >
            {size === 'small' ? S.mapper.output.larger : S.mapper.output.smaller}
          </button>
        ) : null}
        <button
          type="button"
          class="btn btn-small btn-text"
          aria-expanded={size !== 'closed'}
          aria-controls={size !== 'closed' && !empty ? 'output-grid' : undefined}
          onClick={() => setSize(size === 'closed' ? 'small' : 'closed')}
        >
          {size === 'closed' ? S.mapper.output.show : S.mapper.output.hide}
        </button>
      </div>
      {issues.length ? (
        <details class="output-issues">
          <summary>
            {S.mapper.block.issues} ({issues.length})
          </summary>
          {issues.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </details>
      ) : null}
      {size === 'closed' ? null : empty ? (
        <p class="muted small output-empty">{S.mapper.output.empty}</p>
      ) : (
        <div
          id="output-grid"
          class="output-scroll"
          style={{ height: `${height}px` }}
          tabIndex={0}
          onScroll={(e) => setTop((e.currentTarget as HTMLElement).scrollTop)}
        >
          <table
            class="output-table mono"
            aria-label={S.mapper.output.title}
            aria-rowcount={rows.length + 1}
          >
            <thead>
              <tr aria-rowindex={1}>
                {grid.columns.map((c) => (
                  <th
                    key={c.name}
                    scope="col"
                    class={`col-${c.missing ? 'missing' : c.kind}`}
                    aria-label={`${c.name}, ${c.missing ? S.layout.notFound : S.options.type[c.type]}`}
                  >
                    <input
                      class="output-name"
                      aria-label={S.mapper.block.rename(c.name)}
                      value={c.name}
                      onChange={(e) => onRename(c.name, (e.target as HTMLInputElement).value)}
                    />
                    <span class="col-type">
                      {c.missing ? S.layout.notFound : S.options.type[c.type]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {first ? <tr aria-hidden="true" style={{ height: `${first * ROW_H}px` }} /> : null}
              {shown.map((r, k) => (
                <tr key={r.index} aria-rowindex={first + k + 2}>
                  {r.cells.map((c, j) => {
                    const col = grid.columns[j]!;
                    const why = c.error ? S.mapper.output.cellError(c.error, c.raw ?? '') : '';
                    return (
                      <td
                        key={j}
                        class={`${c.error ? 'cell-problem' : ''}${col.type === 'text' ? '' : ' num'}`}
                        title={why || c.raw || undefined}
                      >
                        {c.box ? (
                          <button
                            type="button"
                            class="cell-link"
                            onClick={() => onCell(c, col.name)}
                            aria-label={`${col.name}: ${c.text || why || S.mapper.output.blank}. ${S.mapper.output.showOnPage}`}
                          >
                            {c.text || (c.error ? (c.raw ?? '!') : '')}
                          </button>
                        ) : (
                          c.text
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {first + shown.length < rows.length ? (
                <tr
                  aria-hidden="true"
                  style={{ height: `${(rows.length - first - shown.length) * ROW_H}px` }}
                />
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
