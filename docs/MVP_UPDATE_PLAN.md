# MVP update: label examples and readable screens

## Outcome

Open a PDF, highlight examples, name the CSV columns, check the proposed rows and export. Keep reusable templates and local processing. A user must not need to write patterns to extract a name after a phone number.

## Release scope

1. **Readable screens.** Audit clipping across the shell, Mapper, templates, sample tests, Process, Review and Settings. Let labels and messages wrap, give inputs useful widths, and keep wide data in an explicit scroll area. Make full output headings readable. Check laptop, tablet and narrow viewports, plus enlarged text. Preserve virtualisation for long documents.
2. **Label examples.** Add a clearly labelled example mode alongside the existing mapping tools. The user names a column, highlights a value and applies it. Keep the example action close to the document. Suggest the containing table when possible. Do not silently invent a table if the document structure is unclear.
3. **Learn several examples.** Store examples with the saved table. Several heading styles can feed the same column. Extract only the selected part of a heading, including a name after a phone number. Pair each heading with its matching total across pages. Blank names stay blank. Show the saved examples and allow their removal. Keep patterns available in advanced settings.
4. **Visible results.** Update the spreadsheet after each example. Rename output columns, click values to return to their source and download the CSV. Distinguish a populated preview from verified completeness. Preserve missing and duplicate total diagnostics and text-based table endings.
5. **Compatibility.** Keep ordinary rectangular tables, existing templates, undo, draft recovery, OCR, batch processing and review working. New schema fields are optional. No external requests, model downloads or cloud processing. Local LLM assistance is a later experiment, not a dependency of this MVP.
6. **Verification.** Add synthetic cases for varying prefixes, phone formats, selected name fragments, blank names and multiple examples. Exercise the real browser flow, save/reload, export, keyboard access, layout overflow and axe. Run lint, typecheck, unit tests, production build and the complete Chromium suite in order.
7. **Release.** Commit the completed step after the gate, push under the owner's current approval, verify CI and Pages for that commit, and update the local handover. Do not claim the owner's real statement has been tested.

## Design and boundaries

The design preview uses synthetic services. The document stays prominent; an example card names the destination column and lists examples. Existing detailed controls remain available for difficult layouts. Inputs scroll while editing long text; saved labels and read-only text wrap. Wide spreadsheets scroll horizontally rather than losing columns.

This release learns explicit text and positional relationships from examples. It does not promise general document understanding. Unsupported or ambiguous selections must explain the next useful action, and every extracted value retains its source.
