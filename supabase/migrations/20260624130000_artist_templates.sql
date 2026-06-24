-- Selectable public-site templates. Each artist picks a template; the public
-- page renders the matching design from the same published data.
alter table public.artists
  add column template text not null default 'classic'
  check (template in ('classic', 'cinematic'));

-- Expose `template` and `spotify_artist_id` on the public read path so the
-- public site can pick a template and embed the artist's Spotify catalog.
-- (spotify_artist_id is public info — it's in the artist's public Spotify URL.)
create or replace function public.get_public_site(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (
    select id, slug, name, bio, hero_image_url, template, spotify_artist_id
    from public.artists
    where slug = p_slug
  ),
  latest as (
    select distinct on (r.entity_type, r.entity_id)
      r.entity_type, r.entity_id, r.data, r.published_at
    from public.revisions r
    join a on a.id = r.artist_id
    order by r.entity_type, r.entity_id, r.published_at desc
  ),
  live as (
    select entity_type, data, published_at
    from latest
    where coalesce(data ->> '_deleted', 'false') <> 'true'
  )
  select case
    when not exists (select 1 from a) then null
    else jsonb_build_object(
      'artist',     (select to_jsonb(a) from a),
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
        from live where entity_type = 'link'), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;
