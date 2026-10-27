import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  DIRECTIONS,
  FIELD_TYPES,
  MATCH_MODES,
  PRESETS,
  defaultChecks,
  humanize,
  validateExpr,
  type CheckRule,
  type Extraction,
  type FieldRule,
  type InferredField,
  type TableRule,
  type Template,
} from '@pdfx/engine';
import { S } from '../strings';
import { CheckIcon, XIcon } from '../components/Icons';
import { parseCsv } from '../workspace/csv';

const ruleText = (f: FieldRule) => {
  const label = f.anchor.labels[0] ?? '';
  const type = f.type ?? 'text';
  switch (f.direction ?? 'right') {
    case 'below':
      return S.mapper.ruleBelow(label, type);
    case 'left':
      return S.mapper.ruleLeft(label, type);
    case 'above':
      return S.mapper.ruleAbove(label, type);
    default:
      return S.mapper.ruleRight(label, type);
  }
};

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

function selValue(v: FieldRule['page'] | FieldRule['occurrence']): string {
  return v === undefined ? '' : String(v);
}
function parseSel(s: string): 'first' | 'last' | 'any' | number | undefined {
  const t = s.trim().toLowerCase();
  if (!t) return undefined;
  if (t === 'first' || t === 'last' || t === 'any') return t;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// ---------------------------------------------------------------- fields

export function FieldsPanel(props: {
  draft: Template;
  result: Extraction | null;
  suggestions: InferredField[];
  editing: string | null;
  repick: string | null;
  onAccept: (s: InferredField) => void;
  onAcceptAll: () => void;
  hot: string | null;
  onHot: (id: string | null) => void;
  onDismiss: (s: InferredField) => void;
  onEdit: (id: string | null) => void;
  onRepick: (id: string) => void;
  onChange: (f: FieldRule) => void;
  onRemove: (id: string) => void;
  onAddPreset: (name: string) => void;
  onRegion: (id: string, on: boolean) => void;
}) {
  const { draft, result } = props;
  const unused = PRESETS.filter((p) => !draft.fields.some((f) => f.name === p.name));
  return (
    <section class="card stack" aria-labelledby="fields-title">
      <h2 id="fields-title" class="card-title">
        {S.mapper.fields}
      </h2>
      {!draft.fields.length ? <p class="muted small">{S.mapper.noFields}</p> : null}
      {draft.fields.map((f) => {
        const r = result?.fields[f.name];
        const open = props.editing === f.id;
        return (
          <div key={f.id} class="stack">
            <div
              class={`field-row${open ? ' selected' : ''}${props.hot === f.id ? ' hot' : ''}`}
              onMouseEnter={() => props.onHot(f.id)}
              onMouseLeave={() => props.onHot(null)}
            >
              <div class="grow">
                <button
                  type="button"
                  class="field-toggle field-name"
                  aria-expanded={open}
                  onClick={() => props.onEdit(open ? null : f.id)}
                >
                  {f.name}
                </button>
                <div class="caption">{ruleText(f)}</div>
                <div class="field-value" data-field={f.name}>
                  {r && r.value !== null ? r.csv : <span class="muted">{S.mapper.noValue}</span>}
                </div>
              </div>
              <button
                type="button"
                class="btn btn-small"
                aria-pressed={props.repick === f.id}
                onClick={() => props.onRepick(f.id)}
                aria-label={`${S.mapper.repick} ${f.name}`}
              >
                {S.mapper.repick}
              </button>
              <button
                type="button"
                class="icon-btn"
                title={S.mapper.removeField(f.name)}
                aria-label={S.mapper.removeField(f.name)}
                onClick={() => props.onRemove(f.id)}
              >
                <XIcon size={16} />
              </button>
            </div>
            {props.repick === f.id ? <p class="caption">{S.mapper.repickHint}</p> : null}
            {open ? (
              <FieldEditor
                field={f}
                onChange={props.onChange}
                onRemove={() => props.onRemove(f.id)}
                onDone={() => props.onEdit(null)}
                onRegion={(on) => props.onRegion(f.id, on)}
              />
            ) : null}
          </div>
        );
      })}
      {props.suggestions.length ? (
        <div class="stack" aria-labelledby="suggestions-title" role="group">
          <div class="row spread">
            <h3 id="suggestions-title" class="card-subtitle">
              {S.mapper.suggestionsCount(props.suggestions.length)}
            </h3>
            {props.suggestions.length > 1 ? (
              <button type="button" class="btn btn-small" onClick={props.onAcceptAll}>
                <CheckIcon size={14} />
                {S.mapper.acceptAll}
              </button>
            ) : null}
          </div>
          {props.suggestions.map((s) => (
            <div
              class={`field-row suggested${props.hot === s.rule.id ? ' hot' : ''}`}
              key={s.rule.id}
              onMouseEnter={() => props.onHot(s.rule.id)}
              onMouseLeave={() => props.onHot(null)}
            >
              <div class="grow">
                <span class="field-name">{s.rule.name}</span>
                <div class="caption">{ruleText(s.rule)}</div>
                <div class="field-value">{s.value}</div>
              </div>
              <div class="row-actions">
                <button
                  type="button"
                  class="btn btn-small"
                  onClick={() => props.onAccept(s)}
                  aria-label={`${S.common.accept} ${s.rule.name}`}
                >
                  <CheckIcon size={14} />
                  {S.common.accept}
                </button>
                <button
                  type="button"
                  class="btn btn-small btn-text"
                  onClick={() => props.onDismiss(s)}
                  aria-label={`${S.common.dismiss} ${s.rule.name}`}
                >
                  {S.common.dismiss}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {unused.length ? (
        <label class="field">
          {S.mapper.addField}
          <select
            value=""
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v) props.onAddPreset(v);
            }}
          >
            <option value="">{S.common.none}</option>
            {unused.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </section>
  );
}

function FieldEditor({
  field: f,
  onChange,
  onRemove,
  onDone,
  onRegion,
}: {
  field: FieldRule;
  onChange: (f: FieldRule) => void;
  onRemove: () => void;
  onDone: () => void;
  onRegion: (on: boolean) => void;
}) {
  const set = (patch: Partial<FieldRule>) => onChange({ ...f, ...patch });
  const id = (k: string) => `fe-${f.id}-${k}`;
  const el = useRef<HTMLDivElement>(null);
  // Bring the editor into view when it opens, e.g. after clicking a value on the page.
  useEffect(() => {
    el.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [f.id]);
  return (
    <div ref={el} class="card stack" role="group" aria-label={`${S.mapper.editor.title} ${f.name}`}>
      <div class="grid-2">
        <label class="field" for={id('name')}>
          {S.mapper.editor.name}
          <input
            id={id('name')}
            type="text"
            class="mono"
            list="preset-names"
            value={f.name}
            onInput={(e) =>
              set({ name: (e.target as HTMLInputElement).value.replace(/[^\w]/g, '') })
            }
          />
        </label>
        <label class="field">
          {S.mapper.editor.type}
          <select
            value={f.type ?? 'text'}
            onChange={(e) =>
              set({ type: (e.target as HTMLSelectElement).value as FieldRule['type'] })
            }
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {S.options.type[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <datalist id="preset-names">
        {PRESETS.map((p) => (
          <option key={p.name} value={p.name} />
        ))}
      </datalist>
      {f.type === 'date' ? (
        <label class="field">
          {S.mapper.editor.dateFormats}
          <input
            type="text"
            class="mono"
            value={(f.dateFormats ?? ['DD/MM/YYYY']).join(', ')}
            onInput={(e) => set({ dateFormats: list((e.target as HTMLInputElement).value) })}
          />
        </label>
      ) : null}
      <label class="check">
        <input
          type="checkbox"
          checked={!!f.required}
          onChange={(e) => set({ required: (e.target as HTMLInputElement).checked })}
        />
        {S.mapper.editor.required}
      </label>
      <details class="more">
        <summary>{S.mapper.editor.more}</summary>
        <div class="stack">
          <fieldset class="stack">
            <legend class="field">{S.mapper.editor.labels}</legend>
            {f.anchor.labels.map((l, i) => (
              <div class="row" key={i}>
                <input
                  type="text"
                  class="grow"
                  aria-label={`${S.mapper.editor.labels} ${i + 1}`}
                  value={l}
                  onInput={(e) => {
                    const labels = [...f.anchor.labels];
                    labels[i] = (e.target as HTMLInputElement).value;
                    set({ anchor: { ...f.anchor, labels } });
                  }}
                />
                {f.anchor.labels.length > 1 ? (
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={S.mapper.editor.removeLabel(l)}
                    onClick={() =>
                      set({
                        anchor: { ...f.anchor, labels: f.anchor.labels.filter((_, k) => k !== i) },
                      })
                    }
                  >
                    <XIcon size={14} />
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              class="btn btn-dashed"
              onClick={() => set({ anchor: { ...f.anchor, labels: [...f.anchor.labels, ''] } })}
            >
              {S.mapper.editor.addLabel}
            </button>
          </fieldset>
          <div class="grid-2">
            <label class="field">
              {S.mapper.editor.match}
              <select
                value={f.anchor.match ?? 'exact'}
                onChange={(e) =>
                  set({
                    anchor: {
                      ...f.anchor,
                      match: (e.target as HTMLSelectElement).value as FieldRule['anchor']['match'],
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
            <label class="field">
              {S.mapper.editor.direction}
              <select
                value={f.direction ?? 'right'}
                onChange={(e) =>
                  set({
                    direction: (e.target as HTMLSelectElement).value as FieldRule['direction'],
                  })
                }
              >
                {DIRECTIONS.map((m) => (
                  <option key={m} value={m}>
                    {S.options.direction[m]}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              {S.mapper.editor.take}
              <input
                type="text"
                class="mono"
                list="take-options"
                value={f.take ?? ''}
                onInput={(e) => set({ take: (e.target as HTMLInputElement).value || undefined })}
              />
            </label>
            <datalist id="take-options">
              {['token', 'phrase', 'rest-of-line', 'until-gap', 'tokens:2', 'tokens:3'].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <label class="field">
              {S.mapper.editor.pattern}
              <input
                type="text"
                class="mono"
                value={f.pattern ?? ''}
                onInput={(e) => set({ pattern: (e.target as HTMLInputElement).value || undefined })}
              />
            </label>
            <label class="field">
              {S.mapper.editor.page}
              <input
                type="text"
                value={selValue(f.page)}
                placeholder={S.options.pageAny}
                onInput={(e) =>
                  set({ page: parseSel((e.target as HTMLInputElement).value) as FieldRule['page'] })
                }
              />
            </label>
            <label class="field">
              {S.mapper.editor.occurrence}
              <input
                type="text"
                value={selValue(f.occurrence)}
                placeholder={S.options.occurrenceFirst}
                onInput={(e) =>
                  set({
                    occurrence: parseSel(
                      (e.target as HTMLInputElement).value,
                    ) as FieldRule['occurrence'],
                  })
                }
              />
            </label>
          </div>
          <label class="field">
            {S.mapper.editor.cleaners}
            <input
              type="text"
              class="mono"
              value={(f.clean ?? []).filter((c) => typeof c === 'string').join(', ')}
              onInput={(e) => {
                const v = list((e.target as HTMLInputElement).value);
                set({ clean: v.length ? v : undefined });
              }}
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={!!f.region}
              onChange={(e) => onRegion((e.target as HTMLInputElement).checked)}
            />
            {S.mapper.editor.useRegion}
          </label>
          {f.region ? <p class="caption">{S.mapper.editor.regionSet}</p> : null}
        </div>
      </details>
      <div class="row">
        <button type="button" class="btn" onClick={onDone}>
          {S.mapper.editor.done}
        </button>
        <button type="button" class="btn btn-danger" onClick={onRemove}>
          {S.mapper.editor.remove}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- table

/** Choices for a clicked line of a mapped table. */
export function LinePanel({
  text,
  group,
  column,
  onGroup,
  onSkip,
  onColumn,
  onEnd,
  onHeader,
  onClose,
}: {
  text: string;
  group: { name: string; value: string };
  /** Text from the clicked word to the end of its phrase, when a column can start there. */
  column: string | null;
  onGroup: () => void;
  onSkip: () => void;
  onColumn: () => void;
  onEnd: () => void;
  onHeader: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [text]);
  return (
    <section ref={ref} class="card stack" aria-labelledby="line-title">
      <div class="card-head">
        <h2 id="line-title" class="card-title">
          {S.mapper.table.lineTitle}
        </h2>
        <button type="button" class="icon-btn" aria-label={S.common.close} onClick={onClose}>
          <XIcon size={14} />
        </button>
      </div>
      <p class="mono small line-text">{text}</p>
      <div class="stack line-choices">
        <button type="button" class="btn" onClick={onGroup}>
          {S.mapper.table.asGroup(group.name, group.value)}
        </button>
        <button type="button" class="btn" onClick={onSkip}>
          {S.mapper.table.asSkip}
        </button>
        {column ? (
          <button type="button" class="btn" onClick={onColumn}>
            {S.mapper.table.asColumn(column)}
          </button>
        ) : null}
        <button type="button" class="btn" onClick={onEnd}>
          {S.mapper.table.asEnd}
        </button>
        <button type="button" class="btn btn-text" onClick={onHeader}>
          {S.mapper.table.asHeader}
        </button>
      </div>
      <p class="caption">{S.mapper.table.lineHint}</p>
    </section>
  );
}

export function TablePanel({
  table,
  rows,
  onChange,
  onRemove,
  onRemoveColumn,
}: {
  table: TableRule | undefined;
  rows: number;
  onChange: (t: TableRule) => void;
  onRemove: () => void;
  onRemoveColumn: (name: string) => void;
}) {
  if (!table) {
    return (
      <section class="card stack" aria-labelledby="table-title">
        <h2 id="table-title" class="card-title">
          {S.mapper.table.title}
        </h2>
        <p class="muted small">{S.mapper.table.none}</p>
      </section>
    );
  }
  const set = (patch: Partial<TableRule>) => onChange({ ...table, ...patch });
  return (
    <section class="card stack" aria-labelledby="table-title">
      <div class="card-head">
        <h2 id="table-title" class="card-title">
          {S.mapper.table.title}
        </h2>
        <span class="chip chip-accent">{S.mapper.table.rowsFound(rows)}</span>
      </div>
      <label class="field">
        {S.mapper.table.name}
        <input
          type="text"
          class="mono"
          value={table.name}
          onInput={(e) => set({ name: (e.target as HTMLInputElement).value.replace(/[^\w]/g, '') })}
        />
      </label>
      <label class="field">
        {S.mapper.table.header}
        <input
          type="text"
          value={table.header.labels.join(', ')}
          onInput={(e) =>
            set({ header: { ...table.header, labels: list((e.target as HTMLInputElement).value) } })
          }
        />
      </label>
      <fieldset class="stack">
        <legend class="field">{S.mapper.table.columns(table.columns.length)}</legend>
        <div class="table-wrap" tabIndex={0}>
          <table class="data">
            <thead>
              <tr>
                <th scope="col">{S.mapper.table.colName}</th>
                <th scope="col">{S.mapper.table.colType}</th>
                <th scope="col">{S.mapper.table.colRequired}</th>
                <th scope="col">
                  <span class="sr-only">{S.common.remove}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((c, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="text"
                      aria-label={`${S.mapper.table.colName} ${c.header}`}
                      value={c.name}
                      onInput={(e) => {
                        const columns = [...table.columns];
                        const oldName = c.name;
                        const name = (e.target as HTMLInputElement).value.replace(/[^\w]/g, '');
                        columns[i] = { ...c, name };
                        const rowStart =
                          table.rowStart?.column === oldName
                            ? { ...table.rowStart, column: name }
                            : table.rowStart;
                        set({ columns, ...(rowStart ? { rowStart } : {}) });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`${S.mapper.table.colType} ${c.header}`}
                      value={c.type ?? 'text'}
                      onChange={(e) => {
                        const columns = [...table.columns];
                        columns[i] = {
                          ...c,
                          type: (e.target as HTMLSelectElement).value as FieldRule['type'],
                        };
                        set({ columns });
                      }}
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {S.options.type[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${S.mapper.table.colRequired} ${c.header}`}
                      checked={!!c.required}
                      onChange={(e) => {
                        const columns = [...table.columns];
                        columns[i] = { ...c, required: (e.target as HTMLInputElement).checked };
                        set({ columns });
                      }}
                    />
                  </td>
                  <td>
                    {table.columns.length > 1 ? (
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label={S.mapper.table.removeColumn(c.name)}
                        onClick={() => onRemoveColumn(c.name)}
                      >
                        <XIcon size={14} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <div class="grid-2">
        <label class="field">
          {`${S.mapper.table.rowStart}: ${S.mapper.table.rowStartColumn}`}
          <select
            value={table.rowStart?.column ?? ''}
            onChange={(e) =>
              set({
                rowStart: {
                  column: (e.target as HTMLSelectElement).value,
                  pattern: table.rowStart?.pattern ?? '\\S',
                },
              })
            }
          >
            {table.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          {S.mapper.table.rowStartPattern}
          <input
            type="text"
            class="mono"
            value={table.rowStart?.pattern ?? ''}
            onInput={(e) =>
              set({
                rowStart: {
                  column: table.rowStart?.column ?? table.columns[0]!.name,
                  pattern: (e.target as HTMLInputElement).value,
                },
              })
            }
          />
        </label>
      </div>
      <label class="field">
        {S.mapper.table.end}
        <input
          type="text"
          value={table.end?.labels.join(', ') ?? ''}
          onInput={(e) => {
            const labels = list((e.target as HTMLInputElement).value);
            const { end: _e, ...rest } = table;
            onChange(
              labels.length
                ? { ...rest, end: { labels, match: table.end?.match ?? 'starts-with' } }
                : rest,
            );
          }}
        />
        <span class="caption">{S.mapper.table.endHint}</span>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={table.continuesOnNextPage ?? true}
          onChange={(e) => set({ continuesOnNextPage: (e.target as HTMLInputElement).checked })}
        />
        {S.mapper.table.continues}
      </label>
      <label class="field">
        {S.mapper.table.wrapped}
        <select
          value={table.wrappedLines ?? 'join'}
          onChange={(e) =>
            set({ wrappedLines: (e.target as HTMLSelectElement).value as 'join' | 'ignore' })
          }
        >
          <option value="join">{S.mapper.table.wrappedJoin}</option>
          <option value="ignore">{S.mapper.table.wrappedIgnore}</option>
        </select>
      </label>
      <label class="field">
        {S.mapper.table.skip}
        <textarea
          class="mono"
          value={(table.skip ?? []).join('\n')}
          onInput={(e) => set({ skip: lines((e.target as HTMLTextAreaElement).value) })}
        />
      </label>
      <fieldset class="stack">
        <legend class="field">{S.mapper.table.groups}</legend>
        {(table.groups ?? []).map((g, i) => (
          <div class="row group-row" key={i}>
            <input
              type="text"
              aria-label={S.mapper.table.groupName}
              value={g.name}
              onInput={(e) => {
                const groups = [...(table.groups ?? [])];
                groups[i] = {
                  ...g,
                  name: (e.target as HTMLInputElement).value.replace(/[^\w]/g, ''),
                };
                set({ groups });
              }}
            />
            <input
              type="text"
              class="mono"
              aria-label={S.mapper.table.groupPattern}
              value={g.pattern}
              onInput={(e) => {
                const groups = [...(table.groups ?? [])];
                groups[i] = {
                  ...g,
                  pattern: (e.target as HTMLInputElement).value,
                  capture: /\(/.test((e.target as HTMLInputElement).value) ? 1 : 0,
                };
                set({ groups });
              }}
            />
            <button
              type="button"
              class="icon-btn"
              aria-label={S.mapper.table.removeGroup(g.name)}
              onClick={() => set({ groups: (table.groups ?? []).filter((_, k) => k !== i) })}
            >
              <XIcon size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          class="btn btn-dashed"
          onClick={() =>
            set({
              groups: [
                ...(table.groups ?? []),
                { name: 'Group', pattern: '^Group (.+)$', capture: 1 },
              ],
            })
          }
        >
          {S.mapper.table.addGroup}
        </button>
      </fieldset>
      <div class="row">
        <button type="button" class="btn btn-danger" onClick={onRemove}>
          {S.mapper.table.remove}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- checks

export function ChecksPanel({
  draft,
  result,
  onChange,
}: {
  draft: Template;
  result: Extraction | null;
  onChange: (checks: CheckRule[]) => void;
}) {
  const [expr, setExpr] = useState('');
  const [label, setLabel] = useState('');
  const [severity, setSeverity] = useState<'error' | 'warning'>('error');
  const defaults = useMemo(() => defaultChecks(draft), [draft]);
  const checks = draft.checks ?? [];
  const known = {
    fields: draft.fields.map((f) => f.name),
    tables: Object.fromEntries(
      (draft.tables ?? []).map((t) => [t.name, t.columns.map((c) => c.name)]),
    ),
  };
  const error = expr.trim() ? validateExpr(expr, known) : null;
  const custom = checks.filter((c) => !defaults.some((d) => d.expr === c.expr));
  const resultFor = (c: CheckRule) => result?.checks.find((r) => r.id === c.id)?.result;
  return (
    <section class="card stack" aria-labelledby="checks-title">
      <h2 id="checks-title" class="card-title">
        {S.mapper.checks.title}
      </h2>
      {defaults.map((d) => {
        const on = checks.find((c) => c.expr === d.expr);
        return (
          <label class="check" key={d.id}>
            <input
              type="checkbox"
              checked={!!on}
              onChange={(e) =>
                onChange(
                  (e.target as HTMLInputElement).checked
                    ? [...checks, d]
                    : checks.filter((c) => c.expr !== d.expr),
                )
              }
            />
            <span class="grow">
              {d.label} <span class="caption mono">{d.expr}</span>
            </span>
            {on && resultFor(on) ? <CheckResultChip result={resultFor(on)!} /> : null}
          </label>
        );
      })}
      {custom.map((c) => (
        <div class="field-row" key={c.id}>
          <div class="grow">
            <div>{c.label}</div>
            <div class="caption mono">{c.expr}</div>
          </div>
          {resultFor(c) ? <CheckResultChip result={resultFor(c)!} /> : null}
          <button
            type="button"
            class="icon-btn"
            aria-label={`${S.common.remove} ${c.label}`}
            onClick={() => onChange(checks.filter((x) => x.id !== c.id))}
          >
            <XIcon size={14} />
          </button>
        </div>
      ))}
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (error || !expr.trim()) return;
          onChange([
            ...checks,
            {
              id: `c${Date.now().toString(36)}`,
              label: label.trim() || expr.trim(),
              expr: expr.trim(),
              severity,
              tolerance: 0.01,
            },
          ]);
          setExpr('');
          setLabel('');
        }}
      >
        <label class="field">
          {S.mapper.checks.expr}
          <input
            type="text"
            class="mono"
            placeholder={S.mapper.checks.addPlaceholder}
            value={expr}
            aria-invalid={!!error}
            aria-describedby="check-msg"
            onInput={(e) => setExpr((e.target as HTMLInputElement).value)}
          />
        </label>
        <span id="check-msg" class={error ? 'error-text' : 'caption'} aria-live="polite">
          {error ?? (expr.trim() ? S.mapper.checks.valid : '')}
        </span>
        <div class="grid-2">
          <label class="field">
            {S.mapper.checks.label}
            <input
              type="text"
              value={label}
              onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            {S.mapper.checks.severity}
            <select
              value={severity}
              onChange={(e) =>
                setSeverity((e.target as HTMLSelectElement).value as 'error' | 'warning')
              }
            >
              <option value="error">{S.options.severity.error}</option>
              <option value="warning">{S.options.severity.warning}</option>
            </select>
          </label>
        </div>
        <div class="row">
          <button type="submit" class="btn" disabled={!!error || !expr.trim()}>
            {S.mapper.checks.add}
          </button>
        </div>
      </form>
    </section>
  );
}

function CheckResultChip({ result }: { result: 'pass' | 'fail' | 'unknown' }) {
  return (
    <span
      class={`chip chip-${result === 'pass' ? 'success' : result === 'fail' ? 'danger' : 'warn'}`}
    >
      {result === 'pass' ? <CheckIcon size={12} /> : <XIcon size={12} />}
      {result === 'pass' ? S.common.pass : S.common.fail}
    </span>
  );
}

// ---------------------------------------------------------------- fingerprint

export function FingerprintPanel({
  draft,
  onChange,
}: {
  draft: Template;
  onChange: (fp: Template['fingerprint']) => void;
}) {
  const fp = draft.fingerprint;
  return (
    <section class="card stack" aria-labelledby="fp-title">
      <h2 id="fp-title" class="card-title">
        {S.mapper.fingerprint.title}
      </h2>
      <label class="field">
        {S.mapper.fingerprint.mustContain}
        <textarea
          value={fp.mustContain.join('\n')}
          onInput={(e) =>
            onChange({ ...fp, mustContain: lines((e.target as HTMLTextAreaElement).value) })
          }
        />
      </label>
      <label class="field">
        {S.mapper.fingerprint.mustNotContain}
        <textarea
          value={(fp.mustNotContain ?? []).join('\n')}
          onInput={(e) =>
            onChange({ ...fp, mustNotContain: lines((e.target as HTMLTextAreaElement).value) })
          }
        />
      </label>
      <label class="field">
        {S.mapper.fingerprint.abn}
        <input
          type="text"
          class="mono"
          value={fp.abn ?? ''}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            const { abn: _a, ...rest } = fp;
            onChange(v ? { ...rest, abn: v } : rest);
          }}
        />
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={!!fp.anyPage}
          onChange={(e) => onChange({ ...fp, anyPage: (e.target as HTMLInputElement).checked })}
        />
        {S.mapper.fingerprint.anyPage}
      </label>
    </section>
  );
}

// ---------------------------------------------------------------- preview

export function PreviewPanel({ csv }: { csv: string | null }) {
  const rows = csv ? parseCsv(csv).filter((r) => r.length > 1 || r[0]) : [];
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const visible = header.filter((h) => !h.startsWith('_'));
  return (
    <section class="card stack" aria-labelledby="preview-title">
      <div class="card-head">
        <h2 id="preview-title" class="card-title">
          {S.mapper.preview.title}
        </h2>
        {csv ? <span class="caption">{S.mapper.preview.rows(body.length)}</span> : null}
      </div>
      {!csv || !visible.length ? (
        <p class="muted small">{S.mapper.preview.empty}</p>
      ) : (
        <div class="table-wrap" tabIndex={0}>
          <table class="data mono" aria-label={S.mapper.preview.title}>
            <thead>
              <tr>
                {visible.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.slice(0, 5).map((r, i) => (
                <tr key={i}>
                  {visible.map((h) => (
                    <td key={h}>{r[header.indexOf(h)]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export { humanize };
