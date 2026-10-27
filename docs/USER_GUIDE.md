# User guide

PDF Extractor turns supplier PDFs (statements, invoices, certificates of analysis) into identical, checked CSV and JSON files. You teach it each supplier's layout once by clicking on a sample. From then on, every PDF from that supplier is read the same way, checked, and saved for Power Automate and Power BI.

Everything happens in your browser. Your documents are never uploaded (see `PRIVACY.md`).

**Use Chrome or Edge.** Other browsers can't save into folders and run in [basic mode](#basic-mode).

## Contents

1. [First run](#1-first-run)
2. [The workspace folder](#2-the-workspace-folder)
3. [Mapping a supplier (Mapper)](#3-mapping-a-supplier-mapper)
4. [Testing on samples](#4-testing-on-samples)
5. [Processing the inbox](#5-processing-the-inbox)
6. [Reviewing exceptions](#6-reviewing-exceptions)
7. [Settings](#7-settings)
8. [Working as a team](#8-working-as-a-team)
9. [Basic mode](#basic-mode)
10. [Using it offline](#10-using-it-offline)
11. [Keyboard use](#11-keyboard-use)
12. [Questions and problems](#12-questions-and-problems)

## 1. First run

1. Open the app and choose **Get started**.
2. Choose **Choose folder** and pick your team's synced SharePoint folder (normally called `PDF Extractor`). The browser asks to let the site view and edit files there; allow it.
3. The app lists the folders it will create. Choose **Create folders**.
4. Type your name and choose **Continue**. Your name goes into the audit log and into the "in use" notices other people see.
5. Choose **Create your first template** or **Process inbox**.

Next time you open the app it remembers the folder. If the browser has forgotten the permission, you'll see **Reconnect to your folder**: one click and you're back. Nothing is lost.

## 2. The workspace folder

```
PDF Extractor/
  Inbox/              PDFs waiting to be processed (Power Automate can drop them here)
  Processed/2026-10/  finished PDFs, filed by month
  Exceptions/         PDFs that need a person, each with a .review.json
  Output/<template>/  the CSV and JSON for each PDF
  Templates/          one folder per supplier layout, with versions and samples
  Audit/<name>/       who did what, one file per person per month
  .locks/             "in use" markers (safe to ignore)
  settings.json       shared settings
```

You can drop PDFs into `Inbox/` yourself, in File Explorer, or let a flow do it (see `POWER_AUTOMATE.md`).

## 3. Mapping a supplier (Mapper)

You need one sample PDF from the supplier.

The Mapper has three parts. **Your CSV**, on the left, lists everything that will become a column: the **Bill details** (the same on every row, such as the account number) and the **Line items** (one CSV row per item in the table). The PDF page is on the right. **Output**, at the bottom, shows the CSV as you build it.

1. On **Templates**, choose **New template** (or open **Mapper** and drop a PDF on it).
2. The app suggests a name and a **fingerprint**: text that appears on every document from this supplier, such as its name and ABN. Check it under **Recognise this supplier** at the bottom of the left-hand list ("Matches files that contain …" under the name).
3. **Map each value.** Click the value on the page (for example the statement number). Hovering shows exactly what a click will take: a click on any word takes the whole value, so "12 Mar 2026" or "Citric Acid Anhydrous" is one click. The app:
   - finds the label next to it (for example "Statement No"),
   - works out the type (date, amount, number or text),
   - suggests a standard name (for example `StatementNo`) and opens the field editor at the top of the Fields list.

   Check the name and type, then choose **Done**. The label, direction, pattern and page settings are under **More options**; you rarely need them.

   - **Several words:** drag a box across them, or hold **Shift** and click each one.
   - **Change a field:** click its value on the page (it opens that field rather than adding a second one), or click its name in the list. Pointing at a field in the list outlines its value on the page.
   - **Remove a field:** choose the **×** on its row. **Undo** in the message at the bottom of the screen puts it back.
4. **Suggestions.** Dashed amber boxes are values the app thinks you'll want; they're listed under **Suggestions** below your fields. **Accept** or **Dismiss** each one, choose **Accept all**, or simply click one on the page to accept it.
5. **Map the table** (if the document has one). Click the table's header row; a menu opens beside it, and **Map the table under this header row** maps it. If the header row has numbers in it (such as "Account Activity · Your Reference 55-10 2047"), choose **Choose the header row on the page** under **Line items** first, then click it. The app outlines the table with its row count and puts a **ruler** along its top, with a break between each pair of columns (placed in the empty gap between them) and each column's name. Totals that repeat for each group (such as "Total for 02 5550 0160" after every phone number) are skipped automatically, and page headers and footers that repeat on every page are ignored. Then click any line in the table: **What is this line?** opens beside it (press the letter shown next to a choice, or Esc to close):
   - **A heading:** copies the heading onto each row below it, as its own CSV column. "Telephone 02 5550 0160" gives a Telephone column with the number; a heading without numbers ("Services and equipment rental") gives a Section column, and one in capitals (a company name) gives a Company column.
   - **Not a row: skip lines like this.**
   - **A second line: put "…" in a column of its own:** for a line that belongs to the row above but is a separate value, such as "Rental" under a service's description. Lines that start at the same place go into the new column (named `Detail`); wrapped descriptions that start further left stay where they are.
   - **The table ends here:** for example at "Call details".
   - **This is the header row:** start the table again from this line.

   - **Add "…" as a bill detail instead:** for a value inside the table area that belongs on every row.

   Beside each line of the table, the page's left margin shows how it was read: **T** header row, **R** a new row, **+** part of the row above, **H** a heading, **–** skipped, **■** where the table ends, and a red **?** for a line that isn't part of any row. Point at a marker for its meaning. A **+** next to something that should be a heading, or a **?**, is the line to click next.

   Each choice applies to every line like it on every page. If the app finds a table on its own, **Line items** offers it with **Accept**.

   **Columns are yours to set on the ruler:**
   - **Add a column:** click the ruler where the new column starts, for example just left of a period such as "25 Dec to 24 Jan" or an amount without a heading. The new column appears in the output straight away; rename it under **Line items**.
   - **Move a break:** drag its handle, or focus it and press **Left** or **Right** (hold **Shift** for bigger steps). The line down the table shows where it falls.
   - **Remove a break:** point at it and choose **×**, or focus it and press **Delete**. The two columns become one.
   - **Start from scratch:** **Remove all column breaks** under **Line items** makes the table one column, so you can place every break yourself.

   Under **Line items**, rename the table (for example `Items`) and its columns, and set each column's type; **×** removes a column. **How lines are read** lists the rules in plain words, with how many lines each one matched, for example "Lines starting “Total for” are skipped · 12 lines"; **×** removes a rule. If some lines aren't part of any row, a red note says how many: choose **Show** to go to each one on the page, then click it to say what it is. **Table settings** says the same in plain choices you can change: where the table starts, what starts a new row ("has any text", "has the same shape as 99/99/9999" where 9 is any digit, or "starts with …"), where it ends, the lines to skip ("Starts with", "Reads exactly", "Page numbers", "In capitals", "No numbers") and the headings copied onto each row. You never need to write a pattern; **Edit as patterns (advanced)** at the bottom is there for layouts the choices can't describe.
6. **Checks** (at the bottom of the left-hand list). The app offers sensible checks, such as "the amounts add up to the total" and "GST is the total ÷ 11". Turn them on or off, or add your own (see `TEMPLATE_FORMAT.md` for the expression language).
   **Long documents.** Above the page, a strip shows every page: a green edge where the table has rows, a blue edge where it starts and ends, and amber where your search found something. Click a page to go there. **Find on the pages** (above the page) goes to each line containing the text you type: **Enter** for the next, **Shift+Enter** for the previous.

   **More than one table** (such as the service summary and the call details): choose **Add another table** under **Line items**, then click the new table's header row. Each table becomes a CSV file of its own. When there are several, buttons above **Line items** switch between them, and clicking a line of a table on the page switches to it too. For a table without a header row, click the line just above it (its title), then add its columns on the ruler.
   **The same CSV for every supplier.** Under **CSV layout** in the left-hand list, type a name (for example `Telco bills`) and choose **Save as a shared layout**: this template's columns, in order, become a layout any template can use. In another supplier's template, pick the layout under **Columns of the CSV**. Each layout column then shows **Found**, or **Not in this bill yet** with a list to fill it from one of this template's own columns (that column is renamed to match). The CSV gets exactly the layout's columns, in its order; a column this bill doesn't have is left empty. **Settings** lists the shared layouts and can remove one (templates keep their own copy).

7. **Output**, docked at the bottom of the screen, shows the CSV exactly as it will be written, for every page of the sample, and updates as you click. It shows the number of rows and any problems (cells that couldn't be read, or required values that are empty), in red. Choose the problem count to see only those rows. Click a value to see where it is on the page. **Download CSV** saves the CSV for this sample straight away; **Larger** and **Hide** change the panel's size.
8. Choose **Save template**. Each save creates a new version; old versions are kept.

Your work is saved as a draft as you go. If the tab closes, opening the template again offers **Resume** or **Discard**.

Under the page, type a page number to go straight to it, or use Page Up and Page Down while the page has focus. **Undo** and **Redo** above the page (or Ctrl+Z and Ctrl+Shift+Z) step back and forward through every change to the template. **Re-pick** a field to point it at a different value. **+ Add field from list** adds a standard field by name.

## 4. Testing on samples

Before relying on a template, test it on a few more PDFs from the same supplier.

1. In the Mapper, choose **Test on samples**, then drop 3 or 4 more PDFs on **Add samples**. They're kept in `Templates/<id>/samples/`.
2. The grid shows one row per field, table and check, and one column per sample. Green cells passed; red cells say why they failed.
3. **Suggested fixes:** when a label is printed differently on one sample (for example "GST included" instead of "Total GST"), the app finds it and offers "Add 'GST included' as another label for TotalGST". **Where it failed** shows the spot on the page. Choose **Apply**, and every sample is re-run.
4. When the summary reads, for example, "28 of 28 checks passed across 4 samples", choose **Save template**.

## 5. Processing the inbox

1. Open **Process**. The header shows the folders it reads and writes.
2. Choose **Process N files**. A progress bar shows each file; **Cancel** stops after the current file (a file is never left half done).
3. When it's finished:
   - The tiles count what happened: Extracted, Needs review, Unknown supplier, Rows written.
   - The files table lists each file with its template, status, a plain-English detail and the next step.
   - **Written to Output** lists the files written.

What happens to each file:

| Status | Meaning | Where the PDF goes |
| --- | --- | --- |
| Extracted | Matched a template and every check passed. CSV and JSON written to `Output/`. | `Processed/<month>/` |
| Needs review | A value is missing, didn't parse, was read with low confidence, or a check failed. | `Exceptions/` |
| Unknown supplier | No template matched. | `Exceptions/` |
| Ambiguous match | More than one template matched. | `Exceptions/` |
| Could not read | The PDF is password protected, damaged, or has no text and no readable scan. | `Exceptions/` |
| Already processed | The same PDF (same bytes) was already extracted. Nothing new is written. | `Processed/<month>/` |
| Skipped (in use) | Someone else is processing it right now. | stays in `Inbox/` |

**Scanned PDFs** are read with text recognition (OCR) automatically. The files table marks them "Scanned · read with OCR". OCR takes a few seconds per page, and any value it isn't sure about goes to review.

If the browser tab closes mid-run, just run it again: nothing is duplicated.

## 6. Reviewing exceptions

**Review** lists every file that needs a person, with the reason. Filter by reason at the top. Choose **Open**.

- The page is shown with the problem highlighted.
- Every value is editable. Values read by OCR with low confidence say so ("Read by OCR as 34.32, low confidence").
- The checks re-run as you type. When they all pass, the banner says "All checks pass. Approve to save the outputs."
- **Approve and save** writes the CSV and JSON (marked `_Corrected = true` if you changed anything, with your name in `_ReviewedBy`), records each change in the audit log, and files the PDF in `Processed/`.
- **Reject** moves the PDF to `Exceptions/Rejected/`, for example when a supplier sent the wrong document.
- **Skip for now** leaves it for later. Your edits are kept.

For an **unknown supplier**, choose **Create template from this file**. The Mapper opens with this PDF; after saving the template, come back and choose **Re-run this file**. For an **ambiguous match**, pick the right template from the list.

## 7. Settings

Open **Settings** (top right):

- **Your name** for audit lines.
- **Confidence threshold:** values read with lower confidence go to review. 0.8 is a good default; raise it to be stricter.
- **Add a byte-order mark to CSV files:** keep this on so Excel shows characters correctly.
- **Change folder**, **Export all templates (zip)** and **Import templates**.

## 8. Working as a team

- Everyone uses the same synced folder. Templates, outputs and settings are shared.
- When someone has a template, a review or a file open, others see "In use by Sam since 09:05" with **Open anyway**. Notices older than 30 minutes are ignored.
- Each person has their own audit file, so OneDrive never has to merge two people's edits.

## Basic mode

Firefox, Safari, or a browser where folder access is blocked can't save into folders. The app then shows: "This browser can't save into folders. Use Chrome or Edge for the full app. You can still map templates and extract single files."

In basic mode:

- Templates are stored in this browser only. Use **Import JSON** on Templates to load templates exported from the full app.
- On **Process**, choose **Open PDF files** or **Open a folder of PDFs**. Nothing is moved.
- Download results with **Download CSV**, **Download JSON**, **Download all as zip** or **Download XLSX**.

## 10. Using it offline

After the first visit the app keeps a copy of itself, so it opens and works without a network connection. In Chrome or Edge you can also install it: use the install icon in the address bar. OneDrive syncs the folder when you're back online.

## 11. Keyboard use

- **Tab** moves between controls; every button and field has a visible focus outline.
- In the Mapper's page view: **arrow keys** move between words, **Enter** selects the word (Shift+Enter adds it to the selection), **Escape** cancels, **Home** goes to the first word. A screen reader announces each word.
- Column breaks: focus one on the ruler and use **Left** and **Right** to move it (**Shift** for bigger steps), **Delete** to remove it. Focus the ruler itself and press **Enter** to split the widest column in two.

## 12. Questions and problems

| Problem | What to do |
| --- | --- |
| "Reconnect to your folder" on every visit | Allow the site to remember the permission when Chrome or Edge asks, or install the app. |
| "Downloading … from OneDrive" | The file was online-only. Wait a moment, or right-click the folder in File Explorer and choose **Always keep on this device**. |
| A supplier changed their layout | Open the template, map the new labels (or use **Test on samples** to get suggested fixes), and save. Old versions stay for old documents. |
| A value is read wrongly every time | Re-pick it, add a pattern or cleaner in the field editor, or set a fixed box. |
| "Something went wrong" | Choose **Reload**. If it keeps happening, choose **Copy details** and send them to whoever looks after the tool. Your files are safe. |
