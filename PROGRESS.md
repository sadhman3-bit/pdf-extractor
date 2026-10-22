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
- [ ] End-to-end test maps the Northline table through the interface; output equals the golden
- [ ] End-to-end test maps the COA results table through the interface; output equals the golden

## M8: Test on samples
- [ ] From a v1 template with only "Total GST"/"Total Due", the June layout fails TotalGST and TotalDue
- [ ] Suggested fixes add "GST included" and "Amount payable"
- [ ] Every check then passes on all four samples

## M9: Process inbox
- [ ] Processing the inbox fixtures gives the expected status for every file; outputs equal the goldens
- [ ] The crash-and-rerun test leaves no duplicates

## M10: OCR
- [ ] Scanned Northline extracts every header field and at least 5 of 6 rows; its low-confidence cell is flagged
- [ ] No OCR file is fetched from outside the origin

## M11: Review
- [ ] Correcting row 4 of the scanned fixture from 34.32 to 43.32 turns the checks green
- [ ] Approving writes outputs with `_Corrected = true`, writes the audit line, and moves the file

## M12: Polish and release (section 13, definition of done)
- [ ] All milestone acceptance checks in this file are ticked
- [ ] CI is green; Pages deployment succeeds (or manual steps documented, if no remote)
- [ ] Every digital fixture matches its golden output byte for byte
- [ ] The scanned fixture works through OCR plus review
- [ ] Zero axe violations; contrast tests pass; the mapper works from the keyboard
- [ ] No request leaves the origin; the app works offline after the first load
- [ ] No hard-coded colours or strings outside `tokens.css` and `strings.ts`
- [ ] The performance targets are met and recorded
- [ ] All docs are complete, in plain English, with no placeholders
- [ ] `docs/MANUAL_SETUP.md` and `docs/MANUAL_TESTS.md` list everything the owner must do or check

## Open issues

(none yet)
