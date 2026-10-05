-- Enquiries are kept for a while, not forever (Sam, 2026-10-05).
--
-- "If it works correctly, the user will never need to go to the inquiries page, because they
-- receive the emails themselves … nice to have for some days in case that email disconnects …
-- I dont want them to lose important info, but also, I dont want to have to store those files
-- and messages for too long."
--
-- THE RULE, decided the same day:
--   status 'sent'   → deleted 30 days after it arrived (the manager has it in their mail)
--   anything else   → deleted after 90 (failed, unroutable, still queued, any later status:
--                     the dashboard is the only copy, so it gets the longer time)
-- 'sent' means Resend ACCEPTED the email, not that it was delivered: there is no bounce
-- handling yet (LAUNCH_CHECKLIST.md). A dry run is never marked 'sent'; it stays 'queued'
-- (deliveryRecord in supabase/functions/contact/validate.ts).
-- Anchored on created_at for both. The attachments go with the enquiry. The inbox shows each
-- enquiry's "deleted in N days" from the SAME rule: src/lib/enquiries/retention.ts. Change one,
-- change both.
--
-- ┌──────────────────────────────────────────────────────────────────────────────────────────┐
-- │ AT PUSH TIME                                                                             │
-- │ 1. Before pushing, see what the FIRST run will delete (nothing is undoable after it):   │
-- │      select status, count(*) from public.enquiries                                       │
-- │      where created_at <= now() - case when status = 'sent' then interval '720 hours'     │
-- │                                       else interval '2160 hours' end                     │
-- │      group by 1;                                                                         │
-- │    Tell Sam the number. If any of it must be kept, export it first.                      │
-- │ 2. `supabase db push` (the installed CLI, never npx).                                    │
-- │ 3. `npm run audit:grants`: prune_enquiries, enquiry_delete_at and                        │
-- │    enquiry_prune_schedule must NOT be in the list.                                       │
-- │ 4. Flip RETENTION_PUSHED to true in tests/integration/enquiries/enquiry-retention.test.ts│
-- │    and run that file.                                                                    │
-- │ 5. Deploy the contact Edge Function (`supabase functions deploy contact`): it is what    │
-- │    deletes the audio FILES this job queues. Until then the files wait in the queue,      │
-- │    named and safe to delete later, never forgotten.                                      │
-- │ 6. The morning after: `select * from public.enquiry_prune_schedule()` (service role)     │
-- │    shows last_status 'succeeded'.                                                        │
-- └──────────────────────────────────────────────────────────────────────────────────────────┘
--
-- THE FILES. Deleting an enquiry cascades its `enquiry_attachments` rows, but the audio
-- OBJECTS live in the private `enquiry-attachments` bucket, and SQL cannot delete those
-- safely: a row removed from `storage.objects` leaves the file itself in the bucket, paid for
-- and pointed at by nothing (the reason the 90-day attachment sweep runs in the contact Edge
-- Function, not here; and current Supabase refuses a direct delete from storage tables
-- outright). The Storage API has to be the one deleting. So the job does the half Postgres
-- can do safely and records the rest:
--
--   prune_enquiries()       in ONE statement: picks the due enquiries, copies their
--                           attachments' storage paths into `enquiry_file_purges`, deletes
--                           the enquiries (attachment rows follow by cascade). One snapshot,
--                           so what is queued is exactly what was deleted.
--   enquiry_file_purges     the paths still to delete. A path leaves only after the Storage
--                           API has removed the object, so a failed delete is retried, never
--                           lost. A path whose upload never completed deletes as a no-op.
--   the contact function    drains the queue through the Storage API after each stored
--                           enquiry (supabase/functions/contact/index.ts, drainFilePurges),
--                           the same place and the same calls as the existing attachment
--                           sweep. It is the one deployed server code that holds the service
--                           key today; the dashboard runs only on localhost until launch.
--                           Its weakness is that it rides on traffic: on a quiet week the
--                           files wait. When the dashboard is online, a nightly runner
--                           (Vercel Cron, or pg_cron + pg_net calling a function) can drain
--                           the same queue with no change here.
--
-- Already-expired attachments (storage_path null, `expired_at` stamped) have no object left
-- and are not queued.
--
-- SCHEDULE: nightly at 04:20 UTC, clear of analytics' 03:10 roll-up and 03:40 prune. pg_cron
-- is already installed (20260912130000), and `cron.schedule` upserts by name, so re-running
-- this file rewrites the job rather than adding a second one.
--
-- WHY SECURITY DEFINER (the house rule is invoker): pg_cron runs as `postgres`, which owns
-- these tables, but the job must not depend on who runs it or on RLS: `enquiries` and
-- `enquiry_attachments` are manager-read only, and an invoker without BYPASSRLS would see no
-- rows and delete nothing, silently. As definer it sees every row. The cost of that is the
-- grant: service_role only, in the full revoke form (AGENTS.md "Grants"). Neither function
-- takes a time from the caller, so even service_role cannot make it delete anything newer than
-- the rule. `p_artist_id` only NARROWS a run (the integration test prunes its own throwaway
-- artist and nobody else's); null is every artist, which is what the schedule runs.

-- ---------------------------------------------------------------------------
-- 1. The rule, once
-- ---------------------------------------------------------------------------
-- 720 and 2160 HOURS, never '30 days': Postgres adds a day-interval in calendar days of the
-- session's time zone, so across a daylight-saving change '30 days' is 719 or 721 hours and
-- the job would disagree with the inbox's note by an hour. Hours are the same in every zone.
-- A null status is not 'sent', so it gets the longer time; a null created_at gives null, and
-- `null <= now()` deletes nothing.
create or replace function public.enquiry_delete_at(p_status text, p_created_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select p_created_at
       + case when p_status = 'sent' then interval '720 hours' else interval '2160 hours' end
$$;

comment on function public.enquiry_delete_at(text, timestamptz) is
  'When an enquiry becomes due for deletion: created_at + 30 days if sent, else + 90 (exact hours). Mirrored by deleteAt() in src/lib/enquiries/retention.ts.';

revoke all on function public.enquiry_delete_at(text, timestamptz) from public, anon, authenticated;
grant execute on function public.enquiry_delete_at(text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The files still to delete
-- ---------------------------------------------------------------------------
-- No foreign keys on purpose: the enquiry and attachment rows are gone by the time a path is
-- here, and the path must outlive them. `storage_path` is unique so a re-run queues nothing
-- twice. bigint identity so the drain can delete exactly the rows it handled by id.
create table if not exists public.enquiry_file_purges (
  id           bigint generated always as identity primary key,
  storage_path text not null unique check (storage_path <> ''),
  queued_at    timestamptz not null default now()
);

comment on table public.enquiry_file_purges is
  'Audio files in the enquiry-attachments bucket whose enquiry prune_enquiries() deleted. The contact Edge Function deletes each object through the Storage API, then its row. Service role only.';

-- RLS on with no policy, and no grant to anon or authenticated: nobody but the service role
-- (BYPASSRLS) and the definer function ever touches it.
alter table public.enquiry_file_purges enable row level security;
revoke all on table public.enquiry_file_purges from public, anon, authenticated;
-- Its id sequence too: Supabase's default privileges grant usage on every new sequence to anon
-- and authenticated by role, the same trap as functions (AGENTS.md "Grants"). Useless to them
-- without the table, but nobody but the service role has a reason to hold it.
revoke all on sequence public.enquiry_file_purges_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The job
-- ---------------------------------------------------------------------------
-- Returns how many enquiries it deleted (pg_cron's run log shows it). Idempotent: a second run
-- finds nothing due, and a path already queued is skipped.
create or replace function public.prune_enquiries(p_artist_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  with due as (
    select e.id
    from public.enquiries e
    where public.enquiry_delete_at(e.status, e.created_at) <= now()
      and (p_artist_id is null or e.artist_id = p_artist_id)
    -- Locked, so a row changed mid-run is re-read before it is chosen, and `queued` and
    -- `gone` below act on the same rows.
    for update
  ),
  queued as (
    insert into public.enquiry_file_purges (storage_path)
    select a.storage_path
    from public.enquiry_attachments a
    join due on due.id = a.enquiry_id
    where a.storage_path is not null
    on conflict (storage_path) do nothing
  ),
  gone as (
    delete from public.enquiries e
    using due
    where e.id = due.id
    returning e.id
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end;
$$;

comment on function public.prune_enquiries(uuid) is
  'Nightly (pg_cron enquiries-prune): deletes enquiries past enquiry_delete_at and queues their audio in enquiry_file_purges. p_artist_id narrows a run; null is every artist.';

revoke all on function public.prune_enquiries(uuid) from public, anon, authenticated;
grant execute on function public.prune_enquiries(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The schedule, and a way to see it
-- ---------------------------------------------------------------------------
select cron.schedule('enquiries-prune', '20 4 * * *', $$select public.prune_enquiries()$$);

-- The same readout as analytics_schedule() (20260912140000), for this one job: the `cron`
-- schema is not exposed through PostgREST, and a schedule nobody can see is one that stops
-- one night and is noticed months later, when the inbox has quietly kept everything. Definer
-- for the same reason as that one (service_role has no usage on `cron`); it returns job
-- metadata only, no tenant data.
create or replace function public.enquiry_prune_schedule()
returns table (
  jobname      text,
  schedule     text,
  command      text,
  active       boolean,
  runs_as      text,
  last_run     timestamptz,
  last_status  text,
  last_message text
)
language sql
security definer
stable
set search_path = ''
as $$
  select j.jobname::text,
         j.schedule::text,
         j.command::text,
         j.active,
         j.username::text,
         d.end_time,
         d.status::text,
         left(coalesce(d.return_message, ''), 200)
  from cron.job j
  left join lateral (
    select x.end_time, x.status, x.return_message
    from cron.job_run_details x
    where x.jobid = j.jobid
    order by x.start_time desc
    limit 1
  ) d on true
  where j.jobname = 'enquiries-prune'
$$;

revoke all on function public.enquiry_prune_schedule() from public, anon, authenticated;
grant execute on function public.enquiry_prune_schedule() to service_role;

-- ---------------------------------------------------------------------------
-- 5. Say it where the next reader looks
-- ---------------------------------------------------------------------------
comment on table public.enquiries is
  'Contact-form enquiries. Deleted by prune_enquiries(): 30 days after arrival if emailed (status sent), 90 otherwise.';
comment on table public.enquiry_attachments is
  'Audio files attached to a demo enquiry. Objects live in the private enquiry-attachments bucket. Deleted with their enquiry (prune_enquiries queues the object in enquiry_file_purges); an object older than 90 days is also swept on its own, leaving this row as a tombstone. Written only by the /contact Edge Function (service role).';
