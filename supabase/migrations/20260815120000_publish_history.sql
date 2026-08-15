-- Publish HISTORY: the two reads a "go back to an earlier version" feature needs.
--
-- The revision log already holds every published state — publishing snapshots each row —
-- so nothing new is recorded here. What was missing is the ability to ask it about a
-- moment other than "now".
--
-- Both are SECURITY INVOKER (the default), so RLS on `revisions` applies and a manager
-- only ever sees their own artist's history, exactly like latest_revisions.

-- 1. The list of publish MOMENTS, newest first: one row per instant something was
--    published, with how many entities changed in it. Since 2026-08-15 publishContent
--    skips rows whose snapshot did not change, so every moment here is a real change —
--    before that, most were no-op republishes and this list would have been mostly
--    identical versions.
create or replace function public.publish_moments(p_artist_id uuid)
returns table (published_at timestamptz, entities bigint)
language sql
stable
set search_path = public
as $$
  select r.published_at, count(*) as entities
  from public.revisions r
  where r.artist_id = p_artist_id
  group by r.published_at
  order by r.published_at desc
$$;

-- 2. The published state AS OF a moment: the newest revision per entity at or before
--    `p_at`. Same DISTINCT ON shape as latest_revisions (which is this with p_at = now),
--    and in SQL for the same reason — reducing "latest per entity" in JS means selecting
--    the whole log, which PostgREST silently caps at 1000 rows, so a heavily republished
--    artist would restore from a window that had lost its newest rows.
--
-- Tombstones are RETURNED, not filtered: a row that was deleted before `p_at` must read
-- as absent at that moment, and only the caller knows that `_deleted` means "not there".
create or replace function public.revisions_at(p_artist_id uuid, p_at timestamptz)
returns table (entity_type text, entity_id uuid, data jsonb)
language sql
stable
set search_path = public
as $$
  select distinct on (r.entity_type, r.entity_id)
    r.entity_type, r.entity_id, r.data
  from public.revisions r
  where r.artist_id = p_artist_id
    and r.published_at <= p_at
  order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
$$;

revoke all on function public.publish_moments(uuid) from public, anon;
revoke all on function public.revisions_at(uuid, timestamptz) from public, anon;
grant execute on function public.publish_moments(uuid) to authenticated;
grant execute on function public.revisions_at(uuid, timestamptz) to authenticated;
