import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  PRESETS,
  buildLayout,
  extractWith,
  inferField,
  inferTable,
  parseTemplate,
  phrases,
  suggestFields,
  suggestFingerprint,
  suggestTable,
  toCsv,
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
  ActionButton,
} from '../components/ui';
import { PageView, usePdf, type Divider, type Mark, type Zoom } from '../components/PageView';
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
import {
  ChecksPanel,
  FieldsPanel,
  FingerprintPanel,
  PreviewPanel,
  TablePanel,
} from './MapperPanels';

type Mode = 'value' | 'table' | 'end';

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

type Panel = 'fields' | 'table' | 'checks' | 'fingerprint' | 'preview';
const PANELS: Panel[] = ['fields', 'table', 'checks', 'fingerprint', 'preview'];

export function MapperScreen() {
  const s = useApp();
  const route = useRoute();
  const [draft, setDraftState] = useState<Template | null>(null);
  const [latestVersion, setLatestVersion] = useState(0);
  const [sample, setSample] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pages, setPages] = useState<PageText[] | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [mode, setMode] = useState<Mode>('value');
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
  const [panel, setPanel] = useState<Panel>('fields');
  // The exception this template was created from, offered for a re-run after saving.
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  // Id of a template this screen just created; its route change needs no reload.
  const created = useRef<string | null>(null);
  const pdf = usePdf(sample?.bytes ?? null);

  const ws = s.ws;
  const layout = useMemo(() => (pages ? buildLayout({ pages }) : null), [pages]);

  /** Updates the draft and autosaves (IndexedDB now, folder after 2 s). */
  const setDraft = (t: Template, persist = true) => {
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

  const result = useMemo(() => {
    if (!draft || !layout) return null;
    try {
      return extractWith(layout, draft, { confidenceThreshold: s.settings.confidenceThreshold });
    } catch {
      return null;
    }
  }, [draft, layout, s.settings.confidenceThreshold]);

  const csv = useMemo(() => {
    if (!result || !draft) return null;
    try {
      return (
        toCsv(
          result,
          draft,
          { file: sample?.name ?? '', sha256: '', extractedAt: '' },
          { bom: false },
        )[0]?.content ?? null
      );
    } catch {
      return null;
    }
  }, [result, draft, sample]);

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

  const names = draft.fields.map((f) => f.name);
  const table = (draft.tables ?? [])[0];
  const tableResult = table ? result?.tables[table.name] : undefined;

  const updateField = (f: FieldRule) =>
    setDraft({ ...draft, fields: draft.fields.map((x) => (x.id === f.id ? f : x)) });
  const setTable = (t: TableRule | null) =>
    setDraft({
      ...draft,
      tables: t ? [t, ...(draft.tables ?? []).slice(1)] : (draft.tables ?? []).slice(1),
    });

  const onToken = (t: Token, shift: boolean) => {
    if (!layout) return;
    if (mode === 'table') {
      const inf = inferTable(layout, t, table?.name ?? 'Items');
      if (!inf) {
        setMessage({ tone: 'warn', text: S.mapper.table.notFound });
        return;
      }
      setMessage(null);
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
      app.announce(S.mapper.table.rowsFound(0));
      setMode('value');
      setPanel('table');
      return;
    }
    if (mode === 'end') {
      if (!table) return;
      const page = layout.pages.find((p) => p.page === t.page);
      const line = page?.lines.find((l) => l.tokens.includes(t));
      if (!line) return;
      const label = phrases(line)[0]!.text.replace(/\s*[:#]+$/, '');
      setTable({ ...table, end: { labels: [label], match: 'starts-with' } });
      app.announce(S.mapper.endMarkerSet(label));
      setMode('value');
      setPanel('table');
      return;
    }
    // Click a value
    if (repick) {
      const f = draft.fields.find((x) => x.id === repick);
      const inf = inferField(
        layout,
        [t],
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
      setRepick(null);
      setSelected([t]);
      return;
    }
    const sel = shift
      ? selected.includes(t)
        ? selected.filter((x) => x !== t)
        : [...selected, t]
      : [t];
    setSelected(sel);
    if (shift && editing) {
      const f = draft.fields.find((x) => x.id === editing);
      const inf = inferField(
        layout,
        sel,
        names.filter((n) => n !== f?.name),
      );
      if (f && inf) updateField({ ...inf.rule, id: f.id, name: f.name });
      return;
    }
    const inf = inferField(layout, sel, names);
    if (!inf) return;
    setPanel('fields');
    setDraft({ ...draft, fields: [...draft.fields, inf.rule] });
    setEditing(inf.rule.id);
    app.announce(`${inf.rule.name}: ${inf.value}`);
  };

  // Marks for the current page.
  const marks: Mark[] = [];
  if (result) {
    for (const f of draft.fields) {
      for (const b of result.fields[f.name]?.boxes ?? [])
        if (b.page === pageNo) marks.push({ bbox: b.bbox, kind: 'field', label: f.name });
    }
    for (const sg of suggestions) {
      const h = sg.rule.hint;
      if (h && h.page === pageNo)
        marks.push({ bbox: h.bbox, kind: 'suggest', label: S.mapper.suggested, tag: 'warn' });
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
  const dividers: Divider[] = [];
  if (table && tableResult?.found && tableResult.header?.page === pageNo) {
    const hb = tableResult.header.bbox;
    const lastRow = tableResult.rows.filter((r) => r.page === pageNo).pop();
    const y1 = lastRow ? lastRow.bbox[3] : hb[3];
    tableResult.bounds.forEach((b, i) => {
      if (i === 0 || !Number.isFinite(b.x0)) return;
      dividers.push({
        x: b.x0,
        y0: hb[1],
        y1,
        label: S.mapper.table.dividerLabel(i),
        onMove: (x) => {
          const left = tableResult.bounds[i - 1]!.name;
          const right = b.name;
          setTable({
            ...table,
            columns: table.columns.map((c) =>
              c.name === left ? { ...c, x1: x } : c.name === right ? { ...c, x0: x } : c,
            ),
          });
        },
      });
    });
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
  const panelCount = (p: Panel): number | null => {
    if (p === 'fields') return draft.fields.length + suggestions.length;
    if (p === 'table') return tableResult?.found ? tableResult.rows.length : null;
    if (p === 'checks') return (draft.checks ?? []).filter((c) => c.enabled !== false).length;
    return null;
  };
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

      <div class="split">
        <section class="card stack mapper-page" aria-label={sample?.name ?? S.mapper.title}>
          <div class="viewer-toolbar">
            <Segmented<Mode>
              label={S.mapper.modes}
              value={mode}
              onChange={(m) => {
                setMode(m);
                setRepick(null);
              }}
              options={[
                { value: 'value', label: S.mapper.modeValue },
                { value: 'table', label: S.mapper.modeTable },
                { value: 'end', label: S.mapper.modeEnd },
              ]}
            />
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
                dividers={dividers}
                onToken={onToken}
                onEscape={() => {
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
                  <span aria-live="polite">{S.common.pageOf(pageNo, pdf.pages)}</span>
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

        <div class="stack">
          <div class="tabs" role="tablist" aria-label={S.mapper.panels}>
            {PANELS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                id={`tab-${p}`}
                aria-selected={panel === p}
                aria-controls="mapper-panel"
                class={panel === p ? 'tab on' : 'tab'}
                onClick={() => setPanel(p)}
              >
                {S.mapper.panel[p]}
                {panelCount(p) !== null ? <span class="tab-count">{panelCount(p)}</span> : null}
              </button>
            ))}
          </div>
          <div id="mapper-panel" role="tabpanel" aria-labelledby={`tab-${panel}`} class="stack">
            {panel === 'fields' ? (
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
                onDismiss={(sg) => setDismissed(new Set([...dismissed, sg.rule.name]))}
                onEdit={setEditing}
                onRepick={(id) => {
                  setMode('value');
                  setRepick(repick === id ? null : id);
                }}
                onChange={updateField}
                onRemove={(id) => {
                  setDraft({ ...draft, fields: draft.fields.filter((f) => f.id !== id) });
                  setEditing(null);
                }}
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
                  const r = result?.fields[f.name];
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
            ) : null}
            {panel === 'table' || panel === 'fields' ? (
              tableSuggestion && !table ? (
                <Banner
                  tone="warn"
                  action={
                    <button
                      type="button"
                      class="btn btn-small"
                      onClick={() => setTable(tableSuggestion.rule)}
                    >
                      {S.common.accept}
                    </button>
                  }
                >
                  {`${S.mapper.suggested}: ${S.mapper.table.title} (${tableSuggestion.rule.columns.map((c) => c.name).join(', ')})`}
                </Banner>
              ) : null
            ) : null}
            {panel === 'table' ? (
              <TablePanel
                table={table}
                rows={tableResult?.rows.length ?? 0}
                onChange={(t) => setTable(t)}
                onRemove={() => setTable(null)}
              />
            ) : null}
            {panel === 'checks' ? (
              <ChecksPanel
                draft={draft}
                result={result}
                onChange={(checks) => setDraft({ ...draft, checks })}
              />
            ) : null}
            {panel === 'fingerprint' ? (
              <FingerprintPanel
                draft={draft}
                onChange={(fingerprint) => setDraft({ ...draft, fingerprint })}
              />
            ) : null}
            {panel === 'preview' ? <PreviewPanel csv={csv} /> : null}
          </div>
        </div>
      </div>

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
