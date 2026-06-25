-- Phase 3: gated audio. Hosted track audio that fans can PLAY but not freely
-- download. The file lives in a PRIVATE bucket (no public read); the player gets
-- a short-lived signed URL only for a PUBLISHED track, minted server-side from a
-- path the DB vouches for — the caller never supplies a path/artist_id.

-- 1. Private bucket (public=false is the whole point — a public bucket would be a
--    total bypass). Path: {artist_id}/audio/<file>.
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

-- 2. Storage policies: managers may write their own folder; NO public read, so the
--    raw object is never anon-reachable (signing is the only way in).
drop policy if exists "audio manager insert" on storage.objects;
create policy "audio manager insert" on storage.objects
  for insert with check (
    bucket_id = 'audio'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "audio manager update" on storage.objects;
create policy "audio manager update" on storage.objects
  for update using (
    bucket_id = 'audio'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "audio manager delete" on storage.objects;
create policy "audio manager delete" on storage.objects
  for delete using (
    bucket_id = 'audio'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

-- 3. The audio file path on a track (private-bucket path; a random filename so
--    exposing the path leaks nothing). Published like any track field.
alter table public.tracks add column audio_path text;

-- 4. The signing DOOR (Shopify-Vault pattern): resolve artist from the slug and
--    return the audio path of the track's LATEST PUBLISHED revision — null if
--    unpublished, tombstoned, audio-less, or not this artist's track. The caller
--    passes only (slug, track_id); track UUIDs aren't secret, so the
--    published-only check is the real gate. The route signs the returned path.
create or replace function public.audio_path_for_play(p_slug text, p_track_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select r.data ->> 'audio_path'
  from public.revisions r
  join public.artists a on a.id = r.artist_id
  where a.slug = p_slug
    and r.entity_type = 'track'
    and r.entity_id = p_track_id
  order by r.published_at desc, r.id desc
  limit 1
$$;

revoke all on function public.audio_path_for_play(text, uuid) from public;
grant execute on function public.audio_path_for_play(text, uuid) to anon, authenticated;
