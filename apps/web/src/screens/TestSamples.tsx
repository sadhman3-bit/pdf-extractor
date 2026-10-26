import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  buildLayout,
  extractWith,
  humanize,
  suggestLabelFixes,
  type DocLayout,
  type Extraction,
  type LabelFix,
  type Template,
} from '@pdfx/engine';
import { S } from '../strings';
import { app, useApp } from '../app/store';
import { navigate, useRoute } from '../app/router';
import { now, refresh } from '../app/session';
import { Banner, DropZone, fileBytes, ActionButton, Working } from '../components/ui';
import { CheckIcon, XIcon } from '../components/Icons';
import { PageView, usePdf } from '../components/PageView';
import { documentText } from '../lib/pipeline';
import { idbDel, idbSet } from '../lib/idb';
import {
  addSample,
  loadDraft,
  removeSample,
  sampleBytes,
  saveDraft,
  saveVersion,
} from '../workspace/store';
import { recordRun } from './lastRuns';

interface SampleRun {
  name: string;
  bytes: Uint8Array;
  layout: DocLayout | null;
  error?: string;
}

interface Cell {
  pass: boolean;
  text: string;
}

function grid(t: Template, results: (Extraction | null)[]): { label: string; cells: Cell[] }[] {
  const rows: { label: string; cells: Cell[] }[] = [];
  for (const f of t.fields) {
    rows.push({
      label: f.name,
      cells: results.map((r) => {
        const x = r?.fields[f.name];
        if (!x) return { pass: false, text: S.test.missing };
        if (x.value !== null && !x.error) return { pass: true, text: x.csv };
        if (!f.required && !x.error) return { pass: true, text: S.common.none };
        return {
          pass: false,
          text: r?.reasons.find((q) => q.field === f.name)?.message ?? S.test.missing,
        };
      }),
    });
  }
  for (const tb of t.tables ?? []) {
    rows.push({
      label: S.test.rowCount(tb.name),
      cells: results.map((r) => {
        const x = r?.tables[tb.name];
        return x?.found && x.rows.length
          ? { pass: true, text: String(x.rows.length) }
          : { pass: false, text: r?.reasons.find((q) => q.table === tb.name)?.message ?? '0' };
      }),
    });
  }
  for (const c of t.checks ?? []) {
    if (c.enabled === false) continue;
    rows.push({
      label: c.label,
      cells: results.map((r) => {
        const x = r?.checks.find((k) => k.id === c.id);
        return x?.result === 'pass'
          ? { pass: true, text: S.common.pass }
          : { pass: false, text: x?.message ?? S.common.fail };
      }),
    });
  }
  return rows;
}

export function TestScreen() {
  const s = useApp();
  const route = useRoute();
  const info = s.templates.find((t) => t.id === route.template);
  const [template, setTemplate] = useState<Template | null>(null);
  const [runs, setRuns] = useState<SampleRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [focusFix, setFocusFix] = useState<{ sample: number; fix: LabelFix } | null>(null);
  const ws = s.ws;

  useEffect(() => {
    if (!ws || !info) return;
    let alive = true;
    void (async () => {
      const draft = await loadDraft(ws, info.id);
      if (!alive) return;
      setTemplate(draft?.template ?? info.latest);
      setBusy(true);
      const out: SampleRun[] = [];
      for (const name of info.samples) {
        const bytes = await sampleBytes(ws, info.id, name);
        const r = await documentText(bytes, info.latest.settings?.ocr ?? 'auto');
        out.push(
          r.ok
            ? { name, bytes, layout: buildLayout({ pages: r.pages }) }
            : { name, bytes, layout: null, error: r.message },
        );
      }
      if (alive) {
        setRuns(out);
        setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ws, info?.id, info?.samples.join('|')]);

  const results = useMemo(
    () =>
      template
        ? runs.map((r) =>
            r.layout
              ? extractWith(r.layout, template, {
                  confidenceThreshold: s.settings.confidenceThreshold,
                })
              : null,
          )
        : [],
    [runs, template, s.settings.confidenceThreshold],
  );
  const rows = useMemo(() => (template ? grid(template, results) : []), [template, results]);
  const fixes = useMemo(
    () =>
      template ? runs.map((r) => (r.layout ? suggestLabelFixes(r.layout, template) : [])) : [],
    [runs, template],
  );

  const total = rows.reduce((n, r) => n + r.cells.length, 0);
  const passed = rows.reduce((n, r) => n + r.cells.filter((c) => c.pass).length, 0);

  useEffect(() => {
    if (template && runs.length && !busy)
      recordRun(template.id, S.test.summary(passed, total, runs.length));
  }, [passed, total, runs.length, busy, template]);

  if (!ws) return null;
  if (!info || !template) {
    return (
      <>
        <h1 class="page-title">{S.test.title}</h1>
        <section class="card">
          <p>{S.test.noTemplate}</p>
        </section>
      </>
    );
  }

  const applyFix = async (fix: LabelFix) => {
    const t: Template = {
      ...template,
      fields: template.fields.map((f) =>
        f.name === fix.field && !f.anchor.labels.includes(fix.label)
          ? { ...f, anchor: { ...f.anchor, labels: [...f.anchor.labels, fix.label] } }
          : f,
      ),
    };
    setTemplate(t);
    const d = { template: t, savedAt: new Date().toISOString() };
    await idbSet(`draft:${t.id}`, d);
    await saveDraft(ws, d);
    setFocusFix(null);
    setMsg(S.test.applied);
    app.announce(S.test.applied);
  };

  const allFixes = fixes.flatMap((list, i) => list.map((fix) => ({ sample: i, fix })));
  const shown = focusFix ?? allFixes[0] ?? null;

  return (
    <>
      <div class="page-head">
        <div>
          <h1 class="page-title">{S.test.title}</h1>
          <p class="page-sub">
            {template.name} · {S.test.sub(info.samples.length)}
          </p>
        </div>
        <div class="row">
          <button
            type="button"
            class="btn"
            onClick={() => navigate({ view: 'mapper', template: info.id })}
          >
            {S.test.backToMapper}
          </button>
          <ActionButton
            busyLabel={S.busy.saving}
            class="btn btn-primary"
            onAction={async () => {
              const saved = await saveVersion(ws, template, s.user, now());
              await idbDel(`draft:${template.id}`);
              setTemplate(saved);
              setMsg(S.mapper.savedAs(saved.version));
              app.announce(S.mapper.savedAs(saved.version));
              await refresh();
            }}
          >
            {S.mapper.saveTemplate}
          </ActionButton>
        </div>
      </div>
      {msg ? <Banner tone="success">{msg}</Banner> : null}
      <section class="card stack" aria-labelledby="summary">
        <div class="summary-line">
          {busy ? (
            <Working label={S.test.running(info.samples.length)} />
          ) : (
            <>
              <span class={`summary-icon ${passed === total ? 'is-pass' : 'is-fail'}`}>
                {passed === total ? <CheckIcon size={18} /> : <XIcon size={18} />}
              </span>
              <h2 id="summary" class="card-title" aria-live="polite">
                {S.test.summary(passed, total, runs.length)}
              </h2>
            </>
          )}
        </div>
        <DropZone
          compact
          onFiles={async (files) => {
            for (const f of files) await addSample(ws, info.id, f.name, await fileBytes(f));
            await refresh();
          }}
          label={S.test.addSamples}
        />
      </section>
      {!info.samples.length ? (
        <section class="card">
          <p>{S.test.noSamples}</p>
        </section>
      ) : (
        <>
          <section class="card" aria-label={S.test.title}>
            <div class="table-wrap" tabIndex={0}>
              <table class="data">
                <thead>
                  <tr>
                    <th scope="col">{S.test.rowItem}</th>
                    {runs.map((r) => (
                      <th key={r.name} scope="col">
                        <div class="row nowrap">
                          <span class="mono">{r.name}</span>
                          <ActionButton
                            busyLabel={S.busy.removing}
                            class="icon-btn"
                            aria-label={S.test.removeSample(r.name)}
                            onAction={async () => {
                              await removeSample(ws, info.id, r.name);
                              await refresh();
                            }}
                          >
                            <XIcon size={14} />
                          </ActionButton>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" class="mono">
                        {row.label}
                      </th>
                      {row.cells.map((c, i) => (
                        <td key={i} class={c.pass ? 'cell-pass' : 'cell-fail'}>
                          <span class="row">
                            {c.pass ? <CheckIcon size={14} /> : <XIcon size={14} />}
                            <span class="sr-only">{c.pass ? S.common.pass : S.common.fail}</span>
                            <span class={c.pass ? 'mono' : 'small'}>{c.text}</span>
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {allFixes.length ? (
            <div class="split">
              <section class="card stack" aria-labelledby="diag-title">
                <h2 id="diag-title" class="card-title">
                  {S.test.diagnostics}
                </h2>
                {allFixes.map(({ sample, fix }) => (
                  <div class="field-row suggested" key={`${sample}-${fix.field}`}>
                    <div class="grow">
                      <div>{S.test.addLabelFix(fix.label, fix.field)}</div>
                      <div class="caption mono">
                        {runs[sample]?.name} · {humanize(fix.field)}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn btn-small btn-text"
                      onClick={() => setFocusFix({ sample, fix })}
                    >
                      {S.test.snippetTitle}
                    </button>
                    <ActionButton
                      busyLabel={S.busy.applying}
                      class="btn btn-small btn-primary"
                      onAction={() => applyFix(fix)}
                    >
                      {S.test.apply}
                    </ActionButton>
                  </div>
                ))}
              </section>
              {shown && runs[shown.sample] ? (
                <Snippet bytes={runs[shown.sample]!.bytes} fix={shown.fix} />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function Snippet({ bytes, fix }: { bytes: Uint8Array; fix: LabelFix }) {
  const pdf = usePdf(bytes);
  return (
    <section class="card stack" aria-labelledby="snip-title">
      <h2 id="snip-title" class="card-title">
        {S.test.snippetTitle}
      </h2>
      {pdf.doc ? (
        <PageView
          doc={pdf.doc}
          page={fix.page}
          zoom={1.5}
          marks={[{ bbox: fix.bbox, kind: 'suggest', label: fix.label, tag: 'warn' }]}
          focusBox={fix.bbox}
          label={S.test.snippetTitle}
        />
      ) : null}
    </section>
  );
}
