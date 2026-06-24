-- latest_revisions(artist): the latest revision per (entity_type, entity_id) for
-- one artist, tombstones included (the caller decides what _deleted means).
--
-- diffUnpublished previously pulled the whole revisions table into JS and reduced
-- to "latest per entity" there — which PostgREST silently caps at 1000 rows, so a
-- heavily-republished artist could lose an entity's newest revision from the
-- window and show a false "unpublished" badge that disagrees with get_public_site
-- (which runs in SQL, uncapped). Doing the DISTINCT ON in SQL returns one row per
-- entity (far fewer than the row cap) and matches the public read path's ordering.
--
-- SECURITY INVOKER (default): RLS on `revisions` applies, so a manager only ever
-- sees their own artist's revisions.
create or replace function public.latest_revisions(p_artist_id uuid)
returns table (entity_type text, entity_id uuid, data jsonb)
language sql
stable
set search_path = public
as $$
  select distinct on (r.entity_type, r.entity_id)
    r.entity_type, r.entity_id, r.data
  from public.revisions r
  where r.artist_id = p_artist_id
  order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
$$;

revoke all on function public.latest_revisions(uuid) from public, anon;
grant execute on function public.latest_revisions(uuid) to authenticated;
