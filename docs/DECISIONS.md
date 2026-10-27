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
- Scrollable table wrappers take `tabIndex={0}` so keyboard users can scroll them (axe `scrollable-region-focusable`).
- The scanned fixture's smudge is a faint grey smear plus specks over row 4's amount, tuned so tesseract reads "34.32" below the 0.8 confidence threshold (flagged for review) rather than dropping the value.
- OCR cannot read the masked-card bullets ("•• 0034"); the M10 test compares that column by its digits only, and those cells are flagged as low confidence for review.
- A review's edits autosave after 400 ms; approve, reject, skip and re-run cancel the pending save first (skip saves the edits at once), so a late save can't recreate a handled review file.
- The Mapper remembers which exception a new template was started from (IndexedDB `origin:<id>`). After saving, it offers "Go to the file to re-run it", which opens that file in Review, where "Re-run this file" extracts it.
- Labels such as "Invoice No", "Number", "Code", "ID", "Ref", "PO" and "ABN" (and any preset whose type is text) give a text field even when the value is all digits, so identifiers keep leading zeros and aren't summed.
- The service worker uses `clientsClaim` and `skipWaiting`, so the first visit is already controlled and the app works offline without a second load.
- `theme-color`, the manifest colours and the generated icons read their values from `tokens.css` (`apps/web/scripts/tokens.mjs`) at build time. The colour test also scans `index.html`, `vite.config.ts` and the build scripts.
- Template keywords shown in selects (types, match modes, directions, severities) and reason codes in the Review filter use labels from `strings.ts`. The Page and Occurrence boxes still show the keywords `any` and `first` as placeholders, because those are what the user types.
- Reason messages ("Amounts add up to $415.18, but Total Due is $424.18…") are written by the engine, which can't import the web app's `strings.ts`. They live in `packages/engine/src` as the engine's own plain-English output.
- `corrections` entries in the output JSON are `{ field, table?, row?, from, to }`, with `from` and `to` as typed values (numbers for numeric columns). The plan shows `corrections: []` without fixing the entry shape.

## Performance (section 4.12)

Measured on 2026-10-24 on the build machine (Windows 10, Node 22.16, Chromium from Playwright 1.64.1). Digital timings come from `pnpm perf` (the same engine and pdf.js adapter the worker uses, median of 5 runs, 3 for the batch); OCR comes from the OCR end-to-end test in the real app.

| Target | Measured | Result |
| --- | --- | --- |
| 2-page digital PDF under 300 ms | 50 ms | Met |
| 20-page digital PDF under 2 s | 391 ms | Met |
| 50 digital PDFs under 30 s | 4.0 s | Met |
| One scanned page through OCR under 8 s | 5.3 to 7.7 s per page across runs (10.5 to 15.4 s for the 2-page scan, including starting the OCR engine) | Met, with little margin on a busy machine |

OCR is the tightest. Starting the OCR engine is paid once per run, so longer runs average lower per page. On a slower PC, switching the language data to tesseract's "fast" model would roughly halve OCR time at some cost in accuracy; that's left as a later option.

## Interface redesign (after 1.0.0)

- The top bar became a sidebar: the working folder (with "Change folder"), navigation with a review count, and Settings, which now works at every step including setup. Narrow screens get a header with a menu button, and the sidebar slides in.
- Light and dark themes follow the system setting. Both are defined in `tokens.css`, and the contrast test checks every text pair in both. The PDF page and its marks stay on white paper in both themes (`--paper`, `--mark-*`).
- Every slow button uses `ActionButton`: a spinner and an "…ing" label while it runs, and if it fails, a message at the top of the page with the error details instead of a button left greyed out. Unhandled failures anywhere are shown the same way. Short confirmations appear as toasts.
- Setup ticks off each folder as it's created, shows how long it has been running, and offers "Choose a different folder" at every step. A folder that's already set up skips the create step. If the folder window doesn't appear (some embedded browsers can't show it), the app says so after a few seconds and offers basic mode.
- Pages render off screen and replace the visible page only when finished; a resize cancels the render in flight. Overlapping renders of one canvas had produced upside-down, garbled pages.
- The Mapper's side panel is split into tabs (Fields, Table, Checks, Fingerprint, Preview), and it switches to the tab you're working on. The page view stays in view while you scroll.
- `pnpm screenshots` captures every screen in light and dark mode into `docs/screenshots`, for design review and the README. The normal e2e run ignores it.
- The project is open source under the MIT licence; bundled third-party software, fonts and OCR data are listed with their licences in `THIRD_PARTY_NOTICES.md`.

## Mapper interaction rework (after 1.0.0)

Feedback was that mapping felt clunky: fields were hard to remove, and clicks picked single words. Changes:

- **A click takes the whole value.** `valueTokens` (engine) widens a clicked word to the rest of its phrase, leaving out a label in front ("ABN", "Ref:"). Number-like words (digits, month names, currency signs) only widen across number-like neighbours, so "12 Mar 2026" is one date. Hovering highlights what a click will take. Multi-word picks now use `phrase` or `tokens:n` for every type (before, non-text fields always used `token`, which cut "12 Mar 2026" to "12").
- **Drag to select** several words; Shift-click still adds single words.
- **Clicking a mapped value opens its field** instead of adding a duplicate; clicking a suggested value accepts it.
- **Remove from the row** (×), with Undo in a toast.
- **Quieter page:** labels show only on the field being edited or pointed at in the list, so tags no longer cover neighbouring values. Fields are listed before suggestions, which gained **Accept all**, and the rarely needed field settings sit under **More options**.

## Mapper redesign, phase 1: grouped tables (after 1.0.0)

The approved redesign plan (six phases) starts by making long, grouped bills such as telco service summaries work on the existing screen.

- **Repeating totals are skipped, not the end.** `inferTable` used the first line starting with "Total" as the end marker. A total whose leading words repeat ("Total for 02 …") now becomes a skip pattern; only a total that appears once ends the table.
- **Headings by example.** Clicking a line in table mode asks what it is. `groupFor` writes the rule: leading words before the first number capture the rest ("Telephone (.+)"); a heading without numbers matches any line that stands alone at the same indent (`lone`, `x0`), with capitals (company) and ordinary text (section) kept apart. A wrapped description line sits at a different indent, so it still joins its row.
- **No joining across headings.** Lines after a heading no longer glue onto the previous group's last row.
- **Columns without a heading.** `addColumnAt` starts a column at any word, reaching right as far as text starting there, and re-guesses the changed columns' types from the extracted values.
- **Page furniture.** `furnitureLines` treats lines in the top or bottom 10 % of the page whose text (numbers aside) repeats at the same height on at least 60 % of pages (and 3 pages) as page headers and footers; tables ignore them. Restricting it to the margins keeps the first table line on each page from being mistaken for furniture.
- **No suggestions from repeating labels.** A label that repeats on page 1 belongs to rows, so `suggestFields` skips it.
- **Dividers don't block words.** The dashed divider line ignores the pointer; it's dragged by a grip above the header. Before, its 14 px hit area covered words such as the first word of a period.
- **Fixture.** `summit-voice-jan26.pdf` (synthetic) has companies, phone-number headings, two sections, items over two or three lines, credits printed "-90.91" and "90.91CR", a per-service total, a footer on every page and a Call details section.
