-- MUSIC PRESENCE WAITS FOR PUBLISH (PRESENCE_PLAN.md S1, ADR 0010).
--
-- Sam, 2026-09-10: "blindly adding songs to the site seems problematic." A song ticked
-- on the Music page now goes into the site DRAFT — the working row's on_site — and the
-- editor preview (which renders working rows) shows it in place. Fans see it only when
-- it is PUBLISHED. So the doors for tracks and releases stop gating on the LIVE row's
-- on_site and gate on the value carried IN THE SNAPSHOT instead. Every other list type
-- keeps the live-row gate (tour dates and merch go straight to the site by design).
--
-- ONE-TIME BACKFILL, so nobody wakes up "dirty". `on_site` joins the track and release
-- snapshot lists in src/lib/content.ts today; a revision published before today lacks
-- the key, and the unpublished-changes diff would report every song as changed (the
-- exact trap 20260902120000 documents for merch). Each entity's LATEST revision gets
-- on_site copied in from its working row. Older revisions are left alone — history is
-- history — and the doors fall back to the live row when a snapshot has no key at all.
--
-- The fallback order in every door: snapshot on_site → live row on_site → true. The
-- middle term is only ever reached by a revision older than this migration.

-- ---------------------------------------------------------------------------------
-- Backfill: latest revision per track / release ← working row's on_site
-- ---------------------------------------------------------------------------------
with latest as (
  select distinct on (r.entity_type, r.entity_id) r.id, r.entity_type, r.entity_id
  from public.revisions r
  where r.entity_type in ('track', 'release')
    and r.entity_id is not null
    and coalesce((r.data ->> '_deleted')::boolean, false) = false
  order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
)
update public.revisions rv
   set data = rv.data || jsonb_build_object('on_site', coalesce(t.on_site, true))
  from latest l
  join public.tracks t on t.id = l.entity_id
 where rv.id = l.id and l.entity_type = 'track'
   and rv.data ->> 'on_site' is null;

with latest as (
  select distinct on (r.entity_type, r.entity_id) r.id, r.entity_type, r.entity_id
  from public.revisions r
  where r.entity_type in ('track', 'release')
    and r.entity_id is not null
    and coalesce((r.data ->> '_deleted')::boolean, false) = false
  order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
)
update public.revisions rv
   set data = rv.data || jsonb_build_object('on_site', coalesce(rl.on_site, true))
  from latest l
  join public.releases rl on rl.id = l.entity_id
 where rv.id = l.id and l.entity_type = 'release'
   and rv.data ->> 'on_site' is null;

-- ---------------------------------------------------------------------------------
-- get_public_releases: the LIST door
-- ---------------------------------------------------------------------------------
create or replace function public.get_public_releases(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_slug)
  select coalesce(
    jsonb_agg(pr.data order by (pr.data ->> 'release_date') desc nulls last, pr.published_at desc)
      filter (where coalesce((pr.data ->> 'on_site')::boolean, r.on_site, true)
                and public.music_release_is_released(pr.data)),
    '[]'::jsonb)
  from public.published_revisions((select id from a), 'release') pr
  left join public.releases r on r.id = (pr.data ->> 'id')::uuid
$$;

-- ---------------------------------------------------------------------------------
-- get_release: the PAGE door
-- ---------------------------------------------------------------------------------
create or replace function public.get_release(p_artist_slug text, p_release_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_artist_slug),
  rel as (
    select pr.data
    from public.published_revisions((select id from a), 'release') pr
    left join public.releases r on r.id = (pr.data ->> 'id')::uuid
    where pr.data ->> 'slug' = p_release_slug
      and public.music_release_is_released(pr.data)
      and coalesce((pr.data ->> 'on_site')::boolean, r.on_site, true)
    limit 1
  )
  select rel.data || jsonb_build_object(
    'tracks',
    coalesce((
      select jsonb_agg(
               (t.data - 'audio_path')
               || jsonb_build_object('has_audio', (t.data ->> 'audio_path') is not null)
               order by (t.data ->> 'sort_order')::int nulls last, t.published_at)
      from public.published_revisions((select id from a), 'track') t
      where t.data ->> 'release_id' = rel.data ->> 'id'
    ), '[]'::jsonb)
  )
  from rel
$$;

-- ---------------------------------------------------------------------------------
-- audio_path_for_play: the AUDIO door — a song's own presence, from the snapshot
-- ---------------------------------------------------------------------------------
create or replace function public.audio_path_for_play(p_slug text, p_track_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_slug),
  t as (
    select data
    from public.published_revisions((select id from a), 'track')
    where entity_id = p_track_id
    limit 1
  )
  select t.data ->> 'audio_path'
  from t
  left join lateral (
    select public.music_release_is_released(r.data) as released
    from public.published_revisions((select id from a), 'release') r
    where r.data ->> 'id' = t.data ->> 'release_id'
    limit 1
  ) rel on true
  left join public.tracks trk on trk.id = p_track_id
  where (public.music_track_on_platform(t.data) or coalesce(rel.released, false))
    and coalesce((t.data ->> 'on_site')::boolean, trk.on_site, true)
$$;
