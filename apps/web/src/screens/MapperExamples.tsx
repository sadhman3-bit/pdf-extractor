import type { TableRule, Token } from '@pdfx/engine';
import { S } from '../strings';

export function ExamplePanel({
  active,
  setActive,
  name,
  setName,
  selected,
  table,
  apply,
  onChange,
}: {
  active: boolean;
  setActive: (value: boolean) => void;
  name: string;
  setName: (name: string) => void;
  selected: Token[];
  table: TableRule | null;
  apply: () => void;
  onChange: (table: TableRule) => void;
}) {
  const examples = (table?.groups ?? []).flatMap((g) =>
    (g.examples ?? []).filter((e) => e.text).map((e) => ({ ...e, name: g.name })),
  );
  return (
    <section class="card stack example-panel" aria-label={S.examples.title}>
      <h2 class="card-title">{S.examples.title}</h2>
      <p class="caption">{S.examples.hint}</p>
      <button
        type="button"
        class={`btn ${active ? '' : 'btn-primary'}`}
        onClick={() => setActive(!active)}
      >
        {active ? S.examples.stop : S.examples.start}
      </button>
      {active ? (
        <>
          <label class="field">
            {S.examples.column}
            <input
              value={name}
              list="example-columns"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
          <datalist id="example-columns">
            {[
              ...new Set([
                ...(table?.outputColumns ?? []),
                ...(table?.groups ?? []).map((g) => g.name),
              ]),
            ].map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div class="example-selection" tabIndex={0}>
            <strong>{S.examples.selected}</strong>
            <p>{selected.length ? selected.map((t) => t.text).join(' ') : S.examples.select}</p>
          </div>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!selected.length || !name.trim()}
            onClick={apply}
          >
            {S.examples.apply}
          </button>
        </>
      ) : null}
      {examples.length ? (
        <details open={active}>
          <summary>{S.examples.saved}</summary>
          <ul class="list-plain example-list">
            {examples.map((e, i) => (
              <li key={i}>
                <button
                  type="button"
                  class="btn btn-text"
                  onClick={() => {
                    setName(e.name);
                    setActive(true);
                  }}
                >
                  {e.name}: {e.text}
                </button>
                <button
                  type="button"
                  class="btn btn-small"
                  aria-label={S.examples.remove(e.text)}
                  onClick={() => {
                    if (!table) return;
                    const groups = table.groups!.flatMap((g) => {
                      if (g.name !== e.name) return [g];
                      const left = g.examples!.filter(
                        (x) => x.text !== e.text || x.pattern !== e.pattern,
                      );
                      return left.some((x) => x.text)
                        ? [{ ...g, pattern: left[0]!.pattern, examples: left }]
                        : [];
                    });
                    onChange({
                      ...table,
                      groups,
                      outputColumns: table.outputColumns?.filter(
                        (n) => n !== e.name || groups.some((g) => g.name === n),
                      ),
                    });
                  }}
                >
                  {S.common.remove}
                </button>
              </li>
            ))}
          </ul>
          <p class="caption">{S.examples.removalHint}</p>
        </details>
      ) : (
        <p class="caption">{S.examples.empty}</p>
      )}
    </section>
  );
}
