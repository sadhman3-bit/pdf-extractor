import { applyEdits, toJsonObject, type Edit, type Extraction, type Template } from '@pdfx/engine';
import type { Workspace } from './types';
import { DIRS, join, monthFolder, stem, uniqueName } from './paths';
import { appendAudit, type Settings } from './store';
import { writeOutputs, type ReviewFile } from './process';

export interface ReviewItem {
  name: string;
  reviewPath: string;
  pdfPath: string;
  review: ReviewFile;
  receivedAt: string;
}

export async function listExceptions(ws: Workspace): Promise<ReviewItem[]> {
  let entries: { name: string; kind: string }[];
  try {
    entries = await ws.list(DIRS.exceptions);
  } catch {
    return [];
  }
  const out: ReviewItem[] = [];
  for (const e of entries) {
    if (e.kind !== 'file' || !e.name.endsWith('.review.json')) continue;
    try {
      const review = JSON.parse(await ws.readText(join(DIRS.exceptions, e.name))) as ReviewFile;
      out.push({
        name: review.file,
        reviewPath: join(DIRS.exceptions, e.name),
        pdfPath: join(DIRS.exceptions, review.file),
        review,
        receivedAt: review.receivedAt,
      });
    } catch {
      /* skip unreadable review files */
    }
  }
  return out.sort(
    (a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.name.localeCompare(b.name),
  );
}

export async function countExceptions(ws: Workspace): Promise<number> {
  try {
    return (await ws.list(DIRS.exceptions)).filter((e) => e.name.endsWith('.review.json')).length;
  } catch {
    return 0;
  }
}

/** Saves edits in progress so reopening restores them. */
export async function saveEdits(ws: Workspace, item: ReviewItem, edits: Edit[]): Promise<void> {
  const review = { ...item.review, edits };
  await ws.write(item.reviewPath, `${JSON.stringify(review, null, 2)}\n`);
  item.review = review;
}

export function previewEdits(ex: Extraction, t: Template, edits: Edit[], threshold: number) {
  return applyEdits(ex, t, edits, { confidenceThreshold: threshold });
}

/** Approve: write outputs (reviewed, corrected), move the PDF to Processed, delete the review file, audit. */
export async function approve(
  ws: Workspace,
  item: ReviewItem,
  t: Template,
  edits: Edit[],
  user: string,
  settings: Settings,
  now: Date,
): Promise<string[]> {
  const { extraction, corrections } = previewEdits(
    item.review.extraction,
    t,
    edits,
    settings.confidenceThreshold,
  );
  const approved: Extraction = { ...extraction, status: 'ok', reasons: [] };
  const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const written = await writeOutputs(ws, approved, t, item.name, item.review.sha256, at, settings, {
    reviewedBy: user,
    corrections,
  });
  const dest = join(DIRS.processed, monthFolder(now));
  await ws.mkdir(dest);
  await ws.move(item.pdfPath, join(dest, await uniqueName(ws, dest, item.name)));
  await ws.delete(item.reviewPath);
  await appendAudit(
    ws,
    user,
    [
      ...corrections.map((c) => ({
        action: 'corrected' as const,
        file: item.name,
        sha256: item.review.sha256,
        template: t.id,
        version: t.version,
        field: c.table ? `${c.table}[${(c.row ?? 0) + 1}].${c.field}` : c.field,
        oldValue: c.from,
        newValue: c.to,
      })),
      {
        action: 'approved',
        file: item.name,
        sha256: item.review.sha256,
        template: t.id,
        version: t.version,
      },
    ],
    now,
  );
  return written;
}

export async function reject(
  ws: Workspace,
  item: ReviewItem,
  user: string,
  now: Date,
): Promise<void> {
  await ws.mkdir(DIRS.rejected);
  const name = await uniqueName(ws, DIRS.rejected, item.name);
  await ws.move(item.pdfPath, join(DIRS.rejected, name));
  await ws.move(item.reviewPath, join(DIRS.rejected, `${stem(name)}.review.json`));
  await appendAudit(
    ws,
    user,
    [
      {
        action: 'rejected',
        file: item.name,
        sha256: item.review.sha256,
        template: item.review.template?.id,
      },
    ],
    now,
  );
}

export async function skip(
  ws: Workspace,
  item: ReviewItem,
  user: string,
  now: Date,
): Promise<void> {
  await appendAudit(
    ws,
    user,
    [
      {
        action: 'skipped',
        file: item.name,
        sha256: item.review.sha256,
        template: item.review.template?.id,
      },
    ],
    now,
  );
}

export { toJsonObject };
