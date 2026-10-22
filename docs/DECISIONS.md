# Decisions

One line per deviation or judgement call, newest at the bottom of each section.

## Versions (installed 2026-10-22)

| Package | Version |
| --- | --- |
| Node | 22.16.0 |
| pnpm | 10.34.6 |
| TypeScript | 6.0.3 |
| Preact | 11.0.1 |
| Vite | 8.3.5 |
| @preact/preset-vite | 2.10.6 |
| pdfjs-dist | 6.4.299 |
| tesseract.js / tesseract.js-core | 7.0.0 / 7.0.0 |
| @tesseract.js-data/eng | 1.0.0 (4.0.0_best_int traineddata) |
| pdf-lib | 1.17.1 |
| SheetJS CE (xlsx) | 0.20.3 (CDN tarball, vendored) |
| fflate | 0.8.3 |
| zod | 4.6.7 |
| vite-plugin-pwa | 2.0.0 |
| @fontsource/ibm-plex-sans, -mono | 5.3.0 |
| Vitest | 5.0.5 |
| Playwright / @axe-core/playwright | 1.64.1 / 4.14.0 |
| ESLint / typescript-eslint / Prettier | 10.13.0 / 8.72.0 / 3.9.10 |

## Decisions

- TypeScript is pinned to 6.0.3, not the latest 7.0.2, because typescript-eslint 8.72 supports TypeScript below 6.1 only.
- SheetJS is installed from a tarball downloaded from the SheetJS CDN and committed in `vendor/`, because pnpm refuses remote tarballs without an integrity hash in the lockfile. This is the "vendoring" route in the SheetJS docs.
- tesseract.js-core 7 ships six core builds (plain, SIMD and relaxed-SIMD, each with and without the legacy engine). The app only uses the LSTM engine, so it self-hosts the three `*-lstm.wasm.js` files. tesseract.js picks between them at runtime.
- The English language data comes from the `@tesseract.js-data/eng` npm package (`4.0.0_best_int`), copied into `public/vendor/tessdata` at build time.
- Self-hosted runtime files (pdf.js wasm, standard fonts and CMaps; tesseract worker, cores and language data) are copied into `apps/web/public/vendor` by `apps/web/scripts/copy-vendor.mjs` before every dev run and build. The folder is git-ignored.
- The CSP meta tag is injected at build time only. The Vite dev server injects inline styles for hot reload, which `style-src 'self'` would block.
- The repository folder on the build machine is `PDF Extractor`; the GitHub repository and Pages base path are `pdf-extractor`.
- The PWA service worker is registered by vite-plugin-pwa's generated `registerSW.js`, a separate same-origin script (no inline script).
- Only the Latin subset of IBM Plex is bundled to keep the precache small.
