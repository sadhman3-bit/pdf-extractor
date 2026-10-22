import { NotFoundError, type Entry, type Workspace } from './types';
import { basename, dirname, split } from './paths';

type MovableHandle = FileSystemFileHandle & {
  move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void>;
};

type IterableDir = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

export interface HandleWorkspaceOptions {
  /** Called when a read takes a while (OneDrive downloading a cloud-only file). */
  onSlowRead?: (path: string, done: boolean) => void;
}

/**
 * A workspace on a FileSystemDirectoryHandle: the folder the person picked
 * (File System Access API) or the Origin Private File System.
 */
export class HandleWorkspace implements Workspace {
  constructor(
    readonly root: FileSystemDirectoryHandle,
    readonly kind: 'fs' | 'opfs',
    readonly name = root.name,
    private readonly opts: HandleWorkspaceOptions = {},
  ) {}

  private async dir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let d = this.root;
    for (const part of split(path)) {
      try {
        d = await d.getDirectoryHandle(part, { create });
      } catch (e) {
        if (isNotFound(e)) throw new NotFoundError(path);
        throw e;
      }
    }
    return d;
  }

  private async file(path: string, create = false): Promise<FileSystemFileHandle> {
    const d = await this.dir(dirname(path), create);
    try {
      return await d.getFileHandle(basename(path), { create });
    } catch (e) {
      if (isNotFound(e) || isTypeMismatch(e)) throw new NotFoundError(path);
      throw e;
    }
  }

  async list(path: string): Promise<Entry[]> {
    const d = (await this.dir(path)) as IterableDir;
    const out: Entry[] = [];
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'file') {
        const f = await (h as FileSystemFileHandle).getFile().catch(() => null);
        out.push({
          name,
          kind: 'file',
          ...(f ? { size: f.size, lastModified: f.lastModified } : {}),
        });
      } else {
        out.push({ name, kind: 'dir' });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(path: string): Promise<Uint8Array> {
    const attempt = async () =>
      new Uint8Array(await (await (await this.file(path)).getFile()).arrayBuffer());
    let slow = false;
    const timer = setTimeout(() => {
      slow = true;
      this.opts.onSlowRead?.(path, false);
    }, 600);
    try {
      try {
        return await attempt();
      } catch (e) {
        if (e instanceof NotFoundError) throw e;
        // OneDrive may fail the first read of a cloud-only file while it downloads.
        return await attempt();
      }
    } finally {
      clearTimeout(timer);
      if (slow) this.opts.onSlowRead?.(path, true);
    }
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await this.read(path));
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const h = await this.file(path, true);
    const w = await h.createWritable();
    try {
      await w.write(typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>));
    } finally {
      await w.close();
    }
  }

  async move(from: string, to: string): Promise<void> {
    let isFile = true;
    let src: FileSystemFileHandle | null = null;
    try {
      src = await this.file(from);
    } catch {
      isFile = false;
    }
    if (isFile && src) {
      const dest = await this.dir(dirname(to), true);
      const movable = src as MovableHandle;
      if (typeof movable.move === 'function') {
        try {
          await movable.move(dest, basename(to));
          return;
        } catch {
          /* fall back to copy + delete */
        }
      }
      const bytes = await this.read(from);
      await this.write(to, bytes);
      await this.delete(from);
      return;
    }
    // Directory: copy recursively, then remove the source.
    await this.copyDir(from, to);
    await this.delete(from);
  }

  private async copyDir(from: string, to: string): Promise<void> {
    await this.mkdir(to);
    for (const e of await this.list(from)) {
      const a = `${from}/${e.name}`;
      const b = `${to}/${e.name}`;
      if (e.kind === 'dir') await this.copyDir(a, b);
      else await this.write(b, await this.read(a));
    }
  }

  async delete(path: string): Promise<void> {
    const d = await this.dir(dirname(path));
    try {
      await d.removeEntry(basename(path), { recursive: true });
    } catch (e) {
      if (isNotFound(e)) throw new NotFoundError(path);
      throw e;
    }
  }

  async exists(path: string): Promise<boolean> {
    if (!split(path).length) return true;
    try {
      const d = await this.dir(dirname(path));
      const name = basename(path);
      try {
        await d.getFileHandle(name);
        return true;
      } catch {
        await d.getDirectoryHandle(name);
        return true;
      }
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.dir(path, true);
  }
}

function isNotFound(e: unknown) {
  return (e as DOMException)?.name === 'NotFoundError';
}
function isTypeMismatch(e: unknown) {
  return (e as DOMException)?.name === 'TypeMismatchError';
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
};

export async function queryPermission(h: FileSystemDirectoryHandle): Promise<PermissionState> {
  const p = h as PermissionHandle;
  if (!p.queryPermission) return 'granted';
  return p.queryPermission({ mode: 'readwrite' });
}

export async function requestPermission(h: FileSystemDirectoryHandle): Promise<PermissionState> {
  const p = h as PermissionHandle;
  if (!p.requestPermission) return 'granted';
  return p.requestPermission({ mode: 'readwrite' });
}

export function hasFolderAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const w = window as unknown as {
    showDirectoryPicker: (o: {
      mode: 'readwrite';
      id?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  };
  try {
    return await w.showDirectoryPicker({ mode: 'readwrite', id: 'pdfx-workspace' });
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null;
    throw e;
  }
}

export async function opfsRoot(sub: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(sub, { create: true });
}
