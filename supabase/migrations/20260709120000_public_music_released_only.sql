-- MUSIC RESTRUCTURE: the public doors expose RELEASED music only.
--
-- Released vs Unreleased is DERIVED from provenance (decided 2026-07-08, see
-- MUSIC_RESTRUCTURE.md): an item is Unreleased iff it has no platform presence —
-- uploaded/manual with no DSP id or link. Unreleased music is dashboard-only, so
-- get_public_site / get_release / get_public_releases now filter it out. The two
-- helpers below are the SQL mirror of src/lib/music.ts (the single source of
-- truth); change them together.
--
-- Classification reads the PUBLISHED SNAPSHOT (revisions.data), not the working
-- tables, so a deleted-but-still-published track keeps serving until its
-- tombstone — same seam as everything else. Snapshots published before the
-- provenance fields existed have no `source` key: `coalesce(->>'source','')`
-- then reads '' <> 'manual' → Released, so nothing already public vanishes.
--
-- Also in this migration: get_release drops the album_name string-match
-- fallback — tracklist membership is `release_id` only (the FK has been
-- authoritative since 20260706170000).

-- A release snapshot is Released iff it has ANY platform presence:
-- non-manual source, a Spotify id, or at least one DSP link.
create or replace function public.music_release_is_released(d jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(d ->> 'source', '') <> 'manual'
      or d ->> 'spotify_id' is not null
      or (jsonb_typeof(d -> 'links') = 'array' and jsonb_array_length(d -> 'links') > 0)
$$;

-- A loose track snapshot is Released iff it carries any platform linkage.
-- (A track WITH a release_id inherits its release's bucket — the doors do that
-- join; this helper is only the loose-track rule.)
create or replace function public.music_track_on_platform(d jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(d ->> 'source', '') <> 'manual'
      or d ->> 'spotify_id' is not null
      or d ->> 'apple_id' is not null
      or d ->> 'deezer_id' is not null
      or d ->> 'provider_url' is not null
      or d ->> 'stream_url' is not null
      or d ->> 'apple_url' is not null
$$;

-- Internal helpers for the SECURITY DEFINER doors — not callable by clients.
revoke all on function public.music_release_is_released(jsonb) from public, anon, authenticated;
revoke all on function public.music_track_on_platform(jsonb) from public, anon, authenticated;

-- get_public_site: the tracks branch narrows to Released. A track with a
-- release_id inherits that release's bucket (from the release snapshots in the
-- same publish log); a loose track — or one whose release snapshot is missing —
-- falls back to its own provenance. Everything else is unchanged from
-- 20260707200000.
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
        left join lateral (
          select public.music_release_is_released(r.data) as released
          from live r
          where r.entity_type = 'release'
            and r.data ->> 'id' = t.data ->> 'release_id'
          limit 1
        ) rel on true
        where t.entity_type = 'track'
          and coalesce(rel.released, public.music_track_on_platform(t.data))), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'date'), l.published_at)
        from live l
        left join public.tour_dates td on td.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'tour_date' and coalesce(td.visible, true)), '[]'::jsonb),
      'merch',      coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'created_at'), l.published_at)
        from live l
        left join public.merch m on m.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'merch' and coalesce(m.visible, true)), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'link'), '[]'::jsonb),
      'videos',     coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.videos v on v.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'video' and coalesce(v.visible, true)), '[]'::jsonb),
      'media',      coalesce((
        select jsonb_agg(jsonb_build_object('purpose', data ->> 'purpose', 'path', data ->> 'storage_path')
                         order by (data ->> 'sort_order')::int nulls last, (data ->> 'created_at'), published_at)
        from live where entity_type = 'media'), '[]'::jsonb),
      'site_content', coalesce((
        select jsonb_object_agg(data ->> 'key', data ->> 'value')
        from live where entity_type = 'site_content' and data ->> 'key' is not null), '{}'::jsonb)
    )
  end;
$$;

-- get_release: an Unreleased release has no public smart-link page (null, same
-- as an unknown slug), and the tracklist is release_id membership ONLY — the
-- album_name string-match fallback is gone. Tracks inside a Released release
-- inherit its bucket, so no extra per-track filter is needed here.
create or replace function public.get_release(p_artist_slug text, p_release_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (select id from public.artists where slug = p_artist_slug),
  rel as (
    select data
    from public.published_revisions((select id from a), 'release')
    where data ->> 'slug' = p_release_slug
      and public.music_release_is_released(data)
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

-- get_public_releases: the EPK discography lists Released releases only.
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
      filter (where r.visible and public.music_release_is_released(pr.data)),
    '[]'::jsonb)
  from public.published_revisions((select id from a), 'release') pr
  join public.releases r on r.id = (pr.data ->> 'id')::uuid
$$;
