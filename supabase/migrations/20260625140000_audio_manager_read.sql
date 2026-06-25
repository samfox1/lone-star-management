-- Managers can READ their own audio folder (Storage upsert needs a SELECT to
-- check existence, and the dashboard needs to list/manage files). Anon still has
-- NO read on the private `audio` bucket, so the raw object stays unreachable to
-- fans — the gated property holds; signing remains the only public way in.
drop policy if exists "audio manager read" on storage.objects;
create policy "audio manager read" on storage.objects
  for select using (
    bucket_id = 'audio'
    and (public.is_admin() or public.is_manager_of(((storage.foldername(name))[1])::uuid))
  );

-- Drop the temporary introspection helpers used while debugging the policy.
drop function if exists public._tmp_audio_policies();
drop function if exists public._tmp_pol2();
drop function if exists public._tmp_check(text);
drop function if exists public._tmp_allins();
