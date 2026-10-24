# Privacy

**Your documents never leave your computer.** PDF Extractor is a web page that does all its work inside your browser. It reads PDFs from the folder you choose, extracts the data in the browser, and writes the results back to that same folder. Nothing is uploaded anywhere.

## What the app does and doesn't do

- It loads its own files (the page, the PDF reader, the text-recognition engine and its English language data) from the address you opened it from. After the first visit it keeps a copy, so it works offline.
- It makes **no other network requests**: no analytics, no tracking, no crash reporting, no fonts or scripts from other websites. The page's security policy blocks connections to any other site, and the automated tests fail if the app ever tries one.
- It never talks to Microsoft 365, SharePoint, Teams or Power BI. Those connect to your folder separately, through the flows you set up yourself (see `POWER_AUTOMATE.md` and `POWER_BI.md`).
- Scanned pages are read with text recognition (OCR) that runs in your browser. The images are never sent anywhere.

## What is stored, and where

| What | Where | Who can see it |
| --- | --- | --- |
| Your PDFs, outputs, templates, review files, audit logs and settings | The folder you chose (normally a SharePoint folder synced with OneDrive) | Anyone with access to that folder |
| Your name (for audit lines and "in use" notices) | This browser's local storage | Only this browser profile |
| Which folder you chose | This browser's IndexedDB | Only this browser profile |
| A copy of any template draft you're editing, so nothing is lost if the tab closes | This browser's IndexedDB | Only this browser profile |
| Templates, in basic mode only | This browser's private storage (Origin Private File System) | Only this browser profile |
| The app's own files, for offline use | The browser's cache | Only this browser profile |

The browser asks your permission before the app can read or write the folder. You can withdraw it at any time in the browser's site settings, and clearing the site's data removes everything in the last five rows.

## The audit log

Every extraction, correction, approval, rejection and template change is recorded in `Audit/<your name>/audit_YYYY-MM.csv` inside the shared folder, with the time and your name. This is so a team can see who changed what. It stays in your folder like any other file.

## The source code

The public repository contains only the app's code and made-up sample documents. No real company documents, names or data are ever committed.
