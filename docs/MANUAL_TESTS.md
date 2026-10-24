# Manual tests

The automated tests cover the engine, the folder logic and every screen (in Chromium, with a browser-private stand-in for the real folder). These checks need real Windows, OneDrive and Microsoft 365 accounts, so a person must do them. Do them before relying on the tool and after any major browser or OneDrive change.

Record the date, browser version and result for each.

## 1. Real folder access in Chrome and Edge (Windows)

Do this in both Chrome and Edge.

- [ ] Open the app and choose **Get started → Choose folder**. Pick the OneDrive-synced `PDF Extractor` folder. The browser asks to "view and edit files"; allow it.
- [ ] The app lists the folders to create. Choose **Create folders**. Check in File Explorer that `Inbox`, `Processed`, `Exceptions`, `Output`, `Templates`, `Audit` and `.locks` exist, and that they sync to SharePoint (green ticks, and visible in the browser on SharePoint).
- [ ] Close the browser completely and reopen the app. Either it opens straight into the app, or it shows **Reconnect to your folder**, and one click (plus allowing the prompt) restores access with nothing lost.
- [ ] Choose "Allow on every visit" if the browser offers it, close and reopen: the app opens without asking.
- [ ] Copy a PDF into `Inbox` in File Explorer, wait for it to sync, then **Process**. The CSV and JSON appear in `Output/<template>/` and in SharePoint.
- [ ] Set the `Inbox` folder to **Free up space** (online-only), add a PDF from SharePoint in the browser, then **Process**. The app shows "Downloading … from OneDrive" and then processes it.
- [ ] Rename a file so that two outputs would share a name; the second gets ` (2)`.

## 2. Two people at once

Use two PCs (or two browser profiles with different names) on the same synced folder.

- [ ] Person A opens a template in the Mapper. Person B opens the same template: B sees "In use by A since …" with **Open anyway**.
- [ ] Person A opens an exception in Review. Person B sees the in-use notice for it.
- [ ] Both choose **Process** at about the same time with several files in `Inbox`. Each file is processed once; some show "Skipped (in use)" for one person. No file appears twice in `Output`.
- [ ] Each person's actions are in their own `Audit/<name>/audit_YYYY-MM.csv`, and OneDrive creates no "conflict" copies.
- [ ] Wait 30 minutes after A closes the tab without finishing: B no longer sees the in-use notice.

## 3. Install and offline

- [ ] In Chrome or Edge, install the app from the address bar. It opens in its own window with the app icon.
- [ ] Turn off Wi-Fi (or unplug the network). Open the installed app: it loads, shows the folder, and **Process** works on PDFs already in `Inbox`, including a scanned PDF (OCR works offline).
- [ ] Turn the network back on: OneDrive uploads the outputs.
- [ ] After a new version is deployed, open the app twice: the new version is shown (Settings shows the version number).

## 4. Power Automate flows

Follow `POWER_AUTOMATE.md`.

- [ ] **Email to Inbox:** send an email with a PDF attachment (and a non-PDF attachment). Only the PDF appears in `Inbox`, with a time prefix.
- [ ] **Morning nudge:** run the flow manually with files in `Inbox`: the Teams message shows the right count, and its link opens the Process screen with "Opened from your Teams notification". With `Inbox` empty, no message is posted.
- [ ] **Output to list:** process a file: one list item per table row, with header values filled in. The CSV doesn't trigger a second run.

## 5. Power BI

Follow `POWER_BI.md`.

- [ ] Option A loads the CSVs for one template with correct types (dates as dates, amounts as numbers, `•` characters shown correctly).
- [ ] Processing a new file and refreshing adds its rows. Processing a renamed copy of the same PDF doesn't add duplicates after the duplicate-removal step.
- [ ] The ERP matching example lists unmatched rows on the "Unmatched" page.

## 6. Basic mode

- [ ] Open the app in Firefox (or Safari). The basic-mode notice shows.
- [ ] Import a template exported from the full app (**Templates → Import JSON**). Open a folder of PDFs on **Process**, and download the zip. The CSVs match the full app's outputs for the same PDFs.

## 7. Real documents

- [ ] Map one real supplier from scratch with real samples, on the work PC. Check the CSV against the PDFs by eye for at least 3 documents.
- [ ] Process a real scanned document. Values the OCR isn't sure about go to Review and are highlighted.
