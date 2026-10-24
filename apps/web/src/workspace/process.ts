// Processing one file, in the exact order from section 3.6 of the build plan:
// 1 lock · 2 read + SHA-256 · 3 duplicate check · 4 extract · 5 write outputs or
// review file · 6 move the PDF · 7 audit · 8 release the lock.
import {
  baseName,
  latest,
  toCsv,
  toJson,
  toJsonObject,
  type Correction,
  type Extraction,
  type ExtractionJson,
  type Template,
  type TemplateSet,
} from '@pdfx/engine';
import type { Workspace } from './types';
import { S } from '../strings';
import { DIRS, basename, join, monthFolder, stem, uniqueName } from './paths';
import { appendAudit, releaseLock, takeLock, type Lock, type Settings } from './store';

export interface ReviewFile {
  schema: 'pdfx.review/1';
  file: string;
  sha256: string;
  receivedAt: string;
  template: { id: string; version: number } | null;
  extraction: Extraction;
  /** Edits in progress, saved as the person types. */
  edits: import('@pdfx/engine').Edit[];
  output: ExtractionJson;
}

export interface ProcessDeps {
  ws: Workspace;
  user: string;
  now: () => Date;
  sets: TemplateSet[];
  settings: Settings;
  sha256: (bytes: Uint8Array) => Promise<string>;
  extract: (bytes: Uint8Array, name: string, sets: TemplateSet[]) => Promise<Extraction>;
  /** Called after each numbered step. Tests use it to simulate a crash. */
  afterStep?: (step: number, file: string) => void | Promise<void>;
}

export type Outcome = Extraction['status'] | 'duplicate' | 'skipped';

export interface FileResult {
  file: string;
  outcome: Outcome;
  extraction?: Extraction;
  template?: Template;
  sha256?: string;
  rows: number;
  /** Paths written to Output. */
  written: string[];
  movedTo?: string;
  reviewPath?: string;
  lock?: Lock;
  detail: string;
}

export function templateFor(sets: TemplateSet[], ex: Extraction): Template | undefined {
  if (!ex.template) return undefined;
  const set = sets.find((s) => s.id === ex.template!.id);
  return (
    set?.versions.find((v) => v.version === ex.template!.version) ?? (set ? latest(set) : undefined)
  );
}

export function rowCount(ex: Extraction | undefined): number {
  return ex ? Object.values(ex.tables).reduce((s, t) => s + t.rows.length, 0) : 0;
}

export function detailFor(ex: Extraction): string {
  if (ex.status === 'ok') {
    const rows = rowCount(ex);
    const passed = ex.checks.filter((c) => c.result === 'pass').length;
    return S.process.detailOk(rows, passed, ex.checks.length);
  }
  return ex.reasons[0]?.message ?? '';
}

/** Finds an ok output for this file name with the same SHA-256 in any template folder. */
export async function findDuplicate(
  ws: Workspace,
  file: string,
  sha: string,
): Promise<string | null> {
  const base = baseName(file);
  let dirs: string[];
  try {
    dirs = (await ws.list(DIRS.output)).filter((e) => e.kind === 'dir').map((e) => e.name);
  } catch {
    return null;
  }
  for (const d of dirs) {
    for (const e of await ws.list(join(DIRS.output, d))) {
      if (!e.name.endsWith('.json')) continue;
      if (e.name !== `${base}.json` && !e.name.startsWith(`${base} (`)) continue;
      try {
        const j = JSON.parse(await ws.readText(join(DIRS.output, d, e.name))) as ExtractionJson;
        if (j.source?.sha256 === sha && j.status === 'ok') return join(DIRS.output, d, e.name);
      } catch {
        /* unreadable output: not a duplicate */
      }
    }
  }
  return null;
}

/** A base name in Output/<template> not used by any existing JSON or CSV. */
async function outputBase(ws: Workspace, dir: string, file: string): Promise<string> {
  const base = baseName(file);
  const taken = async (b: string) =>
    (await ws.exists(join(dir, `${b}.json`))) || (await ws.exists(join(dir, `${b}.csv`)));
  if (!(await taken(base))) return base;
  for (let n = 2; ; n++) if (!(await taken(`${base} (${n})`))) return `${base} (${n})`;
}

/** Writes CSV file(s) then the JSON. Returns the paths written. */
export async function writeOutputs(
  ws: Workspace,
  ex: Extraction,
  t: Template,
  file: string,
  sha: string,
  extractedAt: string,
  settings: Settings,
  review?: { reviewedBy: string; corrections: Correction[] },
): Promise<string[]> {
  const dir = join(DIRS.output, t.id);
  await ws.mkdir(dir);
  const base = await outputBase(ws, dir, file);
  const meta = {
    file,
    sha256: sha,
    extractedAt,
    reviewedBy: review?.reviewedBy ?? null,
    corrections: review?.corrections ?? [],
  };
  const written: string[] = [];
  for (const csv of toCsv(ex, t, meta, { bom: settings.csvBom })) {
    const p = join(dir, `${base}${csv.table ? `.${csv.table}` : ''}.csv`);
    await ws.write(p, csv.content);
    written.push(p);
  }
  const jp = join(dir, `${base}.json`);
  await ws.write(jp, toJson(ex, t, meta));
  written.push(jp);
  return written;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Processes one PDF from Inbox (or a re-run from Exceptions). */
export async function processFile(
  deps: ProcessDeps,
  path: string,
  onlySets?: TemplateSet[],
): Promise<FileResult> {
  const { ws, user } = deps;
  const file = basename(path);
  const fromExceptions = path.startsWith(`${DIRS.exceptions}/`);
  const step = async (n: number) => deps.afterStep?.(n, file);
  const subject = `file:${file}`;

  // 1. Lock
  const lock = await takeLock(ws, subject, user, 'process', deps.now());
  if (!lock.ok)
    return { file, outcome: 'skipped', rows: 0, written: [], lock: lock.lock, detail: '' };
  await step(1);
  try {
    // 2. Read and hash
    const bytes = await ws.read(path);
    const sha = await deps.sha256(bytes);
    await step(2);

    // 3. Duplicate?
    const dup = await findDuplicate(ws, file, sha);
    if (dup) {
      const dest = join(DIRS.processed, monthFolder(deps.now()));
      await ws.mkdir(dest);
      const name = await uniqueName(ws, dest, file);
      await ws.move(path, join(dest, name));
      if (fromExceptions)
        await ws.delete(join(DIRS.exceptions, `${stem(file)}.review.json`)).catch(() => undefined);
      await appendAudit(
        ws,
        user,
        [{ action: 'duplicate', file, sha256: sha, note: `Same as ${dup}` }],
        deps.now(),
      );
      return {
        file,
        outcome: 'duplicate',
        sha256: sha,
        rows: 0,
        written: [],
        movedTo: join(dest, name),
        detail: S.process.duplicateOf(dup),
      };
    }
    await step(3);

    // 4. Extract
    const ex = await deps.extract(bytes, file, onlySets ?? deps.sets);
    const t = templateFor(onlySets ?? deps.sets, ex);
    await step(4);

    // 5. Outputs or review file
    const now = iso(deps.now());
    let written: string[] = [];
    let reviewPath: string | undefined;
    let excName = file;
    if (ex.status === 'ok' && t) {
      written = await writeOutputs(ws, ex, t, file, sha, now, deps.settings);
    } else {
      excName = fromExceptions ? file : await uniqueName(ws, DIRS.exceptions, file);
      reviewPath = join(DIRS.exceptions, `${stem(excName)}.review.json`);
      const review: ReviewFile = {
        schema: 'pdfx.review/1',
        file: excName,
        sha256: sha,
        receivedAt: now,
        template: ex.template ? { id: ex.template.id, version: ex.template.version } : null,
        extraction: ex,
        edits: [],
        output: toJsonObject(ex, t ?? null, { file: excName, sha256: sha, extractedAt: now }),
      };
      await ws.write(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
    }
    await step(5);

    // 6. Move the PDF
    let movedTo: string;
    if (ex.status === 'ok' && t) {
      const dest = join(DIRS.processed, monthFolder(deps.now()));
      await ws.mkdir(dest);
      movedTo = join(dest, await uniqueName(ws, dest, file));
      await ws.move(path, movedTo);
      if (fromExceptions)
        await ws.delete(join(DIRS.exceptions, `${stem(file)}.review.json`)).catch(() => undefined);
    } else if (fromExceptions) {
      movedTo = path;
    } else {
      movedTo = join(DIRS.exceptions, excName);
      await ws.move(path, movedTo);
    }
    await step(6);

    // 7. Audit
    await appendAudit(
      ws,
      user,
      [
        {
          action: 'extracted',
          file,
          sha256: sha,
          template: ex.template?.id,
          version: ex.template?.version,
          note: ex.status,
        },
      ],
      deps.now(),
    );
    await step(7);

    return {
      file,
      outcome: ex.status,
      extraction: ex,
      ...(t ? { template: t } : {}),
      sha256: sha,
      rows: rowCount(ex),
      written,
      movedTo,
      ...(reviewPath ? { reviewPath } : {}),
      detail: detailFor(ex),
    };
  } finally {
    // 8. Release the lock
    await releaseLock(ws, subject, user);
  }
}

export async function listInbox(
  ws: Workspace,
): Promise<{ name: string; size?: number; lastModified?: number }[]> {
  try {
    return (await ws.list(DIRS.inbox)).filter((e) => e.kind === 'file' && /\.pdf$/i.test(e.name));
  } catch {
    return [];
  }
}
