-- Content visibility for videos / merch / tour dates — the same live "show on the
-- site" toggle releases already have (20260706180000_release_visibility). Managers
-- curate which items are on the site (a select checkbox per card) and commit with a
-- password-gated publish; `visible` is the LIVE gate (flipping it takes effect
-- instantly, outside the draft/publish snapshot).
--
-- Defaults true so anything already published stays live. New/imported rows are
-- inserted false (createContent + syncExternal) so imports land off-site and the
-- manager publishes them on — which keeps the invariant "visible=true ⟹ actually
-- live" (the only path to visible=true is a publish, which also snapshots content).
alter table public.videos      add column if not exists visible boolean not null default true;
alter table public.merch       add column if not exists visible boolean not null default true;
alter table public.tour_dates  add column if not exists visible boolean not null default true;

-- get_public_site now gates videos / merch / tour_dates on the LIVE `visible` flag
-- (joined to the published snapshot by id), so a manager toggling visibility
-- shows/hides an item instantly without republishing. Content still comes from the
-- published revision — only exposure is the live toggle. Everything else (tracks,
-- links, media, site_content, ordering, has_audio strip) is unchanged.
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
                 (data - 'audio_path')
                 || jsonb_build_object('has_audio', (data ->> 'audio_path') is not null)
                 order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'track'), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'date'), l.published_at)
        from live l
        join public.tour_dates td on td.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'tour_date' and td.visible), '[]'::jsonb),
      'merch',      coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'created_at'), l.published_at)
        from live l
        join public.merch m on m.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'merch' and m.visible), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'link'), '[]'::jsonb),
      'videos',     coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        join public.videos v on v.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'video' and v.visible), '[]'::jsonb),
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

revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;
