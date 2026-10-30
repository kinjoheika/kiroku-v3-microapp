# Kiroku → Supabase setup

## Files in this folder

| File | What it does |
|---|---|
| `01_schema.sql` | Creates the tables: `users`, `kumiai`, `companies`, `job_orders`, `tasks`, `activity`, `edit_log`. Also turns on security rules. |
| `02_seed.sql` | Loads the sample data from the repo's `data/*.csv` (5 users, 2 kumiai, 4 companies, 8 job orders, 144 tasks, 16 activities). |
| `make_seed.py` | Rebuilds `02_seed.sql` from CSVs: `python make_seed.py <repo>/data` |

Both SQL files have been tested together on a blank Postgres database.

## Step 1: Create the project (you do this)

1. Go to https://supabase.com/dashboard and sign in (GitHub sign-in is fine).
2. Click **New project**.
   - Organization: your company's org (create one if asked).
   - Name: `kiroku`
   - Database password: click **Generate**, then save it in your password manager (KeePassXC).
   - Region: **Southeast Asia (Singapore)**, the closest region to PH and JP.
   - Plan: Free is enough for now.
3. Wait about 2 minutes for it to finish setting up.

## Step 2: Create the tables

1. In the left menu, open **SQL Editor** and click **New query**.
2. Paste the whole of `01_schema.sql` and click **Run**. You should see "Success. No rows returned".

## Step 3: Load the sample data

1. Open a **New query** again.
2. Paste the whole of `02_seed.sql` and click **Run**.

## Step 4: Check it

Open **Table Editor**. The row counts should be: users 5, kumiai 2, companies 4,
job_orders 8, tasks 144, activity 16, edit_log 0.

## Step 5: Get the connection details

Open **Project Settings > API** (it may also be called **API Keys / Data API**) and copy:

- **Project URL**, for example `https://abcd1234.supabase.co`
- **anon / publishable key**

You can safely put these two in the web page. Never paste the **service_role / secret** key into the page, the repo or the chat.
That key skips every security rule.

## Security (what the rules allow right now)

- **Anyone with the page** can *read* the data, the same as today's "anyone with the link" Sheet.
- **Nobody** can *write* yet. Writes are open only to logged-in users, and logins come in a later step.
- Times from the sheet (`done_at`) are stored as Philippine time (+08:00).

## Next steps (after Step 5)

1. Make `index.html` read from Supabase instead of the Sheet. The Sheet and CSV stay as a fallback.
2. Add logins (Supabase Auth, email magic link) and link each login to a `users` row through `auth_user_id`.
3. Save "mark done", follow-ups, notes and messages to the database, and write each change to `edit_log`.
   Then the Apps Script logger and its token, which anyone can read in the page, are no longer needed.
4. Uploads: add a private Storage bucket and save each file's path in `activity.file_path`.
5. Bring in the real data from the four live Google Sheets. Export each tab as CSV and run `make_seed.py`.

---

## V4: sync the Google Sheets into Supabase

Files: `03_sync.sql` (the sync function), `apps-script/Sync.gs` (reads the sheets and calls it).

1. **Run `03_sync.sql`** in the SQL Editor, after `01_schema.sql`.
   Do NOT run `02_seed.sql` if you will sync the real sheets (it would load the sample data first).
2. **Copy the keys** from Project Settings > API:
   the Project URL and the **service_role** key (secret).
3. **Apps Script:** open ONE Google Sheet (the masterlist) > Extensions > Apps Script, paste `apps-script/Sync.gs`.
   One copy syncs all five sheets; copies in other sheets would run the sync several times.
   Project Settings (gear icon) > Script Properties, add:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_SERVICE_KEY` = the service_role key
   - `SHEET_ID_1` … `SHEET_ID_4` = the spreadsheet IDs (the part between `/d/` and `/edit` in the URL)
4. `SOURCES` at the top of `Sync.gs` lists each sheet, its owner and the tabs it sends.
5. Run `syncAll` once (Run button) and approve the permissions. Check the Execution log.
   Then run `installTrigger` once to sync every 5 minutes.

Re-running a sync never duplicates rows: each row is matched by its key
(`user_id`, `kumiai_id`, `company_id`, `jo_id`, `task_id`, or `activity_key` for activity).
Every new row and every changed field is recorded in `event_logs` (run `04_event_logs.sql` first), and each run in `sync_runs`.

If `event_logs` has the old columns (`event_id`, `occurred_at`, `actor`, `entity` …), every sync fails.
Repair: run `07_fix_event_logs.sql`, then re-run `03_sync.sql`, then run `syncAll` once.
The old rows are kept in `event_log_old`, and their created/updated history is copied into `event_logs`.

**Who sends what (one owner per row, so no sheet overwrites another):**

| Sheet | Sends to Supabase |
|---|---|
| Masterlist | Users, Kumiai, Companies, JobOrders (synced first) |
| Doc Officer 1..4 | Only Tasks where `editor_id` is that officer (u1..u4), and Activity on those tasks |

Every Doc Officer sheet still shows every task. After the sync, the other officers' task rows are
rewritten from Supabase and shaded grey; edits there are ignored and put back. New companies and
job orders go in the masterlist.
Each Doc Officer sheet needs only Tasks, Activity and Event Log: run `removeUnusedTabs` once to delete
its Users, Kumiai, Companies and JobOrders tabs. Run `Sync.gs` from **one** Apps Script project only (for example
the masterlist's), with one trigger: `syncAll` already loops over all five sheets.

After each sync, `Sync.gs` also copies that sheet's latest 500 `event_logs` rows into an **Event Log** tab
in the same Google Sheet (created on the first run). It is a read-only copy: it is rewritten every sync,
never synced back, and edits there show a warning. Supabase stays the real log.

Never put the service_role key in `index.html` or any file in the GitHub repo.

---

## V4: activity log (Recent Actions + Configuration > Event Logs)

File: `06_activity_logs.sql`. Run it once in the SQL Editor, after `01_schema.sql`.

It creates `activity_logs`: one permanent row per action on a task (Follow Up, Send Message,
Log Note, Upload, Mark Done, Status Change, Task Update, Save). The page writes only through
`log_task_activity()`, which:

- stamps the server time (not the browser clock)
- reads the user's name from `users` (and, once logins exist, uses the signed-in user instead of the dropdown)
- takes the job order from the task, so a row always points at the right job order
- returns the existing row when the same click is sent twice

Rows cannot be updated, deleted or truncated, not even with the service_role key (a trigger blocks it).
The script also adds the table to Supabase Realtime so open pages show new actions without a refresh.

Until this script is run, the task page shows "Activity log not reachable" and actions are not recorded.
