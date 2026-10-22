import type { Workspace } from './types';

export const DIRS = {
  inbox: 'Inbox',
  processed: 'Processed',
  exceptions: 'Exceptions',
  rejected: 'Exceptions/Rejected',
  output: 'Output',
  templates: 'Templates',
  archived: 'Templates/_archived',
  audit: 'Audit',
  locks: '.locks',
} as const;

/** Folders created on first run (shown to the person before creating them). */
export const BOOTSTRAP_DIRS = [
  DIRS.inbox,
  DIRS.processed,
  DIRS.exceptions,
  DIRS.output,
  DIRS.templates,
  DIRS.archived,
  DIRS.audit,
  DIRS.locks,
];

export const SETTINGS_FILE = 'settings.json';

export function join(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split('/'))
    .filter((p) => p && p !== '.')
    .join('/');
}

export function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export function dirname(path: string): string {
  const s = split(path);
  return s.slice(0, -1).join('/');
}

export function basename(path: string): string {
  const s = split(path);
  return s[s.length - 1] ?? '';
}

export function stem(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}

/** "2026-10" for a date. */
export function monthFolder(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A name for `name` inside `dir` that doesn't exist yet: "a.pdf", "a (2).pdf", "a (3).pdf" … */
export async function uniqueName(ws: Workspace, dir: string, name: string): Promise<string> {
  if (!(await ws.exists(join(dir, name)))) return name;
  const s = stem(name);
  const e = extension(name);
  for (let n = 2; n < 10000; n++) {
    const candidate = `${s} (${n})${e}`;
    if (!(await ws.exists(join(dir, candidate)))) return candidate;
  }
  throw new Error('Too many files with the same name');
}

/** A folder-safe version of a person's name. */
export function safeUserFolder(user: string): string {
  return user.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Unknown';
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'template'
  );
}
