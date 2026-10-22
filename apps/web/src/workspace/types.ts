export interface Entry {
  name: string;
  kind: 'file' | 'dir';
  size?: number;
  lastModified?: number;
}

/**
 * All storage goes through this interface. Paths are "/"-separated and relative
 * to the workspace root, for example "Output/northline/ST-1.json".
 */
export interface Workspace {
  readonly name: string;
  readonly kind: 'fs' | 'opfs' | 'memory';
  list(dir: string): Promise<Entry[]>;
  read(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  /** Creates parent folders as needed. Readers never see a half-written file. */
  write(path: string, data: Uint8Array | string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`Not found: ${path}`);
    this.name = 'NotFoundError';
  }
}
