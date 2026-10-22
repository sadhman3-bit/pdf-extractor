// Copies the self-hosted runtime files (pdf.js data, tesseract worker, core and
// language data) into public/vendor so Vite serves and precaches them from our
// own origin. Run automatically before dev and build.
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'public', 'vendor');
const require = createRequire(join(root, 'package.json'));

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const pdfjs = pkgDir('pdfjs-dist');
for (const sub of ['wasm', 'standard_fonts', 'cmaps']) {
  cpSync(join(pdfjs, sub), join(out, 'pdfjs', sub), { recursive: true });
}

const tess = pkgDir('tesseract.js');
mkdirSync(join(out, 'tesseract'), { recursive: true });
cpSync(join(tess, 'dist', 'worker.min.js'), join(out, 'tesseract', 'worker.min.js'));

// Only the LSTM cores are needed: the app always runs the LSTM engine, and the
// worker picks plain, SIMD or relaxed-SIMD at runtime.
const core = pkgDir('tesseract.js-core');
mkdirSync(join(out, 'tesseract-core'), { recursive: true });
for (const f of readdirSync(core)) {
  if (/^tesseract-core.*-?lstm\.wasm\.js$/.test(f)) {
    cpSync(join(core, f), join(out, 'tesseract-core', f));
  }
}

const eng = join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz');
if (!existsSync(eng)) throw new Error('eng.traineddata.gz not found');
mkdirSync(join(out, 'tessdata'), { recursive: true });
cpSync(eng, join(out, 'tessdata', 'eng.traineddata.gz'));

console.log('vendor files copied to', out);
