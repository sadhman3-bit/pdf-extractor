# Mapper and workflow fix

## Outcome

Map a supplier by selecting the information as it is read on the page. Keep ordinary tables and repeating blocks equally usable. Save reusable rules, not a fixed final page. Preserve existing templates and exports.

The approved example produces Name (the complete service heading), Phone number (within that heading), Excl GST and Incl GST (from the matching service total). Use synthetic documents only.

## Work and acceptance

1. **Compatibility and extraction.** Extend heading capture to take several values from one line and keep their source boxes. Add optional block rules, with a new heading starting a block and a selected total completing it. Compare selected identifiers when available. Report missing, duplicate, orphaned or mismatched totals. Do not carry values into the next block. Keep old templates unchanged. Test cross-page blocks, varying identifiers, zero amounts, credits and different supplier labels.
2. **Direct mapping.** Keep drawing, Start/End handles and column dividers. Add a contextual action to map a heading block, including a separate identifier. Select the total line to use matching lines as rows. Name columns in place; make ordering explicit. Preserve undo, draft recovery, keyboard actions and worker previews. Show the chosen block rules near the table.
3. **Pattern boundaries.** Expose starts-with, contains, exact and advanced pattern choices for the table ending. Keep page continuation visible. Report an expected ending that is absent. A block total must never implicitly end the entire table.
4. **Visual polish.** Default to light regardless of operating system settings. Persist explicit dark mode. Keep PDF paper white. Give the document priority, reduce unsolicited suggestions, retain readable navigation, and allow the results dock to resize. Follow the approved light-mode previews. Keep colours in tokens and interface text in strings.
5. **Complete workflow.** Offer opening a PDF before workspace administration. Add PDFs directly to the inbox from Process. Give empty states a useful next action. Explain saved drafts versus saved reusable versions, correction versus template repair, and export locations. Keep integration detail secondary.
6. **Trust and recovery.** Distinguish data found from validation passed. Surface table diagnostics in preview, sample checks and Review. Make carried values link back to the heading. Do not let an incomplete block pass because other rows exist. Keep correction and rerun actions clear.
7. **Verification and release.** Test existing golden outputs, new synthetic block fixtures, browser interactions, keyboard and axe, explicit theme persistence, exports and reload. Exercise a long document through the worker. Run lint, typecheck, unit tests, build and Chromium e2e in order. Commit the finished release step on main, push with the owner's recorded authority, and verify both CI and Pages for that commit. Stop all started jobs and rewrite the local handover.

## Delivery notes

- New rule fields are optional so saved templates continue to load.
- No network services, analytics or remote fonts. Extraction stays local and the engine stays DOM-free.
- The picture is a design reference; the final controls must perform real extraction.
- Approval to deliver this fix live was given on 27 October 2026. The local handover contains the owner's exact words.
