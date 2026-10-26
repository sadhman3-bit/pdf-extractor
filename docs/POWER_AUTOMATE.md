# Power Automate flows

These three flows connect PDF Extractor to email, Teams and SharePoint lists. They use standard connectors only (Office 365 Outlook, SharePoint, Microsoft Teams), so no premium licence is needed. The app itself never talks to Microsoft services; the flows work on the shared folder.

Throughout, replace:

- `<site>` with your SharePoint site address, for example `https://contoso.sharepoint.com/sites/Finance`.
- `<library>` with the document library holding the folder (usually **Documents** / `Shared Documents`).
- `sadhman3-bit` with the GitHub account hosting the app.

The folder paths assume the workspace folder is called `PDF Extractor` at the top of the library.

---

## Flow 1: Email to Inbox

Saves PDF attachments from supplier emails into `PDF Extractor/Inbox`.

1. In Power Automate, choose **Create → Automated cloud flow**. Name it "PDF Extractor: email to Inbox".
2. Trigger: **When a new email arrives (V3)** (Office 365 Outlook).
   - **Folder:** Inbox (or a folder your mail rules move supplier mail into).
   - **Include Attachments:** Yes.
   - **Only with Attachments:** Yes.
   - **From:** the supplier's address, or leave empty and use **Subject Filter** (for example `Statement`).
3. Add **Apply to each**, with **Select an output from previous steps** set to `Attachments` (from the trigger).
4. Inside it, add **Condition**:
   - Left: expression `toLower(items('Apply_to_each')?['name'])`
   - Operator: **ends with**
   - Right: `.pdf`
5. In **If yes**, add **Create file** (SharePoint):
   - **Site Address:** `<site>`
   - **Folder Path:** `/<library>/PDF Extractor/Inbox`
   - **File Name:** expression `concat(formatDateTime(utcNow(), 'yyyyMMdd-HHmmss'), '-', items('Apply_to_each')?['name'])`
   - **File Content:** expression `base64ToBinary(items('Apply_to_each')?['contentBytes'])`
6. Save, then send yourself a test email with a PDF attached. The file should appear in the Inbox folder within a minute or two.

The time prefix stops two attachments with the same name overwriting each other. The app ignores the name when matching templates, so the prefix does no harm.

---

## Flow 2: Morning Teams nudge

Posts a message on weekday mornings when documents are waiting.

1. **Create → Scheduled cloud flow**. Name it "PDF Extractor: morning nudge".
2. Trigger: **Recurrence**.
   - **Interval:** 1, **Frequency:** Week.
   - **On these days:** Monday to Friday.
   - **At these hours:** 8, **At these minutes:** 30.
   - **Time zone:** your local time zone (for example (UTC+10:00) Canberra, Melbourne, Sydney).
3. Add **Get files (properties only)** (SharePoint):
   - **Site Address:** `<site>`
   - **Library Name:** `<library>`
   - **Limit Entries to Folder:** `/<library>/PDF Extractor/Inbox`
   - **Include Nested Items:** No.
4. Add **Condition**:
   - Left: expression `length(body('Get_files_(properties_only)')?['value'])`
   - Operator: **is greater than**
   - Right: `0`
5. In **If yes**, add **Post message in a chat or channel** (Microsoft Teams):
   - **Post as:** Flow bot.
   - **Post in:** Channel (pick your team and channel) or Group chat.
   - **Message:** switch to code view and use:

     ```
     @{length(body('Get_files_(properties_only)')?['value'])} new documents are waiting.
     <a href="https://sadhman3-bit.github.io/pdf-extractor/?view=process&from=teams">Open PDF Extractor</a>
     ```

6. Save and use **Test → Manually** to check the message.

The link opens the Process screen and shows "Opened from your Teams notification". Clicking **Process N files** then handles them all.

---

## Flow 3: Output to a SharePoint list

Copies each extracted row into a SharePoint list, for people who prefer lists to Power BI.

**Before you start:** create a SharePoint list (for example "Fuel transactions") with one column per value you want. Use **Single line of text** for text and dates, **Number** for numbers and amounts. Add a text column `SourceSha256` so you can spot duplicates.

1. **Create → Automated cloud flow**. Name it "PDF Extractor: output to list".
2. Trigger: **When a file is created (properties only)** (SharePoint).
   - **Site Address:** `<site>`
   - **Library Name:** `<library>`
   - **Folder:** `/<library>/PDF Extractor/Output/<template-id>` (one flow per template, or the `Output` folder with **Include Nested Items** if you add a condition on the template id below).
3. Add **Condition**:
   - Left: expression `toLower(triggerOutputs()?['body/{FilenameWithExtension}'])`
   - Operator: **ends with**
   - Right: `.json`
4. In **If yes**, add **Get file content** (SharePoint):
   - **Site Address:** `<site>`
   - **File Identifier:** `Identifier` (from the trigger).
5. Add **Parse JSON** (Data Operation):
   - **Content:** expression `json(body('Get_file_content'))`
   - **Schema:** paste the schema from `OUTPUT_FORMAT.md` ("Schema for Power Automate's Parse JSON").
6. Add **Apply to each**, with output expression `body('Parse_JSON')?['tables']?['Transactions']` (use your table's name).
7. Inside it, add **Create item** (SharePoint), pick your list, and map columns:
   - Row values: `items('Apply_to_each')?['Date']`, `items('Apply_to_each')?['Amount']` and so on.
   - Header values: `body('Parse_JSON')?['fields']?['StatementNo']` and so on.
   - `SourceSha256`: `body('Parse_JSON')?['source']?['sha256']`
8. Save. Process a file in the app and check that the list fills in.

For a template without tables, skip step 6 and create one item from `fields`.

---

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Flow 1 runs but nothing appears in Inbox | The **Folder Path** must start with the library, for example `/Shared Documents/PDF Extractor/Inbox`. Use the folder picker in the action to be sure. |
| "Create file" fails with a content error | **File Content** must use `base64ToBinary(...contentBytes)`, not the attachment object itself. |
| Files arrive but the app doesn't see them | OneDrive hasn't synced yet. Check the OneDrive icon on the PC, then press **Refresh** on the Process screen. |
| Flow 3 fires twice for one document | It fires for the CSV and the JSON. The `.json` condition in step 3 stops the CSV run. |
| Parse JSON fails with "Invalid type" | A value was `null` where the schema expected a type. Use the schema from `OUTPUT_FORMAT.md` unchanged; it allows nulls where they can occur. |
| The list gets duplicate rows | Someone processed the same PDF twice under different names. Filter on `SourceSha256`, or add a "Get items" step with a filter on it before "Create item". |
| The Teams link opens a blank page | Check that `github.io` isn't blocked on the work network (see `MANUAL_SETUP.md`). |
| Flow 2 posts at the wrong time | Set the **Time zone** in the Recurrence trigger; the default is UTC. |
