// Workspace-level operations: bootstrap, settings, locks, audit and templates.
import { z } from 'zod';
import { parseTemplate, type Template, type TemplateSet } from '@pdfx/engine';
import type { Workspace } from './types';
import {
  BOOTSTRAP_DIRS,
  DIRS,
  SETTINGS_FILE,
  join,
  monthFolder,
  safeUserFolder,
  uniqueName,
} from './paths';
import { csvLine } from './csv';

// ---------------------------------------------------------------- bootstrap

export async function missingFolders(ws: Workspace): Promise<string[]> {
  const out: string[] = [];
  for (const d of BOOTSTRAP_DIRS) if (!(await ws.exists(d))) out.push(d);
  return out;
}

/** Creates the folder tree, calling `onStep` before each folder (and before settings.json). */
export async function createFolders(ws: Workspace, onStep?: (path: string) => void): Promise<void> {
  for (const d of BOOTSTRAP_DIRS) {
    onStep?.(d);
    await ws.mkdir(d);
  }
  onStep?.(SETTINGS_FILE);
  if (!(await ws.exists(SETTINGS_FILE))) await saveSettings(ws, DEFAULT_SETTINGS);
}

// ---------------------------------------------------------------- settings

export const settingsSchema = z.looseObject({
  schema: z.literal('pdfx.settings/1'),
  confidenceThreshold: z.number().min(0).max(1).default(0.8),
  dateOutput: z.literal('iso').default('iso'),
  csvBom: z.boolean().default(true),
  autoCreateFolders: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  schema: 'pdfx.settings/1',
  confidenceThreshold: 0.8,
  dateOutput: 'iso',
  csvBom: true,
  autoCreateFolders: true,
};

export async function loadSettings(ws: Workspace): Promise<Settings> {
  try {
    const r = settingsSchema.safeParse(JSON.parse(await ws.readText(SETTINGS_FILE)));
    return r.success ? r.data : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(ws: Workspace, s: Settings): Promise<void> {
  await ws.write(SETTINGS_FILE, `${JSON.stringify(s, null, 2)}\n`);
}

// ---------------------------------------------------------------- locks

export const LOCK_STALE_MS = 30 * 60 * 1000;

export interface Lock {
  user: string;
  since: string;
  what: string;
}

export async function lockKey(subject: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject));
  return [...new Uint8Array(h)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isStale(lock: Lock, now: Date): boolean {
  const t = Date.parse(lock.since);
  return !Number.isFinite(t) || now.getTime() - t > LOCK_STALE_MS;
}

export async function readLock(ws: Workspace, subject: string): Promise<Lock | null> {
  try {
    return JSON.parse(
      await ws.readText(join(DIRS.locks, `${await lockKey(subject)}.json`)),
    ) as Lock;
  } catch {
    return null;
  }
}

/** A fresh lock held by someone else, or null. */
export async function heldBy(
  ws: Workspace,
  subject: string,
  user: string,
  now: Date,
): Promise<Lock | null> {
  const l = await readLock(ws, subject);
  if (!l || l.user === user || isStale(l, now)) return null;
  return l;
}

export async function takeLock(
  ws: Workspace,
  subject: string,
  user: string,
  what: string,
  now: Date,
  force = false,
): Promise<{ ok: true } | { ok: false; lock: Lock }> {
  if (!force) {
    const other = await heldBy(ws, subject, user, now);
    if (other) return { ok: false, lock: other };
  }
  const lock: Lock = { user, since: now.toISOString(), what };
  await ws.write(join(DIRS.locks, `${await lockKey(subject)}.json`), `${JSON.stringify(lock)}\n`);
  return { ok: true };
}

export async function releaseLock(ws: Workspace, subject: string, user: string): Promise<void> {
  const path = join(DIRS.locks, `${await lockKey(subject)}.json`);
  const l = await readLock(ws, subject);
  if (l && l.user !== user) return;
  await ws.delete(path).catch(() => undefined);
}

// ---------------------------------------------------------------- audit

export type AuditAction =
  | 'extracted'
  | 'duplicate'
  | 'corrected'
  | 'approved'
  | 'skipped'
  | 'rejected'
  | 'template_saved'
  | 'template_archived';

export interface AuditRow {
  action: AuditAction;
  file?: string;
  sha256?: string;
  template?: string;
  version?: number | string;
  field?: string;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  note?: string;
}

export const AUDIT_HEADER = [
  'Timestamp',
  'User',
  'Action',
  'File',
  'Sha256',
  'Template',
  'Version',
  'Field',
  'OldValue',
  'NewValue',
  'Note',
];

export function auditPath(user: string, now: Date): string {
  return join(DIRS.audit, safeUserFolder(user), `audit_${monthFolder(now)}.csv`);
}

/** Appends audit lines to Audit/<user>/audit_YYYY-MM.csv (one file per person per month). */
export async function appendAudit(
  ws: Workspace,
  user: string,
  rows: AuditRow[],
  now: Date,
): Promise<void> {
  if (!rows.length) return;
  const path = auditPath(user, now);
  let existing: string;
  try {
    existing = await ws.readText(path);
  } catch {
    existing = `\uFEFF${csvLine(AUDIT_HEADER)}\r\n`;
  }
  const lines = rows.map((r) =>
    csvLine([
      now.toISOString(),
      user,
      r.action,
      r.file,
      r.sha256,
      r.template,
      r.version,
      r.field,
      r.oldValue,
      r.newValue,
      r.note,
    ]),
  );
  await ws.write(path, `${existing}${lines.join('\r\n')}\r\n`);
}

// ---------------------------------------------------------------- templates

export interface TemplateInfo {
  id: string;
  latest: Template;
  set: TemplateSet;
  samples: string[];
  hasDraft: boolean;
  invalid: string[];
}

export async function loadTemplates(ws: Workspace): Promise<TemplateInfo[]> {
  const out: TemplateInfo[] = [];
  let dirs: string[];
  try {
    dirs = (await ws.list(DIRS.templates))
      .filter((e) => e.kind === 'dir' && !e.name.startsWith('_'))
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const id of dirs) {
    const entries = await ws.list(join(DIRS.templates, id));
    const versions: Template[] = [];
    const invalid: string[] = [];
    for (const e of entries) {
      if (e.kind !== 'file' || !/^v\d+\.json$/.test(e.name)) continue;
      try {
        const r = parseTemplate(JSON.parse(await ws.readText(join(DIRS.templates, id, e.name))));
        if (r.ok) versions.push(r.template);
        else invalid.push(`${e.name}: ${r.errors[0]}`);
      } catch (err) {
        invalid.push(`${e.name}: ${(err as Error).message}`);
      }
    }
    const hasDraft = entries.some((e) => e.name === 'draft.json');
    let samples: string[] = [];
    if (entries.some((e) => e.name === 'samples' && e.kind === 'dir')) {
      samples = (await ws.list(join(DIRS.templates, id, 'samples')))
        .filter((e) => e.kind === 'file' && /\.pdf$/i.test(e.name))
        .map((e) => e.name);
    }
    if (!versions.length && !hasDraft) continue;
    versions.sort((a, b) => a.version - b.version);
    const latest = versions[versions.length - 1];
    if (latest) out.push({ id, latest, set: { id, versions }, samples, hasDraft, invalid });
    else {
      const draft = await loadDraft(ws, id);
      if (draft)
        out.push({
          id,
          latest: draft.template,
          set: { id, versions: [] },
          samples,
          hasDraft,
          invalid,
        });
    }
  }
  return out.sort((a, b) => a.latest.name.localeCompare(b.latest.name));
}

export interface Draft {
  template: Template;
  savedAt: string;
  /** Path of the sample the person was mapping, if any. */
  sample?: string;
}

export async function loadDraft(ws: Workspace, id: string): Promise<Draft | null> {
  try {
    const d = JSON.parse(await ws.readText(join(DIRS.templates, id, 'draft.json'))) as Draft;
    const r = parseTemplate(d.template);
    return r.ok ? { ...d, template: r.template } : null;
  } catch {
    return null;
  }
}

export async function saveDraft(ws: Workspace, draft: Draft): Promise<void> {
  await ws.write(
    join(DIRS.templates, draft.template.id, 'draft.json'),
    `${JSON.stringify(draft, null, 2)}\n`,
  );
}

export async function discardDraft(ws: Workspace, id: string): Promise<void> {
  await ws.delete(join(DIRS.templates, id, 'draft.json')).catch(() => undefined);
}

/** Saves the draft as the next version (immutable), deletes draft.json and audits it. */
export async function saveVersion(
  ws: Workspace,
  t: Template,
  user: string,
  now: Date,
): Promise<Template> {
  const dir = join(DIRS.templates, t.id);
  let max = 0;
  try {
    for (const e of await ws.list(dir)) {
      const m = /^v(\d+)\.json$/.exec(e.name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {
    /* new template */
  }
  const saved: Template = {
    ...t,
    version: max + 1,
    savedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    savedBy: user,
  };
  const r = parseTemplate(saved);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  await ws.write(join(dir, `v${saved.version}.json`), `${JSON.stringify(saved, null, 2)}\n`);
  await discardDraft(ws, t.id);
  await appendAudit(
    ws,
    user,
    [{ action: 'template_saved', template: t.id, version: saved.version }],
    now,
  );
  return saved;
}

export async function archiveTemplate(
  ws: Workspace,
  id: string,
  user: string,
  now: Date,
): Promise<void> {
  await ws.mkdir(DIRS.archived);
  let target = join(DIRS.archived, id);
  if (await ws.exists(target)) target = join(DIRS.archived, `${id}-${now.getTime()}`);
  await ws.move(join(DIRS.templates, id), target);
  await appendAudit(ws, user, [{ action: 'template_archived', template: id }], now);
}

export async function importTemplate(
  ws: Workspace,
  data: unknown,
  user: string,
  now: Date,
): Promise<Template> {
  const r = parseTemplate(data);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return saveVersion(ws, r.template, user, now);
}

export async function addSample(
  ws: Workspace,
  id: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = join(DIRS.templates, id, 'samples');
  await ws.mkdir(dir);
  const n = await uniqueName(ws, dir, name);
  await ws.write(join(dir, n), bytes);
  return n;
}

export async function removeSample(ws: Workspace, id: string, name: string): Promise<void> {
  await ws.delete(join(DIRS.templates, id, 'samples', name));
}

export async function sampleBytes(ws: Workspace, id: string, name: string): Promise<Uint8Array> {
  return ws.read(join(DIRS.templates, id, 'samples', name));
}
