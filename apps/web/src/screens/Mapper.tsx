import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  PRESETS,
  addBreak,
  buildLayout,
  inferField,
  groupFor,
  findHeaderOnPage,
  inferTable,
  looksLikeHeader,
  moveBreak,
  outputGrid,
  parseTemplate,
  phrases,
  removeBreak,
  suggestFields,
  suggestFingerprint,
  skipPatternFor,
  suggestTable,
  tableFrame,
  toCsv,
  valueTokens,
  type BBox,
  type Line,
  type SourceBox,
  type FieldRule,
  type InferredField,
  type PageText,
  type TableRule,
  type Template,
  type Token,
} from '@pdfx/engine';
import { S } from '../strings';
import { app, useApp } from '../app/store';
import { navigate, useRoute } from '../app/router';
import { now, refresh } from '../app/session';
import {
  Banner,
  Dialog,
  DropZone,
  Segmented,
  fileBytes,
  timeHM,
  toast,
  ActionButton,
  downloadBlob,
} from '../components/ui';
import { usePreview } from '../lib/preview';
import { OutputDock } from './MapperOutput';
import { PageView, usePdf, type Mark, type Ruler, type Zoom } from '../components/PageView';
import { documentText } from '../lib/pipeline';
import { idbDel, idbGet, idbSet } from '../lib/idb';
import { DIRS, join, slugify, stem } from '../workspace/paths';
import {
  addSample,
  heldBy,
  loadDraft,
  saveDraft,
  saveVersion,
  sampleBytes,
  takeLock,
  discardDraft,
  type Draft,
  type Lock,
} from '../workspace/store';
import { ChecksPanel, FieldsPanel, FingerprintPanel, LineMenu, TablePanel } from './MapperPanels';

/** True when the middle of a word lies inside a box (with a point of slack). */
function inBox(t: Token, b: BBox): boolean {
  const cx = (t.x0 + t.x1) / 2;
  const cy = (t.y0 + t.y1) / 2;
  return cx >= b[0] - 1 && cx <= b[2] + 1 && cy >= b[1] - 1 && cy <= b[3] + 1;
}

/** Words in reading order: top to bottom, then left to right. */
const byReading = (a: Token, b: Token) =>
  Math.abs(a.y0 - b.y0) > Math.min(a.height, b.height) / 2 ? a.y0 - b.y0 : a.x0 - b.x0;

function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function emptyTemplate(id: string, name: string, fp: Template['fingerprint']): Template {
  return {
    schema: 'pdfx.template/1',
    id,
    name,
    version: 0,
    fingerprint: fp,
    settings: { confidenceThreshold: 0.8, ocr: 'auto', decimal: '.' },
    fields: [],
    tables: [],
    checks: [],
  };
}

export function MapperScreen() {
  const s = useApp();
  const route = useRoute();
  const [draft, setDraftState] = useState<Template | null>(null);
  const [latestVersion, setLatestVersion] = useState(0);
  const [sample, setSample] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pages, setPages] = useState<PageText[] | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [selected, setSelected] = useState<Token[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [repick, setRepick] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [resume, setResume] = useState<Draft | null>(null);
  const [lock, setLock] = useState<Lock | null>(null);
  const [message, setMessage] = useState<{
    tone: 'success' | 'warn' | 'danger';
    text: string;
    list?: string[];
  } | null>(null);
  const [changing, setChanging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  // A field or suggestion pointed at in the list, outlined on the page.
  const [hot, setHot] = useState<string | null>(null);
  // A word clicked on a line of the mapped table, waiting for "what is this line?".
  const [lineAt, setLineAt] = useState<Token | null>(null);
  // "Choose the header row": the next click on the page starts the table there.
  const [pickHeader, setPickHeader] = useState(false);
  // The exception this template was created from, offered for a re-run after saving.
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  // Id of a template this screen just created; its route change needs no reload.
  const created = useRef<string | null>(null);
  // The latest draft, for undo actions that run after later edits.
  const latest = useRef<Template | null>(null);
  // Earlier and undone drafts, for Undo and Redo.
  const history = useRef<{ past: Template[]; future: Template[]; at: number }>({
    past: [],
    future: [],
    at: 0,
  });
  const [, setHistoryTick] = useState(0);
  // Which line "Show" jumps to next, among those that aren't part of any row.
  const unplacedAt = useRef(0);
  // Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) outside text boxes, which keep their own undo.
  const keys = useRef<{ undo: () => void; redo: () => void } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) keys.current?.undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) keys.current?.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pdf = usePdf(sample?.bytes ?? null);

  const ws = s.ws;
  const layout = useMemo(() => (pages ? buildLayout({ pages }) : null), [pages]);

  /** Updates the draft and autosaves (IndexedDB now, folder after 2 s). */
  const setDraft = (t: Template, persist = true, record = true) => {
    // Typing in quick succession (a name) undoes together; each click is its own step.
    const cur = latest.current;
    if (record && persist && cur && cur !== t && cur.id === t.id) {
      const now = Date.now();
      const typing = !!document.activeElement?.closest(
        'input[type="text"], input:not([type]), textarea',
      );
      if (!typing || now - history.current.at > 700) {
        history.current.past.push(cur);
        if (history.current.past.length > 100) history.current.past.shift();
      }
      history.current.at = typing ? now : 0;
      history.current.future = [];
      setHistoryTick((n) => n + 1);
    }
    latest.current = t;
    setDraftState(t);
    if (!persist || !ws) return;
    const d: Draft = {
      template: t,
      savedAt: new Date().toISOString(),
      ...(sample ? { sample: sample.name } : {}),
    };
    void idbSet(`draft:${t.id}`, d);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveDraft(ws, d).then(() => setSavedAt(timeHM(new Date())));
    }, 2000);
  };
  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const loadSample = async (name: string, bytes: Uint8Array) => {
    setSample({ name, bytes });
    setPages(null);
    setPageNo(1);
    setSelected([]);
    setLoading(true);
    const r = await documentText(bytes, 'auto');
    setLoading(false);
    if (!r.ok) {
      setMessage({ tone: 'danger', text: r.message });
      return null;
    }
    setPages(r.pages);
    return r.pages;
  };

  // Load the template (or start a new one) when the route changes.
  useEffect(() => {
    if (!ws) return;
    if (route.template && route.template === created.current) {
      created.current = null;
      return;
    }
    let alive = true;
    void (async () => {
      setMessage(null);
      setResume(null);
      setLock(null);
      const pending = app.get().pendingSample;
      const id = route.template;
      if (id) {
        const info = app.get().templates.find((t) => t.id === id);
        const folderDraft = await loadDraft(ws, id);
        const mirror = await idbGet<Draft>(`draft:${id}`);
        const newest = [folderDraft, mirror]
          .filter((d): d is Draft => !!d)
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
        if (!info && !newest) {
          setDraftState(null);
          return;
        }
        const other = await heldBy(ws, `template:${id}`, s.user, now());
        if (other) setLock(other);
        else await takeLock(ws, `template:${id}`, s.user, `template:${id}`, now());
        setLatestVersion(info?.latest.version ?? 0);
        const base = info?.latest ?? newest!.template;
        if (!alive) return;
        setDraftState(base);
        if (newest && info) setResume(newest);
        else if (newest) setDraftState(newest.template);
        let bytes: Uint8Array | null = null;
        let name: string;
        if (pending) {
          name = pending.name;
          bytes = pending.bytes;
          app.set({ pendingSample: null });
          await addSample(ws, id, name, bytes);
          await refresh();
        } else {
          const samples = info?.samples ?? [];
          name =
            (newest?.sample && samples.includes(newest.sample) ? newest.sample : samples[0]) ?? '';
          if (name) bytes = await sampleBytes(ws, id, name).catch(() => null);
        }
        if (bytes && alive) await loadSample(name, bytes);
      } else if (pending) {
        app.set({ pendingSample: null });
        const pg = await loadSample(pending.name, pending.bytes);
        if (!pg || !alive) return;
        const l = buildLayout({ pages: pg });
        const fp = suggestFingerprint(l);
        const name = fp.mustContain[0] ? titleCase(fp.mustContain[0]) : stem(pending.name);
        const ids = new Set(app.get().templates.map((t) => t.id));
        let newId = slugify(name);
        for (let n = 2; ids.has(newId) || (await ws.exists(join(DIRS.templates, newId))); n++)
          newId = `${slugify(name)}-${n}`;
        const t = emptyTemplate(newId, name, fp);
        await addSample(ws, newId, pending.name, pending.bytes);
        setLatestVersion(0);
        setDraftState(t);
        await saveDraft(ws, {
          template: t,
          savedAt: new Date().toISOString(),
          sample: pending.name,
        });
        if (pending.fromException) await idbSet(`origin:${newId}`, pending.fromException);
        await refresh();
        await takeLock(ws, `template:${newId}`, s.user, `template:${newId}`, now());
        created.current = newId;
        navigate({ view: 'mapper', template: newId }, true);
      } else {
        setDraftState(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [route.template, ws, nonce]);

  // Long samples extract in the worker; the output and page marks use the newest result.
  // While a long sample is re-extracting, `basis` is the template the shown result came
  // from, so renamed fields and tables keep their marks and output until it catches up.
  const { result, basis, busy } = usePreview(pages, layout, draft, s.settings.confidenceThreshold);
  const grid = useMemo(() => {
    if (!result || !basis) return null;
    try {
      return outputGrid(result, basis);
    } catch {
      return null;
    }
  }, [result, basis]);

  // A value chosen in the output is scrolled into view once its page has rendered.
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (!reveal) return;
    const id = requestAnimationFrame(() =>
      document.querySelector('.tok.tok-selected')?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(id);
  }, [reveal, pageNo]);

  const suggestions = useMemo(() => {
    if (!layout || !draft) return [] as InferredField[];
    return suggestFields(layout, draft.fields).filter((x) => !dismissed.has(x.rule.name));
  }, [layout, draft, dismissed]);

  const tableSuggestion = useMemo(
    () => (layout && draft && !(draft.tables ?? []).length ? suggestTable(layout) : null),
    [layout, draft],
  );

  if (!ws) return null;

  if (!draft) {
    return (
      <>
        <h1 class="page-title">{S.mapper.title}</h1>
        <section class="card stack">
          <p>{route.template ? S.mapper.noTemplate : S.mapper.noSample}</p>
          <DropZone
            multiple={false}
            onFiles={async (f) => {
              app.set({ pendingSample: { name: f[0]!.name, bytes: await fileBytes(f[0]!) } });
              navigate({ view: 'mapper', template: '' }, true);
              setNonce((n) => n + 1);
              setDraftState(null);
            }}
          />
        </section>
      </>
    );
  }

  latest.current = draft;
  const names = draft.fields.map((f) => f.name);
  const table = (draft.tables ?? [])[0];
  const basisTable = basis?.tables?.find((x) => x.id === table?.id) ?? basis?.tables?.[0];
  const tableResult = table && basisTable ? result?.tables[basisTable.name] : undefined;
  const fieldRes = (f: FieldRule) =>
    result?.fields[basis?.fields.find((x) => x.id === f.id)?.name ?? f.name];

  const updateField = (f: FieldRule) =>
    setDraft({ ...draft, fields: draft.fields.map((x) => (x.id === f.id ? f : x)) });
  const setTable = (t: TableRule | null, record = true) =>
    setDraft(
      {
        ...draft,
        tables: t ? [t, ...(draft.tables ?? []).slice(1)] : (draft.tables ?? []).slice(1),
      },
      true,
      record,
    );

  const fieldAt = (t: Token) =>
    draft.fields.find((f) =>
      (fieldRes(f)?.boxes ?? []).some((b) => b.page === t.page && inBox(t, b.bbox)),
    );

  const onToken = (t: Token, shift: boolean) => {
    if (!layout) return;
    if (pickHeader) {
      setPickHeader(false);
      return startTable(t, true);
    }
    if (!repick && !shift) {
      // A line of the mapped table, or a header row before there is a table: ask what it is.
      if (table && inTable(t)) return openLine(t);
      const line = lineOf(t);
      if (!table && line && headerRow(line) && !fieldAt(t)) return openLine(t);
    }
    // A value
    setLineAt(null);
    if (repick) return pick(valueTokens(layout, t));
    if (shift) {
      const sel = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
      setSelected(sel);
      const f = editing ? draft.fields.find((x) => x.id === editing) : undefined;
      if (!f) return pick(sel);
      const inf = inferField(
        layout,
        sel,
        names.filter((n) => n !== f.name),
      );
      if (inf) updateField({ ...inf.rule, id: f.id, name: f.name });
      return;
    }
    // A value that is already mapped opens its field instead of adding it twice.
    const existing = fieldAt(t);
    if (existing) {
      setSelected([]);
      setEditing(existing.id);
      app.announce(S.mapper.opened(existing.name));
      return;
    }
    const sg = suggestions.find((x) => x.rule.hint?.page === t.page && inBox(t, x.rule.hint.bbox));
    if (sg) {
      setSelected([]);
      setDraft({ ...draft, fields: [...draft.fields, sg.rule] });
      setEditing(sg.rule.id);
      app.announce(`${S.common.accept}: ${sg.rule.name}`);
      return;
    }
    pick(valueTokens(layout, t));
  };

  const lineOf = (t: Token) =>
    layout?.pages.find((p) => p.page === t.page)?.lines.find((l) => l.tokens.includes(t));

  /** Where the table's header is; looked up directly while a long sample's preview catches up. */
  const tableHead = (): SourceBox | undefined => {
    if (tableResult?.found) return tableResult.header;
    if (!layout || !table) return undefined;
    for (const p of layout.pages) {
      const h = findHeaderOnPage(p.lines, table, p.page);
      if (h) return { page: h.page, bbox: h.bbox };
    }
    return undefined;
  };
  /** True for words below the table's header and above its end. */
  const inTable = (t: Token) => {
    const h = tableHead();
    if (!h) return false;
    const y = (t.y0 + t.y1) / 2;
    if (t.page < h.page || (t.page === h.page && y < h.bbox[1])) return false;
    const e = tableResult?.end;
    if (e && (t.page > e.page || (t.page === e.page && y > e.bbox[3]))) return false;
    return t.page === h.page || table?.continuesOnNextPage !== false;
  };
  /**
   * A table's header row: the one the app suggested, or three or more text-only
   * columns with no numbers and no "Label:" words (those lines hold values).
   */
  const headerRow = (line: Line) =>
    looksLikeHeader(line) &&
    !/\d/.test(line.text) &&
    !phrases(line).some((p) => /[:#]$/.test(p.text)) &&
    (phrases(line).length >= 3 || line === tableSuggestion?.headerLine);
  const isHeaderAt = (t: Token) => {
    const line = lineOf(t);
    return !!line && headerRow(line) && !fieldAt(t);
  };
  const openLine = (t: Token) => {
    setLineAt(t);
    setSelected(lineOf(t)?.tokens ?? [t]);
    setEditing(null);
  };

  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    const cur = latest.current;
    if (!prev || !cur) return;
    h.future.push(cur);
    h.at = 0;
    setDraft(prev, true, false);
    setLineAt(null);
    setSelected([]);
    setHistoryTick((n) => n + 1);
    app.announce(S.mapper.undone);
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    const cur = latest.current;
    if (!next || !cur) return;
    h.past.push(cur);
    h.at = 0;
    setDraft(next, true, false);
    setLineAt(null);
    setSelected([]);
    setHistoryTick((n) => n + 1);
    app.announce(S.mapper.redone);
  };
  keys.current = { undo, redo };

  /** Builds the table from a click on its header (or first row), keeping its name and headings. */
  const startTable = (t: Token, asHeader = false) => {
    if (!layout) return;
    const inf = inferTable(layout, t, table?.name ?? 'Items', asHeader);
    if (!inf) {
      setMessage({ tone: 'warn', text: S.mapper.table.notFound });
      return;
    }
    setMessage({ tone: 'success', text: S.mapper.table.started });
    setTable(
      table
        ? {
            ...inf.rule,
            id: table.id,
            name: table.name,
            ...(table.groups?.length ? { groups: table.groups } : {}),
          }
        : inf.rule,
    );
    setLineAt(null);
    setSelected([]);
  };

  /** Changes the table from the line panel, with an undo. */
  const changeTable = (next: TableRule, text: string) => {
    const prev = table;
    setTable(next);
    setLineAt(null);
    setSelected([]);
    toast(text, {
      label: S.mapper.undo,
      run: () => {
        const cur = latest.current;
        if (!cur || !prev) return;
        setDraft({ ...cur, tables: [prev, ...(cur.tables ?? []).slice(1)] });
      },
    });
  };

  const showUnplaced = () => {
    const all = tableResult?.stats?.unplaced ?? [];
    if (!all.length) return;
    const b = all[unplacedAt.current++ % all.length]!;
    setPageNo(b.page);
    setSelected((pages?.[b.page - 1]?.tokens ?? []).filter((t) => inBox(t, b.bbox)));
    setReveal((n) => n + 1);
    app.announce(S.mapper.table.unplacedShown(b.page));
  };

  const removeColumn = (name: string) => {
    if (!table) return;
    const bounds = tableResult?.bounds ?? [];
    const i = bounds.findIndex((b) => b.name === name);
    const left = i > 0 ? bounds[i - 1]!.name : null;
    const gone = bounds[i];
    // The column to the left takes over the removed column's space.
    const columns = table.columns
      .filter((c) => c.name !== name)
      .map((c) =>
        c.name === left && c.x1 !== undefined && gone
          ? Number.isFinite(gone.x1)
            ? { ...c, x1: gone.x1 }
            : (({ x1: _x1, ...rest }) => rest)(c)
          : c,
      );
    const rowStart =
      table.rowStart?.column === name
        ? { column: columns[0]!.name, pattern: '\\S' }
        : table.rowStart;
    changeTable(
      { ...table, columns, ...(rowStart ? { rowStart } : {}) },
      S.mapper.table.columnRemoved(name),
    );
  };

  /** Maps the chosen words: re-picks the field waiting for it, or adds a new field. */
  const pick = (sel: Token[]) => {
    if (!layout || !sel.length) return;
    sel = [...sel].sort(byReading);
    setSelected(sel);
    if (repick) {
      const f = draft.fields.find((x) => x.id === repick);
      const inf = inferField(
        layout,
        sel,
        names.filter((n) => n !== f?.name),
      );
      if (f && inf)
        updateField({
          ...inf.rule,
          id: f.id,
          name: f.name,
          type: f.type ?? inf.rule.type,
          required: f.required ?? true,
        });
      else if (!inf) setMessage({ tone: 'warn', text: S.mapper.noLabel });
      setRepick(null);
      return;
    }
    const inf = inferField(layout, sel, names);
    if (!inf) {
      setMessage({ tone: 'warn', text: S.mapper.noLabel });
      return;
    }
    setMessage(null);
    setDraft({ ...draft, fields: [...draft.fields, inf.rule] });
    setEditing(inf.rule.id);
    app.announce(`${inf.rule.name}: ${inf.value}`);
  };

  /** Words dragged across are one value. */
  const onTokens = (ts: Token[]) => {
    setLineAt(null);
    pick(ts);
  };

  /** What a click on a word would take, shown on hover. */
  const expand = (t: Token): Token[] => {
    if (!layout) return [t];
    if (pickHeader || (!repick && ((table && inTable(t)) || (!table && isHeaderAt(t)))))
      return lineOf(t)?.tokens ?? [t];
    const f = repick ? undefined : fieldAt(t);
    if (f) {
      const boxes = (fieldRes(f)?.boxes ?? []).filter((b) => b.page === t.page);
      return (pages?.[t.page - 1]?.tokens ?? []).filter((x) => boxes.some((b) => inBox(x, b.bbox)));
    }
    return valueTokens(layout, t);
  };

  const removeField = (id: string) => {
    const i = draft.fields.findIndex((f) => f.id === id);
    const f = draft.fields[i];
    if (!f) return;
    setDraft({ ...draft, fields: draft.fields.filter((x) => x.id !== id) });
    if (editing === id) setEditing(null);
    if (repick === id) setRepick(null);
    setSelected([]);
    toast(S.mapper.removed(f.name), {
      label: S.mapper.undo,
      run: () => {
        const cur = latest.current;
        if (!cur || cur.fields.some((x) => x.id === id)) return;
        const fields = [...cur.fields];
        fields.splice(Math.min(i, fields.length), 0, f);
        setDraft({ ...cur, fields });
      },
    });
  };

  /** The choices for a clicked line, shown beside it on the page. */
  const lineMenu = (t: Token) => {
    const line = lineOf(t);
    if (!layout || !line) return null;
    const close = () => {
      setLineAt(null);
      setSelected([]);
    };
    const value = valueTokens(layout, t);
    const mapped = fieldAt(t);
    const editField = mapped
      ? {
          label: S.mapper.table.editField(mapped.name),
          key: 'D',
          run: () => {
            close();
            setEditing(mapped.id);
          },
        }
      : null;
    const asField = mapped
      ? editField
      : !table || /\d/.test(value.map((x) => x.text).join(' '))
        ? {
            label: S.mapper.table.asField(value.map((x) => x.text).join(' ')),
            key: 'D',
            run: () => {
              close();
              pick(value);
            },
          }
        : null;
    if (!table)
      return (
        <LineMenu
          text={line.text}
          choices={[
            { label: S.mapper.table.asTable, key: 'T', run: () => startTable(t, true) },
            ...(asField ? [asField] : []),
          ]}
          hint={S.mapper.table.asTableHint}
          onClose={close}
        />
      );
    const taken = [...table.columns.map((c) => c.name), ...(table.groups ?? []).map((g) => g.name)];
    const group = groupFor(line, taken);
    const m = new RegExp(group.pattern).exec(line.text);
    const choices: { label: string; key: string; run: () => void }[] = [
      {
        label: S.mapper.table.asGroup(group.name, (m?.[group.capture ?? 0] ?? line.text).trim()),
        key: 'H',
        run: () =>
          changeTable(
            { ...table, groups: [...(table.groups ?? []), group] },
            S.mapper.table.groupAdded(group.name),
          ),
      },
      {
        label: S.mapper.table.asSkip,
        key: 'S',
        run: () => {
          const pattern = skipPatternFor(line);
          const skip = table.skip ?? [];
          changeTable(
            { ...table, skip: skip.includes(pattern) ? skip : [...skip, pattern] },
            S.mapper.table.skipAdded,
          );
        },
      },
      {
        label: S.mapper.table.asEnd,
        key: 'E',
        run: () => {
          const label = phrases(line)[0]!.text.replace(/\s*[:#]+$/, '');
          changeTable(
            { ...table, end: { labels: [label], match: 'starts-with' } },
            S.mapper.table.endAdded(label),
          );
        },
      },
      { label: S.mapper.table.asHeader, key: 'T', run: () => startTable(t, true) },
      ...(asField ? [asField] : []),
    ];
    return (
      <LineMenu text={line.text} choices={choices} hint={S.mapper.table.lineHint} onClose={close} />
    );
  };

  // Marks for the current page.
  const marks: Mark[] = [];
  if (result) {
    for (const f of draft.fields) {
      for (const b of fieldRes(f)?.boxes ?? [])
        if (b.page === pageNo)
          marks.push({
            bbox: b.bbox,
            kind: 'field',
            // Names only on the field in hand, so labels never cover other values.
            ...(f.id === editing || f.id === hot ? { label: f.name, active: true } : {}),
          });
    }
    for (const sg of suggestions) {
      const h = sg.rule.hint;
      if (h && h.page === pageNo)
        marks.push({
          bbox: h.bbox,
          kind: 'suggest',
          ...(sg.rule.id === hot
            ? {
                label: `${S.mapper.suggested}: ${sg.rule.name}`,
                tag: 'warn' as const,
                active: true,
              }
            : {}),
        });
    }
    if (tableResult?.found && tableResult.header) {
      const onPage = tableResult.rows.filter((r) => r.page === pageNo);
      if (tableResult.header.page === pageNo || onPage.length) {
        const boxes = [
          ...(tableResult.header.page === pageNo ? [tableResult.header.bbox] : []),
          ...onPage.map((r) => r.bbox),
        ];
        marks.push({
          bbox: [
            Math.min(...boxes.map((b) => b[0])),
            Math.min(...boxes.map((b) => b[1])),
            Math.max(...boxes.map((b) => b[2])),
            Math.max(...boxes.map((b) => b[3])),
          ],
          kind: 'table',
          label: `${table!.name} · ${S.mapper.table.rowsFound(tableResult.rows.length)}`,
        });
      }
      if (tableResult.end && tableResult.end.page === pageNo)
        marks.push({ bbox: tableResult.end.bbox, kind: 'end' });
    }
  }
  // The ruler along the table's top on this page: column breaks to add, move and remove.
  let ruler: Ruler | undefined;
  const frame = layout && table ? tableFrame(layout, table) : null;
  const pageLines = layout?.pages.find((p) => p.page === pageNo)?.lines;
  if (layout && table && frame && frame.bounds.length && pageLines) {
    const rowsHere = (tableResult?.rows ?? []).filter((r) => r.page === pageNo);
    const head =
      frame.page === pageNo ? frame.bbox : findHeaderOnPage(pageLines, table, pageNo)?.bbox;
    if (head || rowsHere.length) {
      const b = frame.bounds;
      const withTable = (next: TableRule | null, fail = S.mapper.ruler.tooNarrow) =>
        next ? next : (setMessage({ tone: 'warn', text: fail }), null);
      ruler = {
        y0: head ? head[1] : Math.min(...rowsHere.map((r) => r.bbox[1])),
        y1: rowsHere.length ? Math.max(...rowsHere.map((r) => r.bbox[3])) : head![3],
        x0: b[0]!.x0,
        x1: b[b.length - 1]!.x1,
        breaks: b.slice(1).map((c) => c.x0),
        names: b.map((c) => c.name),
        onAdd: (x) => {
          const split = addBreak(layout, table, x);
          if (withTable(split?.rule ?? null))
            changeTable(split!.rule, S.mapper.table.columnAdded(split!.column.name));
        },
        onMove: (i, x, how) => {
          const next = moveBreak(layout, table, i, x, how.settle);
          if (next) setTable(next, how.record);
        },
        onRemove: (i) => {
          const next = withTable(removeBreak(layout, table, i));
          if (!next) return;
          const kept = next.columns.find((c) => c.name === b[i]!.name) ? b[i]! : b[i + 1]!;
          changeTable(next, S.mapper.ruler.removed(kept.name));
        },
      };
    }
  }

  const save = async () => {
    const problems: string[] = [];
    if (!draft.fields.length && !(draft.tables ?? []).length) problems.push(S.mapper.noFields);
    if (!draft.fingerprint.mustContain.length && !draft.fingerprint.abn)
      problems.push(S.mapper.fingerprintNone);
    const v = parseTemplate(draft);
    if (!v.ok) problems.push(...v.errors);
    const dupNames = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupNames.length) problems.push(...dupNames.map((n) => `${S.mapper.editor.name}: ${n}`));
    if (problems.length) {
      setMessage({ tone: 'danger', text: S.mapper.saveInvalid, list: problems });
      return;
    }
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const saved = await saveVersion(ws, draft, s.user, now());
    await idbDel(`draft:${draft.id}`);
    setDraftState(saved);
    setLatestVersion(saved.version);
    setSavedAt(null);
    setMessage({ tone: 'success', text: S.mapper.savedAs(saved.version) });
    app.announce(S.mapper.savedAs(saved.version));
    setSourceFile((await idbGet<string>(`origin:${saved.id}`)) ?? null);
    await refresh();
  };

  const fpParts = draft.fingerprint.mustContain.map((x) => `“${x}”`).join(', ');
  const checksOn = (draft.checks ?? []).filter((c) => c.enabled !== false).length;
  const origin = route.template ? true : false;

  return (
    <>
      <div class="page-head">
        <div class="stack">
          <nav class="breadcrumb" aria-label={S.mapper.breadcrumb}>
            <a
              href="?view=templates"
              onClick={(e) => {
                e.preventDefault();
                navigate({ view: 'templates' });
              }}
            >
              {S.mapper.breadcrumb}
            </a>{' '}
            / {draft.name}
          </nav>
          <h1 class="sr-only">{S.mapper.title}</h1>
          <div class="row">
            <input
              type="text"
              class="title-input"
              aria-label={S.mapper.nameLabel}
              value={draft.name}
              onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })}
            />
            <span class="chip chip-accent">{S.mapper.draftChip(latestVersion + 1)}</span>
            {savedAt ? <span class="caption">{S.mapper.savedAt(savedAt)}</span> : null}
          </div>
          <p class="page-sub">
            {fpParts ? S.mapper.fingerprintLine(fpParts) : S.mapper.fingerprintNone}
          </p>
        </div>
        <div class="row">
          <button type="button" class="btn" onClick={() => setChanging(true)}>
            {S.mapper.changeSample}
          </button>
          <button
            type="button"
            class="btn"
            disabled={!origin}
            onClick={() => navigate({ view: 'test', template: draft.id })}
          >
            {S.mapper.testOnSamples}
          </button>
          <ActionButton busyLabel={S.busy.saving} class="btn btn-primary" onAction={() => save()}>
            {S.mapper.saveTemplate}
          </ActionButton>
        </div>
      </div>

      {lock ? (
        <Banner
          tone="warn"
          action={
            <ActionButton
              busyLabel={S.busy.opening}
              class="btn"
              onAction={async () => {
                await takeLock(
                  ws,
                  `template:${draft.id}`,
                  s.user,
                  `template:${draft.id}`,
                  now(),
                  true,
                );
                setLock(null);
              }}
            >
              {S.common.openAnyway}
            </ActionButton>
          }
        >
          {S.common.inUse(lock.user, timeHM(lock.since))}
        </Banner>
      ) : null}
      {resume ? (
        <Banner
          action={
            <div class="row">
              <button
                type="button"
                class="btn btn-primary"
                onClick={() => {
                  setDraftState(resume.template);
                  setResume(null);
                }}
              >
                {S.mapper.resume}
              </button>
              <ActionButton
                busyLabel={S.busy.discarding}
                class="btn"
                onAction={async () => {
                  await discardDraft(ws, draft.id);
                  await idbDel(`draft:${draft.id}`);
                  setResume(null);
                }}
              >
                {S.mapper.discard}
              </ActionButton>
            </div>
          }
        >
          {S.mapper.resumeTitle(timeHM(resume.savedAt))}
        </Banner>
      ) : null}
      {sourceFile ? (
        <Banner
          tone="success"
          action={
            <ActionButton
              busyLabel={S.busy.opening}
              class="btn btn-primary"
              onAction={async () => {
                await idbDel(`origin:${draft.id}`);
                setSourceFile(null);
                navigate({ view: 'review', file: sourceFile });
              }}
            >
              {S.mapper.backToFile}
            </ActionButton>
          }
        >
          {S.mapper.createdFrom(sourceFile)}
        </Banner>
      ) : null}
      {message ? (
        <Banner tone={message.tone}>
          <p>{message.text}</p>
          {message.list ? (
            <ul>
              {message.list.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </Banner>
      ) : null}

      <div class="mapper-layout">
        <aside class="mapper-rail stack" aria-labelledby="csv-title">
          <div class="rail-intro">
            <h2 id="csv-title" class="section-title">
              {S.mapper.rail.title}
            </h2>
            <p class="caption">{S.mapper.rail.hint}</p>
          </div>
          <FieldsPanel
            draft={draft}
            result={result}
            suggestions={suggestions}
            editing={editing}
            repick={repick}
            onAccept={(sg) => {
              setDraft({ ...draft, fields: [...draft.fields, sg.rule] });
              app.announce(`${S.common.accept}: ${sg.rule.name}`);
            }}
            onAcceptAll={() => {
              setDraft({
                ...draft,
                fields: [...draft.fields, ...suggestions.map((x) => x.rule)],
              });
              app.announce(`${S.mapper.acceptAll}: ${suggestions.length}`);
            }}
            hot={hot}
            onHot={setHot}
            onDismiss={(sg) => setDismissed(new Set([...dismissed, sg.rule.name]))}
            onEdit={setEditing}
            onRepick={(id) => {
              setRepick(repick === id ? null : id);
            }}
            onChange={updateField}
            onRemove={removeField}
            onAddPreset={(name) => {
              const p = PRESETS.find((x) => x.name === name)!;
              const f: FieldRule = {
                id: `f${Date.now().toString(36)}`,
                name: p.name,
                type: p.type,
                required: true,
                anchor: { labels: [...p.labels], match: 'exact' },
                direction: 'right',
              };
              setDraft({ ...draft, fields: [...draft.fields, f] });
              setEditing(f.id);
            }}
            onRegion={(id, on) => {
              const f = draft.fields.find((x) => x.id === id)!;
              const r = fieldRes(f);
              const box = r?.boxes[0];
              const pg = pages?.[(box?.page ?? 1) - 1];
              if (!on || !box || !pg) {
                const { region: _r, ...rest } = f;
                updateField(rest);
                return;
              }
              const pad = 4;
              updateField({
                ...f,
                region: {
                  page: box.page,
                  x0: Math.max(0, (box.bbox[0] - pad) / pg.width),
                  y0: Math.max(0, (box.bbox[1] - pad) / pg.height),
                  x1: Math.min(1, (box.bbox[2] + pad) / pg.width),
                  y1: Math.min(1, (box.bbox[3] + pad) / pg.height),
                },
              });
            }}
          />
          <TablePanel
            table={table}
            result={tableResult}
            suggestion={tableSuggestion?.rule ?? null}
            onAcceptSuggestion={() => tableSuggestion && setTable(tableSuggestion.rule)}
            onChange={(t) => setTable(t)}
            onRemove={() => setTable(null)}
            onRemoveColumn={removeColumn}
            onClearBreaks={() => {
              if (!layout || !table) return;
              let next = table;
              for (let r = removeBreak(layout, next, 0); r; r = removeBreak(layout, next, 0))
                next = r;
              changeTable(next, S.mapper.table.breaksCleared);
            }}
            onShowUnplaced={showUnplaced}
            picking={pickHeader}
            onPickHeader={() => {
              setLineAt(null);
              setPickHeader(!pickHeader);
            }}
          />
          <details class="card rail-more">
            <summary>{S.mapper.rail.recognise}</summary>
            <FingerprintPanel
              bare
              draft={draft}
              onChange={(fingerprint) => setDraft({ ...draft, fingerprint })}
            />
          </details>
          <details class="card rail-more">
            <summary>{S.mapper.rail.checks(checksOn)}</summary>
            <ChecksPanel
              bare
              draft={draft}
              result={result}
              onChange={(checks) => setDraft({ ...draft, checks })}
            />
          </details>
        </aside>

        <section class="card stack mapper-page" aria-label={sample?.name ?? S.mapper.title}>
          <div class="viewer-toolbar">
            <div class="row">
              <button
                type="button"
                class="btn btn-small"
                onClick={undo}
                disabled={!history.current.past.length}
                aria-keyshortcuts="Control+Z"
              >
                {S.mapper.undoButton}
              </button>
              <button
                type="button"
                class="btn btn-small"
                onClick={redo}
                disabled={!history.current.future.length}
                aria-keyshortcuts="Control+Shift+Z"
              >
                {S.mapper.redoButton}
              </button>
            </div>
            <div class="row">
              <Segmented<string>
                label={S.mapper.zoom}
                value={String(zoom)}
                onChange={(z) => setZoom(z === 'fit' ? 'fit' : (Number(z) as 1 | 1.5))}
                options={[
                  { value: 'fit', label: S.mapper.zoomFit },
                  { value: '1', label: S.mapper.zoom100 },
                  { value: '1.5', label: S.mapper.zoom150 },
                ]}
              />
            </div>
          </div>
          <p class="caption">
            {pickHeader
              ? S.mapper.table.pickHeaderHint
              : repick
                ? S.mapper.repickHint
                : table
                  ? S.mapper.clickHint.table
                  : S.mapper.clickHint.start}
          </p>
          {sample ? <p class="caption mono">{sample.name}</p> : null}
          {loading ? <p class="muted">{S.common.loading}</p> : null}
          {pdf.doc && pages ? (
            <>
              <PageView
                doc={pdf.doc}
                page={pageNo}
                zoom={zoom}
                tokens={pages[pageNo - 1]?.tokens ?? []}
                marks={marks}
                selected={selected}
                ruler={ruler}
                overlay={
                  lineAt && lineAt.page === pageNo
                    ? (() => {
                        const node = lineMenu(lineAt);
                        const line = lineOf(lineAt);
                        return node && line
                          ? {
                              bbox: [line.x0, line.y0, line.x1, line.y1] as BBox,
                              x: lineAt.x0,
                              node,
                            }
                          : undefined;
                      })()
                    : undefined
                }
                onToken={onToken}
                onTokens={onTokens}
                expand={expand}
                onPage={(d) => setPageNo(Math.max(1, Math.min(pdf.pages, pageNo + d)))}
                onEscape={() => {
                  setPickHeader(false);
                  setLineAt(null);
                  setSelected([]);
                  setRepick(null);
                  setEditing(null);
                }}
              />
              {pdf.pages > 1 ? (
                <div class="row">
                  <button
                    type="button"
                    class="btn btn-small"
                    disabled={pageNo <= 1}
                    onClick={() => setPageNo(pageNo - 1)}
                  >
                    {S.common.previousPage}
                  </button>
                  <label class="page-jump">
                    {S.mapper.page}
                    <input
                      type="number"
                      min={1}
                      max={pdf.pages}
                      value={pageNo}
                      aria-label={S.mapper.pageNumber(pdf.pages)}
                      onChange={(e) => {
                        const n = Math.round(Number((e.target as HTMLInputElement).value));
                        if (n >= 1 && n <= pdf.pages) setPageNo(n);
                      }}
                    />
                    {S.mapper.ofPages(pdf.pages)}
                  </label>
                  <span class="sr-only" aria-live="polite">
                    {S.common.pageOf(pageNo, pdf.pages)}
                  </span>
                  <button
                    type="button"
                    class="btn btn-small"
                    disabled={pageNo >= pdf.pages}
                    onClick={() => setPageNo(pageNo + 1)}
                  >
                    {S.common.nextPage}
                  </button>
                </div>
              ) : null}
            </>
          ) : !loading && !sample ? (
            <DropZone multiple={false} onFiles={async (f) => void (await addAndLoad(f[0]!))} />
          ) : null}
        </section>
      </div>

      <OutputDock
        grid={grid}
        busy={busy}
        onCell={(cell, column) => {
          const b = cell.box;
          if (!b) return;
          setPageNo(b.page);
          setSelected((pages?.[b.page - 1]?.tokens ?? []).filter((t) => inBox(t, b.bbox)));
          setReveal((n) => n + 1);
          app.announce(S.mapper.output.shown(column, b.page));
        }}
        onDownload={() => {
          if (!result) return;
          const file = toCsv(result, draft, {
            file: sample?.name ?? '',
            sha256: '',
            extractedAt: new Date().toISOString(),
          })[0];
          if (file)
            downloadBlob(`${stem(sample?.name ?? draft.name)}.csv`, file.content, 'text/csv');
        }}
      />

      {changing ? (
        <Dialog title={S.mapper.changeSample} onClose={() => setChanging(false)}>
          {(s.templates.find((t) => t.id === draft.id)?.samples ?? []).length ? (
            <ul class="list-plain">
              {s.templates
                .find((t) => t.id === draft.id)!
                .samples.map((n) => (
                  <li key={n}>
                    <ActionButton
                      busyLabel={S.busy.loadingSample}
                      class="btn btn-text mono"
                      onAction={async () => {
                        setChanging(false);
                        await loadSample(n, await sampleBytes(ws, draft.id, n));
                      }}
                    >
                      {n}
                    </ActionButton>
                  </li>
                ))}
            </ul>
          ) : null}
          <DropZone
            multiple={false}
            onFiles={async (f) => {
              setChanging(false);
              await addAndLoad(f[0]!);
            }}
          />
        </Dialog>
      ) : null}
    </>
  );

  async function addAndLoad(f: File) {
    if (!ws || !draft) return;
    const bytes = await fileBytes(f);
    const name = await addSample(ws, draft.id, f.name, bytes);
    await refresh();
    await loadSample(name, bytes);
  }
}
