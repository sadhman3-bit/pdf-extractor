# Template format (`pdfx.template/1`)

A template tells PDF Extractor how to read one supplier's documents: how to recognise them, where each value sits, what the tables look like, and which checks must pass. The Mapper writes templates for you. This page is for anyone who wants to read, review or hand-edit one.

## Where templates live

```
Templates/<template-id>/
  v1.json, v2.json …   saved versions (never edited after saving)
  draft.json           work in progress, autosaved by the Mapper
  samples/*.pdf        sample PDFs used on the Test screen
Templates/_archived/   templates you archived
```

Saving in the Mapper always writes a new version (`v<n+1>.json`). Old versions stay, so earlier outputs can always be traced back to the exact rules that produced them (`_TemplateVersion` in the CSV).

The app checks every template against the schema when it loads. Keys it doesn't know are kept, not dropped, so a template saved by a newer version of the app still works in an older one.

## Top level

| Key | Meaning |
| --- | --- |
| `schema` | Always `"pdfx.template/1"`. |
| `id` | Lower-case letters, digits and dashes, for example `northline-fuel-statement`. Also the folder name under `Templates/` and `Output/`. |
| `name` | The name people see. |
| `version` | Whole number, set when saving. |
| `savedAt`, `savedBy` | When and by whom this version was saved. |
| `fingerprint` | How to recognise this supplier's documents (below). |
| `settings` | Optional: `confidenceThreshold` (0 to 1, default 0.8), `ocr` (`auto`, `always` or `never`, default `auto`), `decimal` (`.` or `,`, default `.`). |
| `fields` | Single values such as an invoice number or total. |
| `tables` | Optional: repeating rows such as transactions or test results. |
| `checks` | Optional: rules that must hold before a file is accepted. |

## Fingerprint

```json
"fingerprint": {
  "mustContain": ["NORTHLINE FUEL", "Fuel card statement"],
  "mustNotContain": [],
  "abn": "15 803 047 975",
  "anyPage": false
}
```

A document matches when every `mustContain` phrase appears on page 1 (or on any page when `anyPage` is `true`), no `mustNotContain` phrase appears, and the ABN appears (digits only are compared, so spacing doesn't matter). Text is compared after normalising spaces and case.

- No template matches: the file goes to review as **Unknown supplier**.
- More than one template matches: the file goes to review as **Ambiguous match**, and the reviewer picks the right one.
- When a template has several versions, the newest version whose required labels are all found is used. If none qualifies, the newest is used and its failures send the file to review.

## Fields

```json
{
  "id": "f1",
  "name": "StatementNo",
  "type": "text",
  "required": true,
  "anchor": { "labels": ["Statement No"], "match": "exact" },
  "direction": "right",
  "maxDistance": 250,
  "take": "token",
  "pattern": "^ST-\\d+$",
  "page": "first",
  "occurrence": "first",
  "clean": ["trim", "upper"],
  "hint": { "page": 1, "bbox": [440, 54, 484, 64] }
}
```

The engine finds the **anchor** (a label printed on the page), then reads the value next to it.

| Property | Values | Default |
| --- | --- | --- |
| `name` | Column name in the outputs. Use the preset names (below) where they fit. | required |
| `type` | `text`, `number`, `integer`, `currency`, `date` | `text` |
| `required` | `true` sends the file to review when the value is missing or won't parse. | `false` |
| `anchor.labels` | One or more labels. Extra labels are alternates for older or newer layouts. | required |
| `anchor.match` | `exact`, `starts-with`, `contains`, `regex` | `exact` |
| `direction` | `right`, `below`, `left`, `above` | `right` |
| `maxDistance` | Points (1/72 inch) for right and left. | 250; 3 lines for below and above |
| `take` | `token`, `phrase`, `rest-of-line`, `tokens:<n>`, `until-gap` | `token` for numbers, currency and dates; `phrase` for text |
| `pattern` | A regular expression the value must match. | none |
| `page` | `first`, `last`, `any`, or a page number | `any` |
| `occurrence` | `first`, `last`, or a number, when the label appears more than once | `first` |
| `clean` | List of cleaners (below), applied in order before parsing. | `["trim", "collapseSpaces"]` |
| `dateFormats` | For example `DD/MM/YYYY`, `D MMM YYYY`. Only these are tried. | `["DD/MM/YYYY"]` |
| `creditMeansNegative` | Numbers and currency: treat a `CR` suffix as negative. | `true` |
| `region` | Fallback box `{ page, x0, y0, x1, y1 }` as fractions of the page, used when the label is missing. Confidence is multiplied by 0.7. | none |
| `hint` | Where the value was mapped (`page`, `bbox` in points). Only used to choose between equal candidates. | set by the Mapper |

**What `take` reads:**

- `token`: the first word (or adjacent words, such as `$ 1,234.56`) that matches `pattern` and parses as the type.
- `phrase`: the next group of words with normal spacing between them.
- `rest-of-line`: everything after the label on that line.
- `tokens:<n>`: the next n words.
- `until-gap`: words until a gap wider than about two spaces.

**Labels:** a label matches a run of words on one line. With `exact`, the label must be followed by the end of a phrase, a `:` or `#`, or a non-letter word, so "Total" doesn't match inside "Total GST".

### Preset field names

Use these so outputs stay consistent across suppliers: `InvoiceNumber`, `StatementNo`, `AccountNo`, `InvoiceDate`, `StatementDate`, `DueDate`, `SupplierABN`, `PONumber`, `TotalGST`, `TotalDue`, `LotNumber`, `ManufactureDate`, `ExpiryDate`, `ProductCode`.

## Cleaners

| Cleaner | What it does |
| --- | --- |
| `trim` | Removes spaces at both ends. |
| `collapseSpaces` | Turns runs of spaces into one. |
| `upper`, `lower` | Changes case. |
| `removeSpaces`, `removeDashes` | Removes every space or dash. |
| `removeChars:<chars>` | Removes each listed character, for example `removeChars:#*`. |
| `stripLeadingZeros` | `000123` becomes `123`. |
| `digitsOnly` | Keeps digits only. |
| `{ "replace": { "pattern": "…", "with": "…" } }` | Regular-expression replace. |
| `{ "keep": { "pattern": "…", "group": 1 } }` | Keeps only what the pattern (or one of its groups) matches. |
| `ocrDigits` | For scanned documents: inside otherwise numeric words, reads O and o as 0, l and I as 1, S as 5, B as 8. |

## How values are read

- **Numbers and currency:** `$`, `A$`, `AUD`, spaces and thousands separators are removed. Negatives can be `-12.40`, `12.40-`, `(12.40)` or `12.40 CR`. `integer` rejects decimals. The CSV keeps the number of decimal places printed on the document.
- **Dates:** format tokens `D`, `DD`, `M`, `MM`, `MMM` (Jan), `MMMM` (January), `YY`, `YYYY`. Only the listed formats are tried, so the app never guesses between day-first and month-first. Two-digit years below 70 mean 20xx. Output is always `YYYY-MM-DD`.

## Tables

```json
{
  "id": "t1",
  "name": "Transactions",
  "header": { "labels": ["Date", "Card", "Site", "Product", "Litres", "Amount"], "minMatch": 4 },
  "columns": [
    { "name": "Date", "header": "Date", "type": "date", "dateFormats": ["DD/MM/YYYY"], "required": true },
    { "name": "Amount", "header": "Amount", "type": "currency", "required": true }
  ],
  "boundaries": "from-header",
  "rowStart": { "column": "Date", "pattern": "^\\d{2}/\\d{2}/\\d{4}$" },
  "wrappedLines": "join",
  "end": { "labels": ["Subtotal"], "match": "starts-with" },
  "skip": ["^Page \\d+ of \\d+$"],
  "continuesOnNextPage": true,
  "groups": []
}
```

| Property | Meaning |
| --- | --- |
| `header.labels`, `minMatch` | The header is the first line (or two lines together) containing at least `minMatch` of these labels. |
| `columns` | One entry per column: `name` (output name), `header` (printed label), plus the same `type`, `required`, `dateFormats`, `clean` and `creditMeansNegative` options as fields. `x0` and `x1` are column edges in points, set when you add, move or remove a column break on the Mapper's ruler. |
| `boundaries` | `from-header` puts each edge in the widest clear gap between neighbouring header labels (halfway between them when there is none); `explicit` uses the stored `x0`/`x1`. |
| `rowStart` | A new row starts when this column's cell matches the pattern. |
| `wrappedLines` | `join` adds a line that doesn't start a row to the row above (for wrapped descriptions); `ignore` drops it. |
| `end` | Stop at a line starting with (or matching) one of these labels. |
| `skip` | Lines matching any of these regular expressions are ignored, for example page footers. |
| `continuesOnNextPage` | Carry on to the next page when no end marker was seen. A repeated header is skipped. |
| `groups` | Section lines that apply to the rows below them (see below). |

**Groups** handle sectioned tables such as phone bills:

```json
{ "name": "ServiceNumber", "pattern": "^Service (\\d{4} \\d{3} \\d{3})$", "capture": 1 }
```

When a whole line matches, the captured text becomes the `ServiceNumber` column of every row after it, until the next group line.

## Checks

```json
{ "id": "c1", "label": "Amounts add up to TotalDue", "expr": "sum(Transactions.Amount) ~= TotalDue", "tolerance": 0.01, "severity": "error" }
```

| Property | Meaning |
| --- | --- |
| `label` | Plain-English name shown on screen. |
| `expr` | The rule, in the expression language below. |
| `tolerance` | How close `~=` needs to be. Default 0.01. |
| `severity` | `error` sends the file to review when the check fails; `warning` is reported but doesn't block. |
| `enabled` | `false` switches a check off without deleting it. |

**Expression language:**

- Values: numbers, field names (`TotalDue`), and `Table.Column` inside `sum`, `min`, `max` and `avg`.
- Arithmetic: `+ - * /` and brackets.
- Comparisons: `== != > >= < <=`, and `~=` for "equal within the tolerance".
- Functions: `sum(T.C)`, `count(T)` (rows), `count(T.C)` (non-empty cells), `min`, `max`, `avg`, `round(x, places)`, `abs(x)`, `exists(Field)`.
- A missing value makes the result unknown, which fails an `error` check and warns on a `warning` check.

Examples:

- `sum(Transactions.Amount) ~= TotalDue`: the rows add up to the total.
- `round(TotalDue / 11, 2) ~= TotalGST`: Australian GST is one eleventh of a GST-inclusive total.
- `count(Results.Result) == count(Results)`: every result is filled in.

The Mapper offers these checks automatically: every required field is present, the amount column adds up to the total, GST is the total ÷ 11, and each table has at least one row.

## Confidence and status

Each value has a confidence from 0 to 1: 1 for digital text, the OCR engine's own score for scanned pages, × 0.7 when the fallback box was used, and 0 when the value didn't parse. A file is **Extracted** (`ok`) only when one template matched, every required value is present, every `error` check passes, and nothing is below the confidence threshold. Otherwise it goes to review, with plain-English reasons.

## Full example

### Optional repeating blocks

A table can add `block: { headingPattern, headingLines?, keyGroup?, rowKeyPattern?, rowKeyCapture? }`. Each matching heading starts a fresh block. `headingLines` defaults to one and can include up to five lines on the same page. All matching `groups` capture values from the heading; capture zero keeps the whole text. Values carry across page breaks until the next block. The existing `rowStart` rule identifies the total line that completes one row.

If `keyGroup` is set, its value must match the capture from `rowKeyPattern` on the total line (`rowKeyCapture` defaults to one). Spaces, parentheses and hyphens are ignored for this comparison. Missing, duplicate or unmatched totals require review. A block never borrows a heading from the next block.

`requireEnd: true` flags a missing `end` marker. The existing ending match modes remain available. `outputColumns` is an optional ordered list of table column and group names to export. The live output uses the same order. Without these optional properties, older templates behave as before.

Carried values retain their heading source boxes and OCR confidence in the internal extraction result for review and source highlighting.

See `fixtures/templates/northline-fuel-statement/v2.json` in the repository for a complete, working template.
