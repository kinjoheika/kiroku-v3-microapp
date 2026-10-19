# Kiroku — Google Sheet connected demo

The Kiroku working-DB UI (`index.html`) loading its data from a Google Sheet
instead of the browser's built-in seed. Sample data is fictional.

## Files

- `index.html` — Kiroku UI. Data loader at the top of the script (`SHEET_ID`, `SHEET_TABS`).
- `Kiroku_Sample_Sheet.xlsx` — the sample sheet, six tabs: `Users`, `Kumiai`, `Companies`, `JobOrders`, `Tasks`, `Activity`.
- `data/*.csv` — the same six tabs as CSV. Used when no Sheet ID is set.

## Run it locally

The page fetches CSV files, so it must be served over HTTP (not opened as a file):

```bash
python -m http.server 8765
```

Then open http://localhost:8765/.

## Connect a Google Sheet

1. In Google Drive: File > Import > upload `Kiroku_Sample_Sheet.xlsx` > "Google Sheets".
2. Share > General access > "Anyone with the link" > Viewer.
3. Copy the ID from the URL: `docs.google.com/spreadsheets/d/<ID>/edit`.
4. Either paste it into `SHEET_ID` in `index.html`, or open
   http://localhost:8765/?sheet=<ID>.
5. The header shows `source: Google Sheet …` when it loads from the Sheet.

Sheet tab names must match exactly (case-sensitive).

## Limits

- Read-only sync. Changes made in the UI (mark done, activity) stay in the
  browser and are not written back to the Sheet. Write-back needs an Apps Script
  web app or Supabase (see the plan).
- Permissions still come from `TASKS_CONFIG` in the script, not the `editor_id`
  column. The column is informational for now.
- The Sheet fetch uses Google's public gviz CSV endpoint. Not yet tested against
  a live Sheet from this environment; if it fails, the page falls back to the
  built-in seed and shows the reason in the header.

## Log UI edits to the Sheet (EditLog tab)

Every change made in the UI (mark done, activity logged, JO created / edited /
archived / deleted, and so on) is appended as a row to an `EditLog` tab.

1. In the Sheet: Extensions > Apps Script. Replace the code with `apps-script/Code.gs`.
2. Deploy > New deployment > Web app. Execute as: **Me**. Who has access: **Anyone**. Deploy and authorize.
3. Copy the Web app URL into `LOG_URL` in `index.html`.
4. Keep `LOG_TOKEN` in `index.html` equal to `TOKEN` in `Code.gs`.
5. Reload the page. The header shows `logging off` until `LOG_URL` is set, then `✓ logged N to Sheet` after each change.

Columns: `logged_at, user, entity, entity_id, field, old_value, new_value, source`.

Security: the token sits in the page source, so this is demo-grade. Anyone who
can read the page can write to the log. Use a proper backend before real data goes in.

## Field masterlist (config page)

`config.html` is the masterlist of every field the worksheets must carry, grouped
by tab and owning department. Each tab has a **Copy header row** button (paste into
the worksheet) and **Export header CSV**. Lookups and reference values are on the
Reference page.

Open: http://localhost:8765/config.html
