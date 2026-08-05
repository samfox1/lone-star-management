-- The payload learns SLOTS: `fonts` loses `role`, and `font_slots` arrives as a map.
--
-- WHY A MAP AND NOT A FLAG ON THE FONT: `role` on the font row could only ever express
-- one-font-one-slot (see 20260805180000). The consuming site sets one CSS variable per
-- slot, so `{slot: family}` is literally the shape it iterates — no filter, no find, no
-- second pass to notice that two slots share a family.
--
-- CONTRACT CHANGE, not an additive key: `fonts[].role` is GONE. Every revision published
-- before this migration lacks `font_slots` entirely, and every revision published before
-- 20260805160000 lacks `fonts` too — both are read with `?? []` / `?? {}` on our side
-- (lib/site.ts), and skeen was told the same rule. There was no live role data and no
-- published artist_font revision when this shipped, so nothing in the wild loses a slot.
--
-- A slot can never name an unpublished font: `font_slots` is built by unnesting the
-- `slots` array carried INSIDE each published font's own snapshot, so a slot's existence
-- in the payload is the same fact as its font's presence in it.
--
-- Reproduced verbatim from 20260805160000 with the `fonts` and `font_slots` keys changed
-- and nothing else touched.
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
          and coalesce(data ->> 'class_names', '') <> ''), '{}'::jsonb),
      'fonts', coalesce((
        select jsonb_agg(jsonb_build_object(
                           'family', data ->> 'family',
                           'label',  data ->> 'label',
                           'path',   data ->> 'storage_path',
                           'format', data ->> 'format')
                         order by data ->> 'family')
        from live
        where entity_type = 'artist_font'
          and data ->> 'family' is not null
          and data ->> 'storage_path' is not null), '[]'::jsonb),
      'font_slots', coalesce((
        select jsonb_object_agg(slot, f.data ->> 'family')
        from live f
        cross join lateral jsonb_array_elements_text(f.data -> 'slots') as slot
        where f.entity_type = 'artist_font'
          and f.data ->> 'family' is not null
          and f.data ->> 'storage_path' is not null
          and jsonb_typeof(f.data -> 'slots') = 'array'), '{}'::jsonb)
    )
  end;
$$;
