# PDF Extractor

Turn supplier PDFs (fuel card statements, phone bills, invoices, certificates of analysis) into clean, identical-every-time CSV and JSON tables. Map a supplier's layout once by clicking on a sample; every later PDF from that supplier is read the same way and checked.

It runs entirely in your browser. Documents never leave your computer.

- Live app: `https://<owner>.github.io/pdf-extractor/` (see `docs/MANUAL_SETUP.md`)
- Works best in Chrome or Edge on Windows, with a SharePoint folder synced through OneDrive.

## Documentation

| Document | For |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | Everyone using the app |
| [Privacy](docs/PRIVACY.md) | What happens to your documents, and what is stored where |
| [Manual setup](docs/MANUAL_SETUP.md) | The owner: publishing, the shared folder, first run |
| [Manual tests](docs/MANUAL_TESTS.md) | Checks that need real Windows, OneDrive and Microsoft 365 |
| [Power Automate](docs/POWER_AUTOMATE.md) | Email to Inbox, the Teams nudge, output to a SharePoint list |
| [Power BI](docs/POWER_BI.md) | Reporting on the outputs, and matching against ERP data |
| [Template format](docs/TEMPLATE_FORMAT.md) | Reading or hand-editing templates |
| [Output format](docs/OUTPUT_FORMAT.md) | The CSV and JSON files, with the Parse JSON schema |
| [Decisions](docs/DECISIONS.md) | Choices made while building it, and measured performance |

## Quick start (developers)

```
pnpm install
pnpm dev
```

See `AGENTS.md` for all commands (lint, typecheck, unit and end-to-end tests, fixtures, goldens, performance).

## Data

The repository contains code and synthetic sample documents only. All companies, people and numbers in `fixtures/` are made up.
