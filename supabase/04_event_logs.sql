-- Kiroku V4 — event_logs: one permanent row per recorded change or activity.
-- Run once in: Supabase dashboard > SQL Editor > New query > paste > Run.
-- Run after 01_schema.sql. Does not change any existing table.
--
-- Written by:
--   * sync_entity / sync_import (supabase/03_sync.sql) for Google Sheets changes
--   * Sync.gs for failed syncs
--   * Kiroku itself for Follow Up / Send Message / Log Note / Upload / Mark Done
--     (needs a signed-in user; not yet enabled)
--
-- Timestamps are stored in UTC (timestamptz). The Configuration page shows them in Asia/Manila.

create table public.event_logs (
  id            bigint generated always as identity primary key,   -- unique event ID
  event_at      timestamptz not null default now(),                -- when it happened (UTC)
  event_type    text not null check (event_type in
                  ('Record Created','Record Updated','Record Deleted','Sync Completed','Sync Failed','Activity')),
  source        text not null check (source in ('Google Sheets','Supabase','Kiroku')),
  user_id       text references public.users(user_id),             -- null when the sheet edit is not tied to a user
  user_name     text,                                              -- shown on the page even when user_id is null
  action        text not null,                                     -- Create, Update, Delete, Sync, Follow Up, ...
  module        text not null,                                     -- Users, Companies, Job Orders, Tasks, Activity, Sync
  record_id     text,                                              -- stable ID of the affected record
  field_changed text,                                              -- only for Record Updated
  old_value     text,
  new_value     text,
  description   text not null,                                     -- human-readable line for the page
  sync_status   text not null default 'Success' check (sync_status in ('Success','Failed','Pending')),
  source_sheet  text,                                              -- doc-officer-1 .. doc-officer-4 for sheet events
  created_at    timestamptz not null default now()
);

create index event_logs_event_at_idx on public.event_logs (event_at desc);
create index event_logs_record_idx   on public.event_logs (module, record_id);
create index event_logs_user_idx     on public.event_logs (user_id);
create index event_logs_source_idx   on public.event_logs (source, event_type);

-- Anyone with the publishable key can read the history (same as the other tables).
-- Only the service_role key (sync) and, later, signed-in users can write.
alter table public.event_logs enable row level security;
create policy "read event_logs" on public.event_logs for select to anon, authenticated using (true);

revoke insert, update, delete on public.event_logs from anon, authenticated;
