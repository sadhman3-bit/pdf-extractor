import { NotFoundError, type Entry, type Workspace } from './types';
import { dirname, join, split } from './paths';

/** In-memory workspace for unit tests. */
export class MemoryWorkspace implements Workspace {
  readonly kind = 'memory' as const;
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(['']);
  /** Every write and move, in order, for tests of write order. */
  readonly log: string[] = [];

  constructor(readonly name = 'Memory') {}

  private ensureDir(path: string) {
    const parts = split(path);
    for (let i = 0; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'));
  }

  async list(dir: string): Promise<Entry[]> {
    const d = join(dir);
    if (!this.dirs.has(d)) throw new NotFoundError(dir);
    const out = new Map<string, Entry>();
    const prefix = d ? `${d}/` : '';
    for (const [p, data] of this.files) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (!rest.includes('/')) out.set(rest, { name: rest, kind: 'file', size: data.length });
    }
    for (const p of this.dirs) {
      if (!p || !p.startsWith(prefix) || p === d) continue;
      const rest = p.slice(prefix.length);
      if (!rest.includes('/')) out.set(rest, { name: rest, kind: 'dir' });
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(path: string): Promise<Uint8Array> {
    const f = this.files.get(join(path));
    if (!f) throw new NotFoundError(path);
    return f.slice();
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await this.read(path));
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const p = join(path);
    this.ensureDir(dirname(p));
    this.files.set(p, typeof data === 'string' ? new TextEncoder().encode(data) : data.slice());
    this.log.push(`write ${p}`);
  }

  async move(from: string, to: string): Promise<void> {
    const f = join(from);
    const t = join(to);
    if (this.files.has(f)) {
      this.ensureDir(dirname(t));
      this.files.set(t, this.files.get(f)!);
      this.files.delete(f);
      this.log.push(`move ${f} -> ${t}`);
      return;
    }
    if (!this.dirs.has(f)) throw new NotFoundError(from);
    for (const [p, data] of [...this.files]) {
      if (p.startsWith(`${f}/`)) {
        const np = t + p.slice(f.length);
        this.ensureDir(dirname(np));
        this.files.set(np, data);
        this.files.delete(p);
      }
    }
    for (const d of [...this.dirs]) {
      if (d === f || d.startsWith(`${f}/`)) {
        this.dirs.delete(d);
        this.ensureDir(t + d.slice(f.length));
      }
    }
    this.log.push(`move ${f} -> ${t}`);
  }

  async delete(path: string): Promise<void> {
    const p = join(path);
    if (this.files.delete(p)) {
      this.log.push(`delete ${p}`);
      return;
    }
    if (this.dirs.has(p)) {
      for (const f of [...this.files.keys()]) if (f.startsWith(`${p}/`)) this.files.delete(f);
      for (const d of [...this.dirs]) if (d === p || d.startsWith(`${p}/`)) this.dirs.delete(d);
      this.log.push(`delete ${p}`);
      return;
    }
    throw new NotFoundError(path);
  }

  async exists(path: string): Promise<boolean> {
    const p = join(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  async mkdir(path: string): Promise<void> {
    this.ensureDir(join(path));
  }
}
