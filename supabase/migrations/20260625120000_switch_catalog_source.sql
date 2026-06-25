-- Atomic catalog-source switch: delete the OLD importer's tracks + set the new
-- source in ONE transaction, so a failure can't leave tracks deleted with the
-- source unchanged (the non-atomic two-statement version could). SECURITY
-- INVOKER → RLS applies: a non-owner's SELECT finds no row, so it raises
-- 'artist not found' and touches nothing (tenant isolation, no service bypass).
create or replace function public.switch_catalog_source(p_artist_id uuid, p_next text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  cur text;
begin
  select catalog_source into cur from public.artists where id = p_artist_id;
  if cur is null then
    raise exception 'artist not found';
  end if;
  if cur = p_next then
    return;
  end if;
  -- Manual tracks are never touched; only a previous importer's set is replaced.
  if cur in ('spotify', 'apple', 'deezer') then
    delete from public.tracks where artist_id = p_artist_id and source = cur;
  end if;
  update public.artists set catalog_source = p_next where id = p_artist_id;
end;
$$;

revoke all on function public.switch_catalog_source(uuid, text) from public, anon;
grant execute on function public.switch_catalog_source(uuid, text) to authenticated;
