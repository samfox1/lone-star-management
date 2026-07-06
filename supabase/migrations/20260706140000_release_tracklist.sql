-- Release smart-link tracklist. `get_release` now returns the release's tracks
-- alongside its DSP links, matched by the track's Spotify `album_name` to the
-- release title (case-insensitive; empty album_name never matches). Tracks are
-- projected exactly like get_public_site — `audio_path` stripped, `has_audio`
-- added — so the public page can render a gated play button without the raw path
-- ever leaving the server. Additive: the release JSON gains a `tracks` array;
-- callers that ignore it are unaffected, and a release with no matching tracks
-- gets `[]`. Still returns NULL when the release slug isn't found (notFound gate).

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
      where nullif(t.data ->> 'album_name', '') is not null
        and lower(t.data ->> 'album_name') = lower(rel.data ->> 'title')
    ), '[]'::jsonb)
  )
  from rel
$$;

revoke all on function public.get_release(text, text) from public;
grant execute on function public.get_release(text, text) to anon, authenticated;
