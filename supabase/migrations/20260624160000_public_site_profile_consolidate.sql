-- get_public_site hardening (code-review follow-ups):
--  * deterministic latest-profile pick (tie-break on id, since the backfill
--    stamps every artist revision with the same now()).
--  * build the artist object from the snapshot blob (ap.data || {id,slug})
--    instead of re-listing every profile column — one read, and the field list
--    stops living in this function.
--  * media ordered by (sort_order, created_at) to match the dashboard/preview.

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
  latest as (
    select distinct on (r.entity_type, r.entity_id)
      r.entity_type, r.entity_id, r.data, r.published_at, r.id
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type in ('track', 'tour_date', 'merch', 'link', 'media')
    order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
  ),
  live as (
    select entity_type, data, published_at
    from latest
    where coalesce(data ->> '_deleted', 'false') <> 'true'
  )
  select case
    when not exists (select 1 from a) then null
    when not exists (select 1 from ap) then null
    else jsonb_build_object(
      'artist',
        (select data from ap)
        || jsonb_build_object('id', (select id from a), 'slug', (select slug from a)),
      'tracks',     coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'track'), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg(data order by (data ->> 'date'), published_at)
        from live where entity_type = 'tour_date'), '[]'::jsonb),
      'merch',      coalesce((
        select jsonb_agg(data order by (data ->> 'created_at'), published_at)
        from live where entity_type = 'merch'), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'link'), '[]'::jsonb),
      'media',      coalesce((
        select jsonb_agg(jsonb_build_object('purpose', data ->> 'purpose', 'path', data ->> 'storage_path')
                         order by (data ->> 'sort_order')::int nulls last, (data ->> 'created_at'), published_at)
        from live where entity_type = 'media'), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;
