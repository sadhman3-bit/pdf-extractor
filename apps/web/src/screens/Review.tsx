import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BBox, Edit, Extraction, Template, TemplateSet } from '@pdfx/engine';
import { S } from '../strings';
import { app, useApp } from '../app/store';
import { navigate, useRoute } from '../app/router';
import { now, refresh } from '../app/session';
import { Banner, dateTime, timeHM } from '../components/ui';
import { StatusChip } from '../components/StatusChip';
import { ScanIcon } from '../components/Icons';
import { PageView, usePdf, type Mark } from '../components/PageView';
import { extractBytes, sha256 } from '../lib/pipeline';
import { terminateOcr } from '../lib/ocr';
import { DIRS } from '../workspace/paths';
import { heldBy, takeLock, releaseLock, type Lock } from '../workspace/store';
import {
  approve,
  listExceptions,
  previewEdits,
  reject,
  saveEdits,
  skip,
  type ReviewItem,
} from '../workspace/review';
import { processFile } from '../workspace/process';

function templateOf(item: ReviewItem): Template | undefined {
  const ref = item.review.template;
  if (!ref) return undefined;
  const info = app.get().templates.find((t) => t.id === ref.id);
  return info?.set.versions.find((v) => v.version === ref.version) ?? info?.latest;
}

export function ReviewScreen() {
  const s = useApp();
  const route = useRoute();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const ws = s.ws;

  const load = async () => {
    if (!ws) return;
    setItems(await listExceptions(ws));
  };
  useEffect(() => {
    void load();
  }, [ws, route.file]);

  if (!ws || s.basic) {
    return (
      <>
        <h1 class="page-title">{S.review.title}</h1>
        <section class="card">
          <p>{S.basic.nothingMoved}</p>
        </section>
      </>
    );
  }
  if (!items) return <p class="muted">{S.common.loading}</p>;

  const open = route.file ? items.find((i) => i.name === route.file) : undefined;
  if (open) {
    return (
      <Detail
        key={open.reviewPath}
        item={open}
        onDone={async (text) => {
          setMsg(text);
          if (text) app.announce(text);
          await refresh();
          navigate({ view: 'review' });
        }}
      />
    );
  }

  const codes = [...new Set(items.map((i) => i.review.extraction.reasons[0]?.code ?? ''))].filter(
    Boolean,
  );
  const shown = items.filter((i) => !filter || i.review.extraction.reasons[0]?.code === filter);
  return (
    <>
      <div class="page-head">
        <div>
          <h1 class="page-title">{S.review.title}</h1>
          <p class="page-sub">{S.review.sub}</p>
        </div>
        {codes.length > 1 ? (
          <label class="field">
            {S.review.filterLabel}
            <select
              value={filter}
              onChange={(e) => setFilter((e.target as HTMLSelectElement).value)}
            >
              <option value="">{S.review.filterAll}</option>
              {codes.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {msg ? <Banner tone="success">{msg}</Banner> : null}
      {!items.length ? (
        <section class="card">
          <p>{S.review.empty}</p>
        </section>
      ) : (
        <section class="card">
          <div class="table-wrap" tabIndex={0}>
            <table class="data">
              <thead>
                <tr>
                  <th scope="col">{S.review.colFile}</th>
                  <th scope="col">{S.process.colStatus}</th>
                  <th scope="col">{S.review.colReason}</th>
                  <th scope="col">{S.review.colReceived}</th>
                  <th scope="col">
                    <span class="sr-only">{S.review.open}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.reviewPath}>
                    <td class="mono">{i.name}</td>
                    <td>
                      <StatusChip status={i.review.extraction.status} />
                    </td>
                    <td class="small">{i.review.extraction.reasons[0]?.message}</td>
                    <td class="small">{dateTime(i.receivedAt)}</td>
                    <td>
                      <button
                        type="button"
                        class="btn btn-small btn-warn"
                        onClick={() => navigate({ view: 'review', file: i.name })}
                      >
                        {S.review.open}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function Detail({ item, onDone }: { item: ReviewItem; onDone: (msg: string) => void }) {
  const s = useApp();
  const ws = s.ws!;
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [edits, setEdits] = useState<Edit[]>(item.review.edits ?? []);
  const [lock, setLock] = useState<Lock | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const timer = useRef<number | null>(null);
  const pdf = usePdf(bytes);
  const ex = item.review.extraction;
  const t = templateOf(item);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const other = await heldBy(ws, `review:${item.name}`, s.user, now());
      if (other) setLock(other);
      else await takeLock(ws, `review:${item.name}`, s.user, 'review', now());
      const b = await ws.read(item.pdfPath).catch(() => null);
      if (alive) setBytes(b);
    })();
    return () => {
      alive = false;
      void releaseLock(ws, `review:${item.name}`, s.user);
    };
  }, [item.reviewPath]);

  const preview = useMemo(
    () => (t ? previewEdits(ex, t, edits, s.settings.confidenceThreshold) : null),
    [ex, t, edits, s.settings.confidenceThreshold],
  );
  const current: Extraction = preview?.extraction ?? ex;
  const blocking = current.reasons.filter((r) => r.code !== 'low_confidence');
  const canApprove =
    !!t &&
    ex.status === 'review' &&
    current.checks.every((c) => c.severity !== 'error' || c.result === 'pass') &&
    !blocking.length;

  const firstProblem = ex.reasons.find((r) => r.bbox);
  useEffect(() => {
    if (firstProblem?.page) setPageNo(firstProblem.page);
  }, [firstProblem?.page]);

  const setEdit = (e: Edit) => {
    const key = (x: Edit) => (x.field ? `f:${x.field}` : `t:${x.table}:${x.row}:${x.column}`);
    const next = [...edits.filter((x) => key(x) !== key(e)), e];
    setEdits(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveEdits(ws, item, next), 400);
  };
  /** Cancels a pending autosave so it can't rewrite the review file after it has been handled. */
  const stopAutosave = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const editValue = (e: Omit<Edit, 'to'>, fallback: string) =>
    edits.find((x) =>
      e.field
        ? x.field === e.field
        : x.table === e.table && x.row === e.row && x.column === e.column,
    )?.to ?? fallback;

  const marks: Mark[] = [];
  for (const r of current.reasons)
    if (r.bbox && r.page === pageNo) marks.push({ bbox: r.bbox, kind: 'error' });
  const focusBox: BBox | null =
    firstProblem?.bbox && firstProblem.page === pageNo ? firstProblem.bbox : null;

  const rerun = async (only?: TemplateSet[]) => {
    stopAutosave();
    setBusy(true);
    setError(null);
    try {
      const deps = {
        ws,
        user: s.user,
        now,
        sets: app
          .get()
          .templates.filter((x) => x.set.versions.length)
          .map((x) => x.set),
        settings: s.settings,
        sha256,
        extract: (b: Uint8Array, _n: string, sets: TemplateSet[]) =>
          extractBytes(b, sets, { confidenceThreshold: s.settings.confidenceThreshold }),
      };
      const r = await processFile(deps, `${DIRS.exceptions}/${item.name}`, only);
      await terminateOcr().catch(() => undefined);
      onDone(
        r.outcome === 'ok' ? `${S.status.ok}: ${item.name}` : `${S.status[r.outcome]}: ${r.detail}`,
      );
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="page-head">
        <div class="stack">
          <nav class="breadcrumb" aria-label={S.review.title}>
            <a
              href="?view=review"
              onClick={(e) => {
                e.preventDefault();
                navigate({ view: 'review' });
              }}
            >
              {S.review.back}
            </a>
          </nav>
          <h1 class="page-title mono">{item.name}</h1>
          <div class="row">
            <StatusChip status={ex.status} />
            {ex.ocr ? (
              <span class="chip">
                <ScanIcon size={12} />
                {S.common.scanned}
              </span>
            ) : null}
            {ex.template ? (
              <span class="caption">
                {ex.template.name} · v{ex.template.version}
              </span>
            ) : null}
          </div>
        </div>
        <div class="row">
          <button
            type="button"
            class="btn"
            disabled={busy}
            onClick={async () => {
              stopAutosave();
              await saveEdits(ws, item, edits);
              await skip(ws, item, s.user, now());
              onDone('');
            }}
          >
            {S.review.skip}
          </button>
          <button
            type="button"
            class="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              stopAutosave();
              await reject(ws, item, s.user, now());
              onDone(S.review.rejected(item.name));
            }}
          >
            {S.review.reject}
          </button>
          {ex.status === 'review' ? (
            <button
              type="button"
              class="btn btn-primary"
              disabled={!canApprove || busy}
              aria-describedby={!canApprove ? 'approve-hint' : undefined}
              onClick={async () => {
                if (!t) return;
                stopAutosave();
                setBusy(true);
                await approve(ws, item, t, edits, s.user, s.settings, now());
                onDone(S.review.approved(item.name));
              }}
            >
              {S.review.approve}
            </button>
          ) : null}
        </div>
      </div>
      {lock ? (
        <Banner
          tone="warn"
          action={
            <button
              type="button"
              class="btn"
              onClick={async () => {
                await takeLock(ws, `review:${item.name}`, s.user, 'review', now(), true);
                setLock(null);
              }}
            >
              {S.common.openAnyway}
            </button>
          }
        >
          {S.common.inUse(lock.user, timeHM(lock.since))}
        </Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {ex.status === 'review' ? (
        canApprove ? (
          <Banner tone="success">{S.review.allPass}</Banner>
        ) : (
          <Banner tone="danger">
            {blocking.map((r, i) => (
              <p key={i}>{r.message}</p>
            ))}
            <p id="approve-hint" class="small">
              {S.review.approveDisabled}
            </p>
          </Banner>
        )
      ) : (
        <Banner tone={ex.status === 'error' ? 'danger' : 'warn'}>
          {ex.reasons.map((r, i) => (
            <p key={i}>{r.message}</p>
          ))}
          {ex.status === 'error' ? <p>{S.review.unreadable}</p> : null}
        </Banner>
      )}

      {ex.status === 'unknown' ? (
        <section class="card row">
          <button
            type="button"
            class="btn btn-primary"
            onClick={() => {
              if (!bytes) return;
              app.set({ pendingSample: { name: item.name, bytes, fromException: item.name } });
              navigate({ view: 'mapper', template: '' });
            }}
          >
            {S.review.createTemplate}
          </button>
          <button
            type="button"
            class="btn"
            disabled={busy || !s.templates.length}
            onClick={() => void rerun()}
          >
            {S.review.rerun}
          </button>
        </section>
      ) : null}
      {ex.status === 'ambiguous' ? (
        <section class="card stack">
          <h2 class="card-title">{S.review.chooseTemplate}</h2>
          <p>{S.review.candidates}</p>
          <div class="row">
            {ex.candidates.map((c) => {
              const set = s.templates.find((x) => x.id === c.id)?.set;
              return (
                <button
                  key={c.id}
                  type="button"
                  class="btn"
                  disabled={busy || !set}
                  onClick={() => set && void rerun([set])}
                >
                  {S.review.useTemplate(c.name)}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <div class="split">
        <section class="card stack" aria-label={item.name}>
          {pdf.doc ? (
            <>
              <PageView
                doc={pdf.doc}
                page={pageNo}
                zoom={1}
                marks={marks}
                focusBox={focusBox}
                label={item.name}
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
                  <span>{S.common.pageOf(pageNo, pdf.pages)}</span>
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
          ) : pdf.error ? (
            <p class="muted">{pdf.error}</p>
          ) : null}
        </section>
        {t && ex.status === 'review' ? (
          <div class="stack">
            <section class="card stack" aria-labelledby="rv-fields">
              <h2 id="rv-fields" class="card-title">
                {S.review.fields}
              </h2>
              {t.fields.map((f) => {
                const r = current.fields[f.name];
                const orig = ex.fields[f.name];
                const low =
                  !!orig && orig.value !== null && orig.conf < s.settings.confidenceThreshold;
                return (
                  <label class="field" key={f.name}>
                    <span class="mono">{f.name}</span>
                    <input
                      type="text"
                      class={`mono${low ? ' cell-low' : ''}`}
                      value={editValue({ field: f.name }, orig?.csv ?? '')}
                      aria-invalid={!!r?.error && !!f.required}
                      onInput={(e) =>
                        setEdit({ field: f.name, to: (e.target as HTMLInputElement).value })
                      }
                    />
                    {low ? <span class="caption">{S.review.lowConf(orig!.csv)}</span> : null}
                  </label>
                );
              })}
            </section>
            {(t.tables ?? []).map((tb) => (
              <section class="card stack" key={tb.name} aria-label={tb.name}>
                <h2 class="card-title">{tb.name}</h2>
                <div class="table-wrap" tabIndex={0}>
                  <table class="data">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        {tb.columns.map((c) => (
                          <th key={c.name} scope="col">
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(ex.tables[tb.name]?.rows ?? []).map((row, ri) => (
                        <tr key={ri}>
                          <th scope="row">{ri + 1}</th>
                          {tb.columns.map((c) => {
                            const cell = row.cells[c.name]!;
                            const low =
                              cell.value !== null && cell.conf < s.settings.confidenceThreshold;
                            const bad = !!current.tables[tb.name]?.rows[ri]?.cells[c.name]?.error;
                            return (
                              <td key={c.name} class={bad ? 'cell-fail' : low ? 'cell-low' : ''}>
                                <input
                                  type="text"
                                  aria-label={S.review.cellLabel(tb.name, ri + 1, c.name)}
                                  value={editValue(
                                    { table: tb.name, row: ri, column: c.name },
                                    cell.csv || cell.raw,
                                  )}
                                  onInput={(e) =>
                                    setEdit({
                                      table: tb.name,
                                      row: ri,
                                      column: c.name,
                                      to: (e.target as HTMLInputElement).value,
                                    })
                                  }
                                />
                                {low ? (
                                  <span class="caption">{S.review.lowConf(cell.csv)}</span>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            <section class="card stack" aria-labelledby="rv-checks">
              <h2 id="rv-checks" class="card-title">
                {S.review.checks}
              </h2>
              <ul class="list-plain" aria-live="polite">
                {current.checks.map((c) => (
                  <li key={c.id} class="row">
                    <span
                      class={`chip chip-${c.result === 'pass' ? 'success' : c.severity === 'error' ? 'danger' : 'warn'}`}
                    >
                      {c.result === 'pass' ? S.common.pass : S.common.fail}
                    </span>
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </div>
    </>
  );
}
