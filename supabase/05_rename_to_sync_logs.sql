-- Kiroku V4 — rename the sync log table from event_logs to sync_logs.
-- Run once on a database that already ran 04_sync_logs.sql (or the older 04_event_logs.sql).
-- Then re-run 03_sync.sql, which now writes to sync_logs.
-- New installs do not need this file: 04_sync_logs.sql creates sync_logs directly.

alter table public.event_logs rename to sync_logs;
alter index event_logs_event_at_idx rename to sync_logs_event_at_idx;
alter index event_logs_record_idx   rename to sync_logs_record_idx;
alter index event_logs_user_idx     rename to sync_logs_user_idx;
alter index event_logs_source_idx   rename to sync_logs_source_idx;
alter policy "read event_logs" on public.sync_logs rename to "read sync_logs";
