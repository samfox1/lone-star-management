-- EPK support: the artist's PUBLISHED releases as a list (for the press-kit
-- discography). Public-safe by the snapshot allowlist; grant anon.
create or replace function public.get_public_releases(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (
    select id from public.artists where slug = p_slug
  ),
  latest as (
    select distinct on (r.entity_id) r.data, r.published_at
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type = 'release'
    order by r.entity_id, r.published_at desc, r.id desc
  )
  select coalesce(
    jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at),
    '[]'::jsonb)
  from latest
  where coalesce(data ->> '_deleted', 'false') <> 'true';
$$;

revoke all on function public.get_public_releases(text) from public;
grant execute on function public.get_public_releases(text) to anon, authenticated;
