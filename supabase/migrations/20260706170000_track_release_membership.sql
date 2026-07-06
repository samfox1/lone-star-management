-- Explicit track → release membership. A track belongs to at most one release
-- (album/EP/single); `release_id` is the umbrella link, replacing the album_name
-- string-match heuristic as the source of truth for a release's tracklist.
-- Nullable (a track can be unassigned); ON DELETE SET NULL so deleting a release
-- unlinks its tracks rather than deleting them.

alter table public.tracks
  add column if not exists release_id uuid references public.releases (id) on delete set null;

create index if not exists tracks_release_idx on public.tracks (release_id);

-- One-time best-effort backfill: link existing tracks to a release whose title
-- matches their Spotify album_name. Makes the prior heuristic explicit.
update public.tracks t
set release_id = r.id
from public.releases r
where t.release_id is null
  and nullif(btrim(t.album_name), '') is not null
  and r.artist_id = t.artist_id
  and lower(r.title) = lower(t.album_name);

-- get_release: a release's tracklist is now its EXPLICITLY assigned tracks
-- (release_id = the release id in the published snapshot), with the album_name
-- match kept as a fallback ONLY for unassigned tracks — so an explicit
-- assignment always wins, but synced tracks that match by album and haven't been
-- assigned yet still appear (and legacy published data keeps working).
-- Projection is unchanged: audio_path stripped → has_audio.
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

revoke all on function public.get_release(text, text) from public;
grant execute on function public.get_release(text, text) to anon, authenticated;
