import { useEffect, useRef, useState } from 'preact/hooks';
import { zipSync, strToU8 } from 'fflate';
import { baseName, toCsv, toJson, type Extraction, type TemplateSet } from '@pdfx/engine';
import { S } from '../strings';
import { app, useApp } from '../app/store';
import { navigate, useRoute } from '../app/router';
import { now, refresh } from '../app/session';
import { testHooks } from '../app/testing';
import { Banner, downloadBlob, fileBytes } from '../components/ui';
import { StatusChip, type AnyStatus } from '../components/StatusChip';
import { ScanIcon, DocIcon } from '../components/Icons';
import { extractBytes, sha256, type Progress } from '../lib/pipeline';
import { terminateOcr } from '../lib/ocr';
import { DIRS, stem } from '../workspace/paths';
import {
  listInbox,
  processFile,
  rowCount,
  detailFor,
  templateFor,
  type FileResult,
} from '../workspace/process';
import { recordRun } from './lastRuns';

interface Row {
  file: string;
  status: AnyStatus;
  result?: FileResult;
  ex?: Extraction;
}

function sets(): TemplateSet[] {
  return app
    .get()
    .templates.filter((t) => t.set.versions.length)
    .map((t) => t.set);
}

export function ProcessScreen() {
  const s = useApp();
  const route = useRoute();
  return s.basic ? <BasicProcess /> : <FolderProcess fromTeams={route.from === 'teams'} />;
}

function Tiles({ inbox, rows }: { inbox: number; rows: Row[] }) {
  const count = (st: AnyStatus) => rows.filter((r) => r.status === st).length;
  const written = rows.reduce(
    (n, r) => n + (r.status === 'ok' ? (r.result?.rows ?? rowCount(r.ex)) : 0),
    0,
  );
  const tiles: [string, number][] = [
    [S.process.tiles.inbox, inbox],
    [S.process.tiles.extracted, count('ok') + count('duplicate')],
    [S.process.tiles.review, count('review') + count('error') + count('ambiguous')],
    [S.process.tiles.unknown, count('unknown')],
    [S.process.tiles.rows, written],
  ];
  return (
    <div class="tiles">
      {tiles.map(([label, n]) => (
        <div class="tile" key={label}>
          <div class="tile-value">{n}</div>
          <div class="tile-label">{label}</div>
        </div>
      ))}
    </div>
  );
}

function FilesTable({
  rows,
  onReview,
  onCreate,
}: {
  rows: Row[];
  onReview?: (r: Row) => void;
  onCreate?: (r: Row) => void;
}) {
  return (
    <section class="card">
      <div class="table-wrap" tabIndex={0}>
        <table class="data" aria-label={S.process.title}>
          <thead>
            <tr>
              <th scope="col">{S.process.colFile}</th>
              <th scope="col">{S.process.colTemplate}</th>
              <th scope="col">{S.process.colPages}</th>
              <th scope="col">{S.process.colStatus}</th>
              <th scope="col">{S.process.colDetail}</th>
              <th scope="col">{S.process.colRows}</th>
              <th scope="col">{S.process.colNext}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ex = r.ex ?? r.result?.extraction;
              return (
                <tr key={r.file} data-file={r.file}>
                  <td>
                    <div class="mono">{r.file}</div>
                    {ex ? (
                      <div class="caption row">
                        {ex.ocr ? <ScanIcon size={12} /> : <DocIcon size={12} />}
                        {ex.ocr ? S.common.scanned : S.common.digital}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {ex?.template ? `${ex.template.name} · v${ex.template.version}` : S.common.none}
                  </td>
                  <td class="num">{ex?.pages || S.common.none}</td>
                  <td>
                    <StatusChip status={r.status} />
                  </td>
                  <td class="small">
                    {r.status === 'skipped' && r.result?.lock
                      ? S.common.inUse(r.result.lock.user, r.result.lock.since.slice(11, 16))
                      : (r.result?.detail ?? (ex ? detailFor(ex) : ''))}
                  </td>
                  <td class="num">{ex ? rowCount(ex) : ''}</td>
                  <td>
                    {r.status === 'ok' || r.status === 'duplicate' ? (
                      <span class="small">{S.process.nextSaved}</span>
                    ) : r.status === 'unknown' && onCreate ? (
                      <button
                        type="button"
                        class="btn btn-small btn-warn"
                        onClick={() => onCreate(r)}
                      >
                        {S.process.nextCreate}
                      </button>
                    ) : ['review', 'error', 'ambiguous', 'unknown'].includes(r.status) &&
                      onReview ? (
                      <button
                        type="button"
                        class="btn btn-small btn-warn"
                        onClick={() => onReview(r)}
                      >
                        {S.process.nextReview}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FolderProcess({ fromTeams }: { fromTeams: boolean }) {
  const s = useApp();
  const [inbox, setInbox] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [ocr, setOcr] = useState<Progress | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const cancel = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const ws = s.ws;

  const load = async () => {
    if (!ws) return;
    const files = (await listInbox(ws)).map((e) => e.name);
    setInbox(files);
    if (!running)
      setRows((prev) =>
        prev.some((r) => r.result) ? prev : files.map((f) => ({ file: f, status: 'pending' })),
      );
  };
  useEffect(() => {
    void load();
  }, [ws]);

  if (!ws) return null;

  const run = async () => {
    const files = (await listInbox(ws)).map((e) => e.name);
    if (!files.length) return;
    cancel.current = false;
    setCancelling(false);
    setRunning(true);
    setElapsed(null);
    setFailure(null);
    const start = performance.now();
    const list: Row[] = files.map((f) => ({ file: f, status: 'pending' }));
    setRows([...list]);
    const all = sets();
    const deps = {
      ws,
      user: s.user,
      now,
      sets: all,
      settings: s.settings,
      sha256,
      extract: (bytes: Uint8Array, _name: string, only: TemplateSet[]) =>
        extractBytes(bytes, only, { confidenceThreshold: s.settings.confidenceThreshold }, setOcr),
      afterStep: (step: number) => {
        const h = testHooks();
        if (h?.crashAfterStep === step) {
          h.crashAfterStep = null;
          throw new Error(`Simulated crash after step ${step}`);
        }
      },
    };
    const perTemplate = new Map<string, { ok: number; total: number }>();
    try {
      for (let i = 0; i < files.length; i++) {
        if (cancel.current) break;
        setIndex(i + 1);
        app.announce(S.process.progress(i + 1, files.length));
        list[i] = { file: files[i]!, status: 'running' };
        setRows([...list]);
        const res = await processFile(deps, `${DIRS.inbox}/${files[i]}`);
        setOcr(null);
        list[i] = { file: files[i]!, status: res.outcome, result: res };
        setRows([...list]);
        const tid = res.extraction?.template?.id;
        if (tid) {
          const p = perTemplate.get(tid) ?? { ok: 0, total: 0 };
          p.total++;
          if (res.outcome === 'ok') p.ok++;
          perTemplate.set(tid, p);
        }
      }
    } catch (e) {
      setFailure(String((e as Error).message ?? e));
    } finally {
      await terminateOcr().catch(() => undefined);
      const secs = (performance.now() - start) / 1000;
      setElapsed(secs);
      setRunning(false);
      const date = new Date().toLocaleDateString('en-AU');
      for (const [id, p] of perTemplate)
        recordRun(id, `${p.ok} of ${p.total} ${S.status.ok.toLowerCase()} · ${date}`);
      app.announce(S.process.finished(secs.toFixed(1)));
      await refresh();
      setInbox((await listInbox(ws)).map((e) => e.name));
    }
  };

  const written = rows.flatMap((r) => r.result?.written ?? []);

  return (
    <>
      {fromTeams ? <Banner>{S.process.fromTeams}</Banner> : null}
      <div class="page-head">
        <div>
          <h1 class="page-title">{S.process.title}</h1>
          <p class="page-sub mono">
            {S.process.paths(`${s.folderName}/${DIRS.inbox}`, `${s.folderName}/${DIRS.output}`)}
          </p>
        </div>
        <div class="row">
          {running ? (
            <>
              <div class="stack">
                <span aria-live="polite">{S.process.progress(index, rows.length)}</span>
                <div
                  class="progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={rows.length}
                  aria-valuenow={index}
                  aria-label={S.process.progress(index, rows.length)}
                >
                  <span
                    style={{
                      width: `${(100 * Math.max(0, index - 1)) / Math.max(1, rows.length)}%`,
                    }}
                  />
                </div>
                {ocr?.ocrPage ? (
                  <span class="caption">{S.process.ocrProgress(ocr.ocrPage)}</span>
                ) : null}
              </div>
              <button
                type="button"
                class="btn"
                disabled={cancelling}
                onClick={() => {
                  cancel.current = true;
                  setCancelling(true);
                }}
              >
                {cancelling ? S.process.cancelling : S.process.cancel}
              </button>
            </>
          ) : (
            <>
              {elapsed !== null ? (
                <span class="caption">{S.process.finished(elapsed.toFixed(1))}</span>
              ) : null}
              <button type="button" class="btn" onClick={() => void load()}>
                {S.process.refresh}
              </button>
              <button
                type="button"
                class="btn btn-primary"
                disabled={!inbox.length}
                onClick={() => void run()}
              >
                {inbox.length ? S.process.processN(inbox.length) : S.process.nothing}
              </button>
            </>
          )}
        </div>
      </div>
      {failure ? <Banner tone="danger">{failure}</Banner> : null}
      <Tiles inbox={inbox.length} rows={rows} />
      {rows.length ? (
        <FilesTable
          rows={rows}
          onReview={(r) => navigate({ view: 'review', file: r.file })}
          onCreate={async (r) => {
            const bytes = await ws.read(`${DIRS.exceptions}/${r.file}`);
            app.set({ pendingSample: { name: r.file, bytes, fromException: r.file } });
            navigate({ view: 'mapper', template: '' });
          }}
        />
      ) : null}
      <section class="card stack" aria-labelledby="written-title">
        <h2 id="written-title" class="card-title">
          {S.process.writtenTitle}
        </h2>
        {written.length ? (
          <ul class="list-plain mono small">
            {written.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : (
          <p class="muted small">{S.process.writtenNone}</p>
        )}
        <p class="caption">{S.process.writtenNote}</p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- basic mode

function BasicProcess() {
  const s = useApp();
  const [rows, setRows] = useState<(Row & { bytes: Uint8Array })[]>([]);
  const [running, setRunning] = useState(false);

  const openFiles = async (files: File[]) => {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
    const list: (Row & { bytes: Uint8Array })[] = await Promise.all(
      pdfs.map(async (f) => ({
        file: f.name,
        status: 'pending' as AnyStatus,
        bytes: await fileBytes(f),
      })),
    );
    setRows(list);
    setRunning(true);
    const all = sets();
    for (let i = 0; i < list.length; i++) {
      list[i]!.status = 'running';
      setRows([...list]);
      app.announce(S.process.progress(i + 1, list.length));
      const ex = await extractBytes(list[i]!.bytes, all, {
        confidenceThreshold: s.settings.confidenceThreshold,
      });
      list[i] = { ...list[i]!, status: ex.status, ex };
      setRows([...list]);
    }
    await terminateOcr().catch(() => undefined);
    setRunning(false);
  };

  const outputs = async () => {
    const files: Record<string, string> = {};
    const all = sets();
    for (const r of rows) {
      if (!r.ex) continue;
      const t = templateFor(all, r.ex) ?? null;
      const meta = {
        file: r.file,
        sha256: await sha256(r.bytes),
        extractedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
      files[`${baseName(r.file)}.json`] = toJson(r.ex, t, meta);
      if (t && r.ex.status === 'ok')
        for (const c of toCsv(r.ex, t, meta))
          files[`${baseName(r.file)}${c.table ? `.${c.table}` : ''}.csv`] = c.content;
    }
    return files;
  };

  return (
    <>
      <div class="page-head">
        <div>
          <h1 class="page-title">{S.process.title}</h1>
          <p class="page-sub">{S.basic.nothingMoved}</p>
        </div>
        <div class="row">
          <label class="btn btn-primary">
            {S.basic.openFiles}
            <input
              type="file"
              class="sr-only"
              accept=".pdf,application/pdf"
              multiple
              onChange={(e) => void openFiles([...((e.target as HTMLInputElement).files ?? [])])}
            />
          </label>
          <label class="btn">
            {S.basic.openFolder}
            <input
              type="file"
              class="sr-only"
              multiple
              ref={(el) => {
                if (el) el.setAttribute('webkitdirectory', '');
              }}
              onChange={(e) => void openFiles([...((e.target as HTMLInputElement).files ?? [])])}
            />
          </label>
        </div>
      </div>
      <Tiles inbox={rows.length} rows={rows} />
      {rows.length ? <FilesTable rows={rows} /> : null}
      {rows.length && !running ? (
        <section class="card row">
          <button
            type="button"
            class="btn"
            onClick={async () => {
              const files = await outputs();
              const csvs = Object.entries(files).filter(([n]) => n.endsWith('.csv'));
              for (const [n, c] of csvs) downloadBlob(n, c, 'text/csv');
            }}
          >
            {S.basic.downloadCsv}
          </button>
          <button
            type="button"
            class="btn"
            onClick={async () => {
              const files = await outputs();
              for (const [n, c] of Object.entries(files).filter(([n]) => n.endsWith('.json')))
                downloadBlob(n, c, 'application/json');
            }}
          >
            {S.basic.downloadJson}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onClick={async () => {
              const files = await outputs();
              downloadBlob(
                'pdf-extractor-results.zip',
                zipSync(Object.fromEntries(Object.entries(files).map(([n, c]) => [n, strToU8(c)]))),
                'application/zip',
              );
            }}
          >
            {S.basic.downloadZip}
          </button>
          <button
            type="button"
            class="btn"
            onClick={async () => {
              const XLSX = await import('xlsx');
              const wb = XLSX.utils.book_new();
              const files = await outputs();
              for (const [n, c] of Object.entries(files).filter(([x]) => x.endsWith('.csv'))) {
                const sheet = XLSX.read(c.replace(/^\uFEFF/, ''), { type: 'string', raw: true })
                  .Sheets.Sheet1!;
                XLSX.utils.book_append_sheet(wb, sheet, stem(n).slice(0, 31));
              }
              const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
              downloadBlob(
                'pdf-extractor-results.xlsx',
                new Uint8Array(out),
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              );
            }}
          >
            {S.basic.downloadXlsx}
          </button>
        </section>
      ) : null}
    </>
  );
}
