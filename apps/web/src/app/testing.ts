// Test-only hooks. Everything here sits behind __PDFX_TEST__, which is false in
// production builds, so the minifier removes it (a unit test checks the bundle).
import { HandleWorkspace, opfsRoot } from '../workspace/handle';
import { idbClear } from '../lib/idb';
import { local } from '../lib/local';

export interface TestHooks {
  /** Start in basic mode, as if the browser had no folder access. */
  basic?: boolean;
  /** Throw after this processing step (section 3.6) to simulate a crash. */
  crashAfterStep?: number | null;
  /** Mapper previews run in the worker above this many words (to test that path on a short sample). */
  previewWorkerWords?: number;
  /** False: a new sample opens without its table found (tests that map it by hand). */
  autoTable?: boolean;
}

export function testHooks(): TestHooks | null {
  if (!__PDFX_TEST__) return null;
  return (
    (window as unknown as { __PDFX_TEST_WORKSPACE__?: TestHooks }).__PDFX_TEST_WORKSPACE__ ?? null
  );
}

const b64 = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  decode(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function installTestApi(): void {
  if (!__PDFX_TEST__) return;
  const w = window as unknown as { __PDFX_TEST_WORKSPACE__?: Record<string, unknown> };
  const ws = async () => new HandleWorkspace(await opfsRoot('pdfx-test'), 'opfs', 'PDF Extractor');
  w.__PDFX_TEST_WORKSPACE__ = Object.assign(w.__PDFX_TEST_WORKSPACE__ ?? {}, {
    async reset() {
      const root = await navigator.storage.getDirectory();
      for (const d of ['pdfx-test', 'pdfx-basic'])
        await root.removeEntry(d, { recursive: true }).catch(() => undefined);
      await idbClear();
      local.clear();
    },
    async seed(files: Record<string, string>) {
      const x = await ws();
      for (const [path, data] of Object.entries(files)) await x.write(path, b64.decode(data));
    },
    async readText(path: string) {
      return (await ws()).readText(path);
    },
    async list(dir: string) {
      return (await (await ws()).list(dir)).map((e) => e.name);
    },
    async exists(path: string) {
      return (await ws()).exists(path);
    },
    crashAfterStep: null,
  });
}
