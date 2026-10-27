// Table settings in plain words: how rows start, which lines are skipped, which
// lines are headings. Patterns are written for the user; the raw patterns stay
// available under "Edit as patterns" for anything the plain choices can't say.
import type { GroupRule, TableResult, TableRule } from '@pdfx/engine';
import { S } from '../strings';
import {
  headingRule,
  readPattern,
  readRowStart,
  rowStartPattern,
  skipPattern,
  type LinePattern,
  type RowStart,
} from '../lib/rules';
import { XIcon } from '../components/Icons';

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

type Kind = LinePattern['kind'];
const needsText = (k: Kind) => k === 'startsWith' || k === 'exactly';

/** A choice of kind of line, with text for "starts with" and "reads exactly". */
function LineChoice({
  value,
  kinds,
  label,
  onChange,
}: {
  value: LinePattern;
  kinds: Kind[];
  label: string;
  onChange: (m: LinePattern) => void;
}) {
  const shown = value.kind === 'pattern' ? [...kinds, 'pattern' as const] : kinds;
  const text = value.kind === 'startsWith' || value.kind === 'exactly' ? value.text : '';
  return (
    <>
      <select
        aria-label={S.mapper.settings.kindOf(label)}
        value={value.kind}
        onChange={(e) => {
          const k = (e.target as HTMLSelectElement).value as Kind;
          onChange(
            k === 'startsWith' || k === 'exactly'
              ? { kind: k, text }
              : k === 'pattern'
                ? { kind: 'pattern', pattern: value.kind === 'pattern' ? value.pattern : '' }
                : { kind: k },
          );
        }}
      >
        {shown.map((k) => (
          <option key={k} value={k}>
            {S.mapper.settings.kinds[k]}
          </option>
        ))}
      </select>
      {needsText(value.kind) ? (
        <input
          type="text"
          aria-label={S.mapper.settings.textOf(label)}
          value={text}
          onInput={(e) =>
            onChange({
              kind: value.kind as 'startsWith' | 'exactly',
              text: (e.target as HTMLInputElement).value,
            })
          }
        />
      ) : value.kind === 'pattern' ? (
        <input
          type="text"
          class="mono"
          aria-label={S.mapper.settings.patternOf(label)}
          value={value.pattern}
          onInput={(e) =>
            onChange({ kind: 'pattern', pattern: (e.target as HTMLInputElement).value })
          }
        />
      ) : (
        <span />
      )}
    </>
  );
}

/** The shape of a value: digits become 9, so "SVC101A" reads "SVC999A". */
const shapeOf = (v: string) => v.trim().replace(/\d/g, '9');

export function TableSettings({
  table,
  result,
  onChange,
}: {
  table: TableRule;
  result: TableResult | undefined;
  onChange: (t: TableRule) => void;
}) {
  const set = (patch: Partial<TableRule>) => onChange({ ...table, ...patch });
  const column = table.rowStart?.column ?? table.columns[0]!.name;
  const start = readRowStart(table.rowStart?.pattern ?? '\\S');
  const firstValue = result?.rows[0]?.cells[column]?.raw ?? '';
  const setStart = (r: RowStart, col = column) =>
    set({ rowStart: { column: col, pattern: rowStartPattern(r) } });
  const skips = (table.skip ?? []).map(readPattern);
  const groups = table.groups ?? [];
  const setGroup = (i: number, g: GroupRule) =>
    set({ groups: groups.map((x, j) => (j === i ? g : x)) });

  return (
    <div class="stack">
      <label class="field">
        {S.mapper.settings.header}
        <input
          type="text"
          value={table.header.labels.join(', ')}
          onInput={(e) =>
            set({
              header: { ...table.header, labels: list((e.target as HTMLInputElement).value) },
            })
          }
        />
        <span class="caption">{S.mapper.settings.headerHint}</span>
      </label>

      <fieldset class="stack settings-group">
        <legend class="field">{S.mapper.settings.rowStart}</legend>
        <div class="settings-row">
          <select
            aria-label={S.mapper.settings.rowStartColumn}
            value={column}
            onChange={(e) => setStart(start, (e.target as HTMLSelectElement).value)}
          >
            {table.columns
              .filter((c) => !c.partOf)
              .map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
          </select>
          <select
            aria-label={S.mapper.settings.rowStartHow}
            value={start.kind}
            onChange={(e) => {
              const k = (e.target as HTMLSelectElement).value as RowStart['kind'];
              setStart(
                k === 'any'
                  ? { kind: 'any' }
                  : k === 'shape'
                    ? { kind: 'shape', example: shapeOf(firstValue) || '99/99/9999' }
                    : k === 'startsWith'
                      ? { kind: 'startsWith', text: firstValue.trim().split(/\s+/)[0] ?? '' }
                      : { kind: 'pattern', pattern: table.rowStart?.pattern ?? '\\S' },
              );
            }}
          >
            <option value="any">{S.mapper.settings.rowAny}</option>
            <option value="shape">{S.mapper.settings.rowShape}</option>
            <option value="startsWith">{S.mapper.settings.rowStarts}</option>
            {start.kind === 'pattern' ? (
              <option value="pattern">{S.mapper.settings.kinds.pattern}</option>
            ) : null}
          </select>
          {start.kind === 'shape' ? (
            <input
              type="text"
              class="mono"
              aria-label={S.mapper.settings.rowShapeExample}
              value={start.example}
              onInput={(e) =>
                setStart({ kind: 'shape', example: (e.target as HTMLInputElement).value })
              }
            />
          ) : start.kind === 'startsWith' ? (
            <input
              type="text"
              aria-label={S.mapper.settings.rowStartsText}
              value={start.text}
              onInput={(e) =>
                setStart({ kind: 'startsWith', text: (e.target as HTMLInputElement).value })
              }
            />
          ) : start.kind === 'pattern' ? (
            <input
              type="text"
              class="mono"
              aria-label={S.mapper.settings.patternOf(S.mapper.settings.rowStart)}
              value={start.pattern}
              onInput={(e) =>
                setStart({ kind: 'pattern', pattern: (e.target as HTMLInputElement).value })
              }
            />
          ) : (
            <span />
          )}
        </div>
        <p class="caption">{S.mapper.settings.rowStartHint}</p>
      </fieldset>

      <label class="field">
        {S.mapper.settings.end}
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
        <span class="caption">{S.mapper.settings.endHint}</span>
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

      <fieldset class="stack settings-group">
        <legend class="field">{S.mapper.settings.skip}</legend>
        {skips.map((m, i) => (
          <div class="settings-row" key={i}>
            <LineChoice
              value={m}
              label={S.mapper.settings.skipN(i + 1)}
              kinds={['startsWith', 'exactly', 'pageNumbers', 'capitals', 'words']}
              onChange={(next) =>
                set({ skip: (table.skip ?? []).map((p, j) => (j === i ? skipPattern(next) : p)) })
              }
            />
            <button
              type="button"
              class="icon-btn"
              aria-label={S.mapper.settings.removeSkip(i + 1)}
              onClick={() => set({ skip: (table.skip ?? []).filter((_, j) => j !== i) })}
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
              skip: [...(table.skip ?? []), skipPattern({ kind: 'startsWith', text: 'Total' })],
            })
          }
        >
          {S.mapper.settings.addSkip}
        </button>
      </fieldset>

      <fieldset class="stack settings-group">
        <legend class="field">{S.mapper.settings.headings}</legend>
        {groups.map((g, i) => (
          <div class="settings-row settings-row-heading" key={i}>
            <input
              type="text"
              aria-label={S.mapper.table.groupName}
              value={g.name}
              onInput={(e) =>
                setGroup(i, {
                  ...g,
                  name: (e.target as HTMLInputElement).value.replace(/[^\w]/g, ''),
                })
              }
            />
            <LineChoice
              value={readPattern(g.pattern)}
              label={g.name}
              kinds={['startsWith', 'exactly', 'capitals', 'words']}
              onChange={(next) => {
                const r = headingRule(g.name, next);
                setGroup(i, { ...r, ...(g.x0 !== undefined ? { x0: g.x0 } : {}) });
              }}
            />
            <button
              type="button"
              class="icon-btn"
              aria-label={S.mapper.table.removeGroup(g.name)}
              onClick={() => set({ groups: groups.filter((_, j) => j !== i) })}
            >
              <XIcon size={14} />
            </button>
          </div>
        ))}
        <p class="caption">{S.mapper.settings.headingsHint}</p>
        <button
          type="button"
          class="btn btn-dashed"
          onClick={() => {
            const taken = new Set([
              ...table.columns.map((c) => c.name),
              ...groups.map((g) => g.name),
            ]);
            let name = 'Heading';
            for (let n = 2; taken.has(name); n++) name = `Heading${n}`;
            set({ groups: [...groups, headingRule(name, { kind: 'startsWith', text: name })] });
          }}
        >
          {S.mapper.table.addGroup}
        </button>
      </fieldset>

      <details class="settings-raw">
        <summary>{S.mapper.settings.raw}</summary>
        <p class="caption">{S.mapper.settings.rawHint}</p>
        <label class="field">
          {S.mapper.table.skip}
          <textarea
            class="mono"
            value={(table.skip ?? []).join('\n')}
            onInput={(e) =>
              set({
                skip: (e.target as HTMLTextAreaElement).value
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        {groups.map((g, i) => (
          <label class="field" key={i}>
            {S.mapper.settings.patternOf(g.name)}
            <input
              type="text"
              class="mono"
              value={g.pattern}
              onInput={(e) => {
                const pattern = (e.target as HTMLInputElement).value;
                setGroup(i, { ...g, pattern, capture: /\(/.test(pattern) ? 1 : 0 });
              }}
            />
          </label>
        ))}
      </details>
    </div>
  );
}
