import { useEffect, useState } from 'preact/hooks';
import type { Workspace } from '../workspace/types';
import { DEFAULT_SETTINGS, type Settings, type TemplateInfo } from '../workspace/store';

export type Phase =
  'loading' | 'welcome' | 'choose' | 'confirm' | 'name' | 'done' | 'reconnect' | 'ready' | 'basic';

export interface AppState {
  phase: Phase;
  ws: Workspace | null;
  handle: FileSystemDirectoryHandle | null;
  folderName: string;
  connected: boolean;
  user: string;
  settings: Settings;
  templates: TemplateInfo[];
  exceptionCount: number;
  missing: string[];
  basic: boolean;
  /** Announced through the polite live region. */
  announce: string;
  settingsOpen: boolean;
  slowRead: string | null;
  /** PDFs opened in basic mode (nothing is moved). */
  basicFiles: { name: string; bytes: Uint8Array }[];
  /** A file waiting to become a new template's first sample. */
  pendingSample: { name: string; bytes: Uint8Array; fromException?: string } | null;
  /** An action that failed, shown at the top of the page with its details. */
  problem: { message: string; detail: string } | null;
  /** Short confirmations shown in the corner for a few seconds. */
  toasts: { id: number; text: string }[];
}

const initial: AppState = {
  phase: 'loading',
  ws: null,
  handle: null,
  folderName: '',
  connected: false,
  user: '',
  settings: DEFAULT_SETTINGS,
  templates: [],
  exceptionCount: 0,
  missing: [],
  basic: false,
  announce: '',
  settingsOpen: false,
  slowRead: null,
  basicFiles: [],
  pendingSample: null,
  problem: null,
  toasts: [],
};

let state: AppState = initial;
const subs = new Set<() => void>();

export const app = {
  get: () => state,
  set(patch: Partial<AppState>) {
    state = { ...state, ...patch };
    subs.forEach((s) => s());
  },
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  announce(message: string) {
    // Clear first so repeating the same message is announced again.
    app.set({ announce: '' });
    setTimeout(() => app.set({ announce: message }), 30);
  },
};

export function useApp(): AppState {
  const [, force] = useState(0);
  useEffect(() => app.subscribe(() => force((n) => n + 1)), []);
  return state;
}
