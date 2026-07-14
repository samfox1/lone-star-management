-- Rename `visible` → `on_site` on every table that has it.
--
-- WHY: the dashboard has spoken "on-site / off-site" since the site-editor work
-- (on-site-filter.tsx, use-on-site-selection.ts, ON_SITE_TABLE), because that is
-- what the flag actually means to a manager: is this thing on my website right
-- now? `visible` was the older, vaguer word and invited the wrong reading — it
-- sounds like a display/CSS concern rather than "published to the public site".
-- The column now matches the UI and the code.
--
-- A boolean can't be named both halves, so: on_site = true is on-site, false is
-- off-site. Same semantics as before, purely a rename — no default, nullability,
-- or value changes, so nothing appears or disappears at the cutover.
--
-- Blast radius checked before writing this:
--   - skeen-website (the one deployed consumer) reads ONLY get_public_site's
--     output over REST. That payload never exposed `visible`: media is projected
--     to {purpose, path}, and no other snapshot allowlist carries the column. The
--     rename is invisible to it.
--   - The dashboard app is not deployed (no vercel.json / .vercel), so there is
--     no live reader to break.
--
-- SNAPSHOT BACK-COMPAT: `media` is the one type that carries this flag INSIDE the
-- published revision (PUBLISHABLE.media.snapshot, 20260713160000) so the gallery
-- gate reads the published selection rather than the live row. Revisions already
-- written hold a `visible` key and are immutable — we do not rewrite history. So
-- get_public_site reads on_site first and falls back to the old key:
--     coalesce((data->>'on_site')::boolean, (data->>'visible')::boolean, true)
-- The `visible` arm can be dropped once every artist has published once after
-- this migration. Ancient snapshots have neither key → true, unchanged.
--
-- Every media row will show as "edited" until republished, because diffUnpublished
-- compares snapshot keys and the key genuinely changed. One publish clears it.

alter table public.releases   rename column visible to on_site;
alter table public.videos     rename column visible to on_site;
alter table public.merch      rename column visible to on_site;
alter table public.tour_dates rename column visible to on_site;
alter table public.tracks     rename column visible to on_site;
alter table public.links      rename column visible to on_site;
alter table public.media      rename column visible to on_site;

-- ---------------------------------------------------------------------------
-- Every function that reads the flag, re-pointed at the new name. Bodies are
-- otherwise byte-for-byte the behavior they had before.

-- get_public_site — unchanged from 20260714120000 except trk/td/m/v.visible →
-- .on_site and the media snapshot key fallback described above.
create or replace function public.get_public_site(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (
    select id, slug from public.artists where slug = p_slug
  ),
  ap as (
    select r.data
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type = 'artist'
    order by r.published_at desc, r.id desc
    limit 1
  ),
  live as (
    select entity_type, data, published_at
    from public.published_revisions((select id from a))
  )
  select case
    when not exists (select 1 from a) then null
    when not exists (select 1 from ap) then null
    else jsonb_build_object(
      'artist',
        (select data from ap)
        || jsonb_build_object('id', (select id from a), 'slug', (select slug from a)),
      'tracks',     coalesce((
        select jsonb_agg(
                 (t.data - 'audio_path')
                 || jsonb_build_object('has_audio', (t.data ->> 'audio_path') is not null)
                 order by (t.data ->> 'sort_order')::int nulls last, t.published_at)
        from live t
        left join public.tracks trk on trk.id = (t.data ->> 'id')::uuid
        where t.entity_type = 'track'
          and coalesce(trk.on_site, true)), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'date'), l.published_at)
        from live l
        left join public.tour_dates td on td.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'tour_date' and coalesce(td.on_site, true)), '[]'::jsonb),
      'merch',      coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'created_at'), l.published_at)
        from live l
        left join public.merch m on m.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'merch' and coalesce(m.on_site, true)), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'link'), '[]'::jsonb),
      'videos',     coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.videos v on v.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'video' and coalesce(v.on_site, true)), '[]'::jsonb),
      'media',      coalesce((
        select jsonb_agg(jsonb_build_object('purpose', data ->> 'purpose', 'path', data ->> 'storage_path')
                         order by (data ->> 'sort_order')::int nulls last, (data ->> 'created_at'), published_at)
        from live
        where entity_type = 'media'
          and (data ->> 'purpose' <> 'gallery_image'
               or coalesce((data ->> 'on_site')::boolean, (data ->> 'visible')::boolean, true))
        ), '[]'::jsonb),
      'site_content', coalesce((
        select jsonb_object_agg(data ->> 'key', data ->> 'value')
        from live where entity_type = 'site_content' and data ->> 'key' is not null), '{}'::jsonb),
      'styles', coalesce((
        select jsonb_object_agg(data ->> 'region_key', data ->> 'class_names')
        from live
        where entity_type = 'site_styles'
          and data ->> 'region_key' is not null
          and coalesce(data ->> 'class_names', '') <> ''), '{}'::jsonb)
    )
  end;
$$;

revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;

-- get_release — unchanged from 20260714130000 except r.visible → r.on_site.
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
      and coalesce(r.on_site, true)
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

revoke all on function public.get_release(text, text) from public;
grant execute on function public.get_release(text, text) to anon, authenticated;

-- get_public_releases — unchanged from 20260709120000 except r.visible →
-- r.on_site. (The INNER JOIN here is pre-existing: unlike the other doors it
-- drops a published release the moment its working row is deleted. That is
-- fail-closed, so it is left alone rather than widened in a rename migration.)
create or replace function public.get_public_releases(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_slug)
  select coalesce(
    jsonb_agg(pr.data order by (pr.data ->> 'sort_order')::int nulls last, pr.published_at)
      filter (where r.on_site and public.music_release_is_released(pr.data)),
    '[]'::jsonb)
  from public.published_revisions((select id from a), 'release') pr
  join public.releases r on r.id = (pr.data ->> 'id')::uuid
$$;

revoke all on function public.get_public_releases(text) from public;
grant execute on function public.get_public_releases(text) to anon, authenticated;

-- audio_path_for_play — unchanged from 20260710170000 except trk.visible →
-- trk.on_site.
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
  left join public.tracks trk on trk.id = p_track_id
  where coalesce(trk.on_site, true)
$$;

revoke all on function public.audio_path_for_play(text, uuid) from public;
grant execute on function public.audio_path_for_play(text, uuid) to anon, authenticated;
