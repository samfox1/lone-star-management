-- FIX: get_release lost its on-site gate, leaking off-site releases.
--
-- 20260706180000_release_visibility.sql gated the public smart-link page on the
-- manager's toggle:
--     join public.releases r on r.id = (pr.data ->> 'id')::uuid
--     where pr.data ->> 'slug' = p_release_slug and r.visible
--
-- 20260709120000_public_music_released_only.sql rewrote get_release to add the
-- Released/Unreleased provenance check and drop the album_name tracklist
-- fallback — and dropped the `visible` join along with it. That migration's
-- header only claims the album_name change, so the loss looks accidental.
--
-- Effect: toggling a release OFF-site removed it from the discography
-- (get_public_releases still checks r.visible) while its page at
-- /[slug]/r/[release] kept serving to anyone holding the URL. The manager saw it
-- disappear from the site and had no way to know the page was still up.
--
-- Released and on-site are INDEPENDENT gates; a release needs BOTH to be public:
--   Released — provenance, derived from the published snapshot
--              (music_release_is_released)
--   on-site  — the manager's live toggle, read from the working row
--              (releases.visible)
--
-- LEFT JOIN + coalesce(r.visible, true), NOT the original INNER JOIN: per the
-- convention 20260707200000 set for get_public_site, an INNER JOIN drops a
-- published item the instant its working row is deleted — before the
-- tombstone/publish flow — silently unpublishing live content. The published
-- snapshot stays authoritative until a real publish tombstones it, while a live
-- visible=false still hides. Everything else is unchanged from 20260709120000.
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
    left join public.releases r on r.id = (pr.data ->> 'id')::uuid
    where pr.data ->> 'slug' = p_release_slug
      and public.music_release_is_released(pr.data)
      and coalesce(r.visible, true)
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

-- Re-assert grants (create or replace keeps them, but be explicit — house style).
revoke all on function public.get_release(text, text) from public;
grant execute on function public.get_release(text, text) to anon, authenticated;
