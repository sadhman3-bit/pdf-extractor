# Power BI

Two ways to bring PDF Extractor's results into Power BI, and an example of matching them against data from your ERP.

## Option A: the SharePoint Folder connector (recommended)

This reads the CSV files in `Output/` directly. New files are picked up on each refresh.

1. In Power BI Desktop: **Get data → SharePoint folder**.
2. **Site URL:** your site, for example `https://contoso.sharepoint.com/sites/Finance` (the site, not the folder). Sign in with your organisational account.
3. In the file list, choose **Transform Data** (not Combine yet).
4. Filter to one template's CSV files:
   - Filter **Folder Path** to *contains* `/PDF Extractor/Output/northline-fuel-statement/`.
   - Filter **Extension** to *equals* `.csv`.
5. Click the **Combine Files** button on the **Content** column. Choose the first file as the example. Power BI detects UTF-8 (the files have a byte order mark), commas and the header row.
6. Set column types (**Transform → Data Type**):
   - Date columns (for example `StatementDate`, `Date`): **Date**. They're always `YYYY-MM-DD`, so no locale setting is needed.
   - Amount columns: **Fixed decimal number**. Other numbers: **Decimal number**.
   - `_TemplateVersion`: **Whole number**. `_ExtractedAt`: **Date/Time/Timezone**. `_Corrected`: **True/False**.
   - Everything else: **Text**.
7. Remove duplicates. If someone processed the same PDF twice under different names, its rows appear twice with the same `_SourceSha256`. Select `_SourceSha256` together with the columns that identify a row (for example `Date`, `Card`, `Amount`), then **Remove Rows → Remove Duplicates**.
8. **Close & Apply.**

Repeat for each template (each template has its own columns). In the Power BI service, set a scheduled refresh; a SharePoint source needs no gateway.

## Option B: SharePoint lists

If you built flow 3 from `POWER_AUTOMATE.md`, the rows are already in a SharePoint list. Use **Get data → SharePoint Online list**, enter the site URL, and pick the list. Set column types as above. This is simpler for small volumes but slower for large ones, and the list only has the columns you created.

## Example: matching against ERP data

A common use is checking supplier documents against what was recorded in the ERP, for example fuel card transactions against expense lines in a data warehouse.

### 1. Load the ERP data

**Get data → SQL Server** (or your warehouse's connector), and load the relevant table, for example `dw.FuelExpenses` with `CardNumber`, `TxnDate`, `Amount`, `Supplier`.

### 2. Normalise the keys on both sides

Reference numbers are written differently in different systems: `ST-0048213` versus `st 48213`. In Power Query, add a custom column on both tables with the same rule:

```
= let
    t = Text.Upper(Text.Trim([Reference])),
    noSpaces = Text.Remove(t, {" ", "-"}),
    letters = Text.Select(noSpaces, {"A".."Z"}),
    digits = Text.TrimStart(Text.Select(noSpaces, {"0".."9"}), "0")
  in
    letters & digits
```

This trims, upper-cases, removes spaces and dashes, and strips leading zeros from the number part, so `ST-0048213` and `st 48213` both become `ST48213`. Use it for statement and invoice numbers. For card numbers, compare the last four digits: `= Text.End(Text.Select([Card], {"0".."9"}), 4)`.

Build a match key from the normalised values, for example `CardLast4 & "|" & Date.ToText([Date], "yyyy-MM-dd") & "|" & Number.ToText([Amount], "0.00")`.

### 3. Merge

In Power Query, **Merge Queries** the PDF table with the ERP table on the match key, using a **Left Outer** join. Add a column `Matched = not List.IsEmpty([ERP])`, or expand an ERP column and test it for null.

### 4. A page for unmatched rows

Add a report page "Unmatched" with:

- A table visual showing the PDF rows where `Matched` is false: `_SourceFile`, `Date`, `Card`, `Site`, `Amount`.
- A card visual with the count and total of unmatched amounts.
- A slicer on `_Template` and on `Date` (by month).

Do the reverse merge (ERP left, PDF right) for ERP lines with no document behind them.

### Tips

- `_SourceFile` tells the team exactly which PDF to open; it's in `Processed/<month>/`.
- `_Corrected = true` rows were changed by a person in Review. A slicer on it makes those easy to audit.
- If amounts differ by cents, compare on rounded values or use a tolerance column such as `Number.Abs([Amount] - [ERP.Amount]) < 0.02`.
