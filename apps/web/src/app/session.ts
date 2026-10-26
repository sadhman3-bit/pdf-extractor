// Starting up, choosing a folder, reconnecting and refreshing workspace data.
import { app } from './store';
import {
  HandleWorkspace,
  hasFolderAccess,
  opfsRoot,
  pickFolder,
  queryPermission,
  requestPermission,
} from '../workspace/handle';
import { createFolders, loadSettings, loadTemplates, missingFolders } from '../workspace/store';
import { countExceptions } from '../workspace/review';
import { idbGet, idbSet } from '../lib/idb';
import { local } from '../lib/local';
import { S } from '../strings';
import { testHooks } from './testing';

const HANDLE_KEY = 'workspace-handle';

function makeWorkspace(h: FileSystemDirectoryHandle, kind: 'fs' | 'opfs') {
  const name = kind === 'opfs' && testHooks() ? 'PDF Extractor' : h.name;
  return new HandleWorkspace(h, kind, name, {
    onSlowRead: (path, done) => app.set({ slowRead: done ? null : path }),
  });
}

function basicRequested(): boolean {
  if (testHooks()?.basic) return true;
  return !hasFolderAccess() && !testHooks();
}

export async function startup(): Promise<void> {
  const user = local.user();
  app.set({ user });
  if (basicRequested()) {
    await enterBasic();
    return;
  }
  const stored = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  if (!stored) {
    app.set({ phase: 'welcome' });
    return;
  }
  const kind = (await idbGet<'fs' | 'opfs'>(`${HANDLE_KEY}-kind`)) ?? 'fs';
  const perm = await queryPermission(stored).catch(() => 'denied' as PermissionState);
  app.set({
    handle: stored,
    folderName: kind === 'opfs' && testHooks() ? 'PDF Extractor' : stored.name,
  });
  if (perm === 'granted') await connect(stored, kind);
  else app.set({ phase: 'reconnect', connected: false });
}

export async function enterBasic(): Promise<void> {
  const h = await opfsRoot('pdfx-basic');
  const ws = new HandleWorkspace(h, 'opfs', S.basic.storageName);
  await createFolders(ws);
  app.set({ basic: true, ws, folderName: '', connected: false });
  await refresh();
  app.set({ phase: 'basic' });
}

async function connect(h: FileSystemDirectoryHandle, kind: 'fs' | 'opfs'): Promise<void> {
  const ws = makeWorkspace(h, kind);
  const missing = await missingFolders(ws);
  app.set({ ws, handle: h, folderName: ws.name, connected: true, missing });
  if (missing.length) {
    app.set({ phase: 'confirm' });
    return;
  }
  if (!app.get().user) {
    app.set({ phase: 'name' });
    return;
  }
  await refresh();
  app.set({ phase: 'ready' });
}

/** 'failed' carries the browser's message, for example when a protected folder was picked. */
export type ChooseResult = 'ok' | 'cancelled' | 'unsupported' | { failed: string };

export async function chooseFolder(): Promise<ChooseResult> {
  let h: FileSystemDirectoryHandle | null;
  let kind: 'fs' | 'opfs' = 'fs';
  if (testHooks()) {
    h = await opfsRoot('pdfx-test');
    kind = 'opfs';
  } else {
    if (!hasFolderAccess()) return 'unsupported';
    try {
      h = await pickFolder();
    } catch (e) {
      return { failed: String((e as Error)?.message ?? e) };
    }
  }
  if (!h) return 'cancelled';
  await idbSet(HANDLE_KEY, h);
  await idbSet(`${HANDLE_KEY}-kind`, kind);
  const ws = makeWorkspace(h, kind);
  const missing = await missingFolders(ws);
  app.set({ ws, handle: h, folderName: ws.name, connected: true, missing });
  // A folder that is already set up needs no "create folders" step.
  if (missing.length) app.set({ phase: 'confirm' });
  else if (!app.get().user) app.set({ phase: 'name' });
  else {
    await refresh();
    app.set({ phase: 'ready' });
  }
  return 'ok';
}

export async function confirmFolders(onStep?: (path: string) => void): Promise<void> {
  const { ws } = app.get();
  if (!ws) return;
  await createFolders(ws, onStep);
  app.set({ missing: [] });
  if (!app.get().user) app.set({ phase: 'name' });
  else {
    await refresh();
    app.set({ phase: 'ready' });
  }
}

export async function setUser(name: string, next: 'done' | 'ready' = 'done'): Promise<void> {
  const user = name.trim();
  local.setUser(user);
  app.set({ user });
  await refresh();
  app.set({ phase: next });
}

export async function reconnect(): Promise<void> {
  const { handle } = app.get();
  if (!handle) {
    app.set({ phase: 'welcome' });
    return;
  }
  const perm = await requestPermission(handle).catch(() => 'denied' as PermissionState);
  if (perm === 'granted') {
    const kind = (await idbGet<'fs' | 'opfs'>(`${HANDLE_KEY}-kind`)) ?? 'fs';
    await connect(handle, kind);
  }
}

/** Reloads settings, templates and the exceptions count from the folder. */
export async function refresh(): Promise<void> {
  const { ws, basic } = app.get();
  if (!ws) return;
  const [settings, templates, exceptionCount] = await Promise.all([
    loadSettings(ws),
    loadTemplates(ws),
    basic ? Promise.resolve(0) : countExceptions(ws),
  ]);
  app.set({ settings, templates, exceptionCount });
}

export function now(): Date {
  return new Date();
}
