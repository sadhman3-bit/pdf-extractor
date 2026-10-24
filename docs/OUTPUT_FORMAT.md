# Output format

For every file that is extracted (or approved in Review), PDF Extractor writes two files to `Output/<template-id>/`:

- `<base>.csv` for Power BI and Excel (`<base>.<Table>.csv` when a template has more than one table).
- `<base>.json` for Power Automate.

`<base>` is the PDF's file name without `.pdf`. If a different file already used that name, ` (2)`, ` (3)` and so on are added. The CSV is always written before the JSON, so when the JSON appears, the CSV is already complete.

## CSV

- UTF-8 with a byte order mark (so Excel shows characters such as `–` and `•` correctly), comma separated, RFC 4180 quoting, CRLF line endings.
- Dates as `YYYY-MM-DD`. Numbers use `.` for decimals and have no thousands separators. Amounts keep the decimal places printed on the document.
- One row per table row. Header fields are repeated on every row, so each row stands alone. A template without tables gives one row.
- Audit columns are always last:

| Column | Meaning |
| --- | --- |
| `_SourceFile` | The PDF's file name. |
| `_SourceSha256` | SHA-256 of the PDF's bytes. Use it to remove duplicates. |
| `_Template` | Template id. |
| `_TemplateVersion` | Template version used. |
| `_ExtractedAt` | When it was extracted, ISO 8601 UTC. |
| `_Status` | Always `ok` in Output (other files go to Exceptions). |
| `_ReviewedBy` | Who approved it in Review, or empty. |
| `_Corrected` | `true` when someone changed a value in Review, otherwise `false`. |

Example:

```
StatementNo,StatementDate,TotalGST,TotalDue,Date,Card,Site,Product,Litres,Amount,_SourceFile,_SourceSha256,_Template,_TemplateVersion,_ExtractedAt,_Status,_ReviewedBy,_Corrected
ST-48213,2026-09-30,38.56,424.18,2026-09-03,•• 0021,Ryde,Diesel,52.10,98.45,northline-sep26.pdf,bd1ba59d…,northline-fuel-statement,2,2026-10-22T09:14:03Z,ok,,false
```

## JSON (`pdfx.extraction/1`)

The JSON holds everything about one file: where it came from, which template read it, every value, every check, and any corrections.

```json
{
  "schema": "pdfx.extraction/1",
  "source": { "file": "northline-sep26.pdf", "sha256": "bd1ba59d…", "pages": 2, "ocr": false },
  "template": { "id": "northline-fuel-statement", "version": 2 },
  "status": "ok",
  "reasons": [],
  "fields": { "StatementNo": "ST-48213", "StatementDate": "2026-09-30", "TotalGST": 38.56, "TotalDue": 424.18 },
  "tables": {
    "Transactions": [
      { "Date": "2026-09-03", "Card": "•• 0021", "Site": "Ryde", "Product": "Diesel", "Litres": 52.1, "Amount": 98.45 }
    ]
  },
  "checks": [
    { "id": "c1", "label": "Amounts add up to TotalDue", "result": "pass", "severity": "error" }
  ],
  "confidence": { "min": 1 },
  "extractedAt": "2026-10-22T09:14:03Z",
  "reviewedBy": null,
  "corrections": []
}
```

| Key | Meaning |
| --- | --- |
| `source` | File name, SHA-256, page count, and whether OCR was used. |
| `template` | Template id and version, or `null`. |
| `status` | `ok` in Output. Review files in Exceptions can also show `review`, `unknown`, `ambiguous` or `error`. |
| `reasons` | Why a file needed review: `{ code, message, field?, table?, row?, column?, page?, bbox? }`. Empty for `ok`. |
| `fields` | Field values. Text and dates are strings (dates as `YYYY-MM-DD`); numbers and currency are numbers; a missing value is `null`. |
| `tables` | Each table as an array of row objects, keyed by column name. Group columns are included. |
| `checks` | Each check with `result` (`pass`, `fail` or `unknown`), `severity`, and a `message` when it didn't pass. |
| `confidence.min` | The lowest confidence of any value (1 for digital text). |
| `reviewedBy` | Who approved it, or `null`. |
| `corrections` | Changes made in Review: `{ field, table?, row?, from, to }`. `row` counts from 0. |

**Reason codes:** `password_protected`, `unreadable`, `no_text`, `unknown_template`, `ambiguous_template`, `missing_field`, `parse_failed`, `table_not_found`, `row_parse_failed`, `check_failed`, `check_unknown`, `low_confidence`.

## Schema for Power Automate's "Parse JSON"

Paste this into the **Schema** box of the "Parse JSON" action. Table rows are left open (`"type": "object"` with no fixed properties) so one schema works for every template. Use `items(...)?['ColumnName']` to read a column inside "Apply to each".

```json
{
  "type": "object",
  "properties": {
    "schema": { "type": "string" },
    "source": {
      "type": "object",
      "properties": {
        "file": { "type": "string" },
        "sha256": { "type": "string" },
        "pages": { "type": "integer" },
        "ocr": { "type": "boolean" }
      }
    },
    "template": {
      "type": ["object", "null"],
      "properties": {
        "id": { "type": "string" },
        "version": { "type": "integer" }
      }
    },
    "status": { "type": "string" },
    "reasons": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "code": { "type": "string" },
          "message": { "type": "string" }
        }
      }
    },
    "fields": { "type": "object" },
    "tables": {
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": { "type": "object" }
      }
    },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "label": { "type": "string" },
          "result": { "type": "string" },
          "severity": { "type": "string" }
        }
      }
    },
    "confidence": {
      "type": "object",
      "properties": { "min": { "type": "number" } }
    },
    "extractedAt": { "type": "string" },
    "reviewedBy": { "type": ["string", "null"] },
    "corrections": { "type": "array", "items": { "type": "object" } }
  }
}
```

## Review files (`Exceptions/<name>.review.json`)

A file that needs a person goes to `Exceptions/` with a review file next to it (schema `pdfx.review/1`). It holds the file name, SHA-256, when it arrived, the full extraction result (with reasons and the boxes to highlight), and any edits in progress. Edits are saved as you type, so reopening the file restores them. Approving writes the outputs above and removes the review file.

## Audit log (`Audit/<user>/audit_YYYY-MM.csv`)

One file per person per month (so two people never write to the same file through OneDrive). Columns: `Timestamp`, `User`, `Action`, `File`, `Sha256`, `Template`, `Version`, `Field`, `OldValue`, `NewValue`, `Note`. Actions: `extracted`, `duplicate`, `corrected`, `approved`, `skipped`, `rejected`, `template_saved`, `template_archived`.
