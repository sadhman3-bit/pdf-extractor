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
- Fixture PDFs use the 14 standard PDF fonts (Helvetica, Helvetica-Bold, Symbol for "≤") so they stay small and deterministic.
- When a pdf.js text item holds several words, its width is shared between them by character count with spaces weighted at half a character, because a space in Helvetica is about half an average glyph. Plain character counting made single spaces look wider than the 0.35 × height phrase gap.
- Scanned fixtures are rendered from the same layout model as the digital ones as HTML in Playwright Chromium (1 CSS px = 1 pt) at 200 DPI, tilted up to ±0.4° with seeded speckle noise. Byte-identical output is guaranteed on the same machine; other machines may render fonts slightly differently.
- `encrypted.pdf` is hand-built with a standard security handler entry whose user password is unknown, because pdf-lib cannot encrypt.
- The scanned Northline fixture (card 2) prints row 4 as a smudged "34.32" while the true amount, used for Total Due ($424.18), is $43.32. This gives the review flow in M11 its "Short by $9.00" case.
- Token overlay boxes carry `data-text` so end-to-end tests can click a word; the boxes stay `aria-hidden` and keyboard users get the same words through the viewer's live region.
- The extraction worker passes `useWorkerFetch: false` to pdf.js, which otherwise reads `document.baseURI` and fails inside a worker.
- E2E tests compare the template saved through the interface against the goldens by running the engine in Node (`apps/web/e2e/engine.ts`).
