-- Kiroku V4 — activity_logs: one permanent row per action a user takes on a task.
-- Run once in: Supabase dashboard > SQL Editor > New query > paste > Run.
-- Run after 01_schema.sql. Does not change any existing table.
--
-- Read by:
--   * the task detail's Recent Actions card (rows for that task)
--   * Configuration > Event Logs (rows for every task the viewer can see)
--
-- Written only through log_task_activity(), never by direct insert:
--   * the timestamp is the server's now(), not the browser clock
--   * the user name is read from public.users, not sent by the page
--   * when logins exist, the signed-in user (users.auth_user_id = auth.uid())
--     replaces whatever user the page sends
--   * the task's job order is read from public.tasks, so a row can never point
--     at the wrong job order
-- Rows can never be changed or deleted (see the trigger below), so the history is append-only.

create table public.activity_logs (
  activity_id     bigint generated always as identity primary key,
  client_ref      uuid unique,                                       -- one per click; a retried request cannot add a second row
  task_id         text references public.tasks(task_id),             -- null for job-order-level updates
  jo_id           text not null references public.job_orders(jo_id),
  user_id         text not null references public.users(user_id),
  user_name       text not null,
  action_type     text not null check (action_type in
                    ('Follow Up','Send Message','Log Note','Upload','Mark Done','Status Change','Task Update','Save')),
  action_details  text,                                              -- note text, file name, what changed
  previous_status text,
  updated_status  text,
  created_at      timestamptz not null default now()                 -- server time (UTC); the page shows Asia/Manila
);

create index activity_logs_task_idx    on public.activity_logs (task_id, created_at desc);
create index activity_logs_jo_idx      on public.activity_logs (jo_id, created_at desc);
create index activity_logs_created_idx on public.activity_logs (created_at desc);
create index activity_logs_user_idx    on public.activity_logs (user_id);

-- ---------------------------------------------------------------- append-only
create function public.activity_logs_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'activity_logs is append-only: rows cannot be changed or deleted';
end $$;

create trigger activity_logs_no_update before update or delete on public.activity_logs
  for each row execute function public.activity_logs_append_only();
create trigger activity_logs_no_truncate before truncate on public.activity_logs
  for each statement execute function public.activity_logs_append_only();

-- ---------------------------------------------------------------- writer
-- p_entries: [{client_ref, user_id, task_id, jo_id, action_type, details,
--              previous_status, updated_status}, ...]  (1 to 50 entries, all or nothing)
-- task_id is optional; without it, jo_id is required (job-order-level update).
-- Returns the stored rows. A client_ref that was already stored returns the existing
-- row instead of adding another, so a double-submit records one activity.
create function public.log_task_activity(p_entries jsonb)
returns setof public.activity_logs
language plpgsql security definer set search_path = public
as $$
declare
  e      jsonb;
  v_user public.users;
  v_jo   text;
  v_ref  uuid;
  v_row  public.activity_logs;
begin
  if jsonb_typeof(p_entries) is distinct from 'array'
     or jsonb_array_length(p_entries) not between 1 and 50 then
    raise exception 'log_task_activity: send 1 to 50 entries';
  end if;

  for e in select value from jsonb_array_elements(p_entries) loop
    v_user := null;
    v_jo   := null;
    v_row  := null;
    v_ref  := nullif(e->>'client_ref', '')::uuid;

    -- who: the signed-in Kiroku user when logins exist, otherwise the user the page names
    if auth.uid() is not null then
      select * into v_user from public.users where auth_user_id = auth.uid();
    end if;
    if v_user.user_id is null then
      select * into v_user from public.users where user_id = e->>'user_id';
    end if;
    if v_user.user_id is null then
      raise exception 'log_task_activity: unknown user %', coalesce(e->>'user_id', '(none)');
    end if;

    -- which job order: always the task's own, when a task is given
    if nullif(e->>'task_id', '') is not null then
      select jo_id into v_jo from public.tasks where task_id = e->>'task_id';
      if v_jo is null then
        raise exception 'log_task_activity: unknown task %', e->>'task_id';
      end if;
    else
      select jo_id into v_jo from public.job_orders where jo_id = e->>'jo_id';
      if v_jo is null then
        raise exception 'log_task_activity: unknown job order %', coalesce(e->>'jo_id', '(none)');
      end if;
    end if;

    insert into public.activity_logs
      (client_ref, task_id, jo_id, user_id, user_name, action_type,
       action_details, previous_status, updated_status)
    values
      (v_ref, nullif(e->>'task_id', ''), v_jo, v_user.user_id, v_user.name, e->>'action_type',
       left(nullif(e->>'details', ''), 2000),
       left(nullif(e->>'previous_status', ''), 60),
       left(nullif(e->>'updated_status', ''), 60))
    on conflict (client_ref) do nothing
    returning * into v_row;

    if v_row.activity_id is null then
      select * into v_row from public.activity_logs where client_ref = v_ref;
    end if;
    return next v_row;
  end loop;
end $$;

-- ---------------------------------------------------------------- access
-- Anyone with the publishable key can read the history (same as the other tables).
-- Nobody can insert, update or delete directly; the page writes through log_task_activity().
alter table public.activity_logs enable row level security;
create policy "read activity_logs" on public.activity_logs for select to anon, authenticated using (true);
grant  select on public.activity_logs to anon, authenticated;
revoke insert, update, delete, truncate on public.activity_logs from anon, authenticated;

revoke execute on function public.log_task_activity(jsonb) from public;
grant  execute on function public.log_task_activity(jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- realtime
-- So an open Kiroku page shows other users' actions without a refresh.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.activity_logs;
  end if;
end $$;
