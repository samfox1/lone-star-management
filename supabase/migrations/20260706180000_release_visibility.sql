-- Release visibility + Spotify import support.
--   visible    — a live "show on the site" toggle (NOT part of the draft/publish
--                flow, so flipping it takes effect instantly). Defaults true so
--                existing/manual releases stay live; Spotify-imported releases are
--                inserted false and the manager toggles them on.
--   spotify_id — the Spotify album id, the stable dedup key for re-imports
--                (refresh). Unique per artist when set.
alter table public.releases add column if not exists visible boolean not null default true;
alter table public.releases add column if not exists spotify_id text;

create unique index if not exists releases_artist_spotify_idx
  on public.releases (artist_id, spotify_id)
  where spotify_id is not null;

-- Public doors now gate on the LIVE `visible` flag (joined to the published
-- snapshot by id), so a manager toggling visibility shows/hides a release
-- instantly without republishing. Content (title/cover/links/tracks) still comes
-- from the published revision — only exposure is the live toggle.

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
      filter (where r.visible),
    '[]'::jsonb)
  from public.published_revisions((select id from a), 'release') pr
  join public.releases r on r.id = (pr.data ->> 'id')::uuid
$$;

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
    join public.releases r on r.id = (pr.data ->> 'id')::uuid
    where pr.data ->> 'slug' = p_release_slug
      and r.visible
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
      where (t.data ->> 'release_id' = rel.data ->> 'id')
         or (coalesce(t.data ->> 'release_id', '') = ''
             and nullif(t.data ->> 'album_name', '') is not null
             and lower(t.data ->> 'album_name') = lower(rel.data ->> 'title'))
    ), '[]'::jsonb)
  )
  from rel
$$;

revoke all on function public.get_public_releases(text) from public;
revoke all on function public.get_release(text, text) from public;
grant execute on function public.get_public_releases(text) to anon, authenticated;
grant execute on function public.get_release(text, text) to anon, authenticated;
