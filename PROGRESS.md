# Progress

Resume from the first unticked item. Each milestone ends with a commit `M<n>: <summary>`.

## M0: Foundations
- [x] `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [x] The built app loads under the `/pdf-extractor/` base path and shows the top bar
- [x] The hard-coded-colour test is in place

## M1: Fixtures
- [x] `pnpm fixtures` regenerates identical bytes on two runs
- [x] Every fixture opens in pdf.js; the scanned variants have no text layer

## M2: Engine part 1 (text, fingerprint, fields, values)
- [x] Unit tests pass for every module
- [x] Northline, Apex and COA header fields match the goldens
- [x] `encrypted.pdf` and `corrupt.pdf` give `error` with the right reasons
- [x] `rotated.pdf` extracts correctly

## M3: Engine part 2 (tables)
- [x] Northline table: 6 rows match the golden
- [x] Apex: 41 rows, credits negative, match the golden
- [x] Coastal Telco: every call with ServiceNumber filled in matches the golden
- [x] COA: all results, wrapped methods joined, match the golden

## M4: Engine part 3 (checks, status, outputs)
- [x] Every digital fixture's CSV and JSON match the goldens byte for byte (injected timestamp)
- [x] Changing one amount in a test copy produces `review` with the exact plain-English reason

## M5: Workspace and storage
- [x] An end-to-end first run creates the folder tree
- [x] A template saves and reloads
- [x] A draft survives a page reload and offers to resume
- [x] A fresh lock shows the in-use warning, and a stale lock doesn't

## M6: Mapper (fields)
- [x] An end-to-end test maps Northline's header fields from scratch; saved template's field output equals the golden
- [x] The mapping works from the keyboard alone
- [x] axe reports nothing

## M7: Mapper (tables)
- [x] End-to-end test maps the Northline table through the interface; output equals the golden
- [x] End-to-end test maps the COA results table through the interface; output equals the golden

## M8: Test on samples
- [x] From a v1 template with only "Total GST"/"Total Due", the June layout fails TotalGST and TotalDue
- [x] Suggested fixes add "GST included" and "Amount payable"
- [x] Every check then passes on all four samples

## M9: Process inbox
- [x] Processing the inbox fixtures gives the expected status for every file; outputs equal the goldens
- [x] The crash-and-rerun test leaves no duplicates

## M10: OCR
- [x] Scanned Northline extracts every header field and at least 5 of 6 rows; its low-confidence cell is flagged
- [x] No OCR file is fetched from outside the origin

## M11: Review
- [x] Correcting row 4 of the scanned fixture from 34.32 to 43.32 turns the checks green
- [x] Approving writes outputs with `_Corrected = true`, writes the audit line, and moves the file

## M12: Polish and release (section 13, definition of done)
- [x] All milestone acceptance checks in this file are ticked
- [x] CI is green; Pages deployment succeeds (or manual steps documented, if no remote)
- [x] Every digital fixture matches its golden output byte for byte
- [x] The scanned fixture works through OCR plus review
- [x] Zero axe violations; contrast tests pass; the mapper works from the keyboard
- [x] No request leaves the origin; the app works offline after the first load
- [x] No hard-coded colours or strings outside `tokens.css` and `strings.ts`
- [x] The performance targets are met and recorded
- [x] All docs are complete, in plain English, with no placeholders
- [x] `docs/MANUAL_SETUP.md` and `docs/MANUAL_TESTS.md` list everything the owner must do or check

## Open issues

(none)
