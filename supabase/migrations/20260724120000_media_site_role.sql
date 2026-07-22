-- Photos can be PLACED in a named component slot (skeen's polaroid wall).
--
-- The About wall is 5 polaroid cards, each holding TWO images: the square photo and a
-- transparent PNG of handwriting on the strip below it. Ten slots. Until now a media row
-- could only be addressed by `purpose`, which is a closed 3-value CHECK
-- ('hero_video','profile_photo','gallery_image') — there was no way to say "this photo
-- is polaroid 3's". So the fields skeen already declares (polaroid_1_photo …
-- polaroid_5_caption) arrived with nowhere to write to.
--
-- `site_role` is that address, mirroring `videos.site_role` (20260716200000). It differs
-- in ONE way, deliberately (Sam, 2026-07-21): videos use a closed CHECK listing the two
-- hero slots, because lone-star knows them. Component slot names belong to the SITE —
-- skeen's are `polaroid_<n>_<part>`, and the next custom site will bring its own — so a
-- closed list here would need a migration every time a site changed its layout. The
-- CHECK constrains the SHAPE only (lowercase, digits, underscore, <=64) so a typo can't
-- become a weird key, while the set of valid names stays the site's manifest to define.
--
-- A row with site_role set belongs to a COMPONENT, not the gallery collage: both the
-- editor's gallery groups and skeen's mapGallery exclude it, so a handwriting PNG never
-- turns up in the photo wall.
--
-- get_public_site's media branch CHERRY-PICKS columns (unlike the pass-through branches),
-- so it must be redefined to emit the new field. Reproduced verbatim from
-- 20260720120000 with `site_role` added to the media jsonb_build_object and nothing else
-- changed.

alter table public.media add column if not exists site_role text
  check (site_role is null or site_role ~ '^[a-z0-9_]{1,64}$');

-- One photo per slot per artist. A slot holds a single image; assigning a second must
-- replace, not silently double up. Partial so ordinary gallery rows (site_role null) are
-- unconstrained.
create unique index if not exists media_artist_site_role_uniq
  on public.media (artist_id, site_role)
  where site_role is not null;

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
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.links lnk on lnk.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'link' and coalesce(lnk.on_site, true)), '[]'::jsonb),
      'videos',     coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.videos v on v.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'video' and coalesce(v.on_site, true)), '[]'::jsonb),
      'media',      coalesce((
        select jsonb_agg(jsonb_build_object(
                           'purpose', data ->> 'purpose',
                           'path', data ->> 'storage_path',
                           'orientation', data ->> 'orientation',
                           'site_role', data ->> 'site_role')
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

