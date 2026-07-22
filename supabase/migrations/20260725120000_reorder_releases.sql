-- Let the editor reorder RELEASES (Sam, 2026-07-21).
--
-- The editor's Music panel listed every individual song, which is the wrong unit: the
-- site renders PROJECTS (album / EP / single), and a manager arranging their music
-- thinks in projects, not in the 12 tracks inside one of them. The panel now lists
-- releases, and arranging them needs the same atomic renumber the other draggable lists
-- use.
--
-- `releases.sort_order` already exists and already drives `PUBLISHABLE.release.orderBy`
-- (['sort_order','created_at']), so nothing about ordering semantics changes here — the
-- column simply becomes writable through the RPC instead of only by the Music page.
--
-- Reproduced verbatim from 20260723120000 with 'releases' added to the whitelist and
-- nothing else changed. SECURITY INVOKER, so RLS still scopes every write to the
-- caller's own artist; the whitelist and the artist_id filter are belt-and-braces.
create or replace function public.reorder_rows(p_table text, p_artist uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_table not in ('media', 'links', 'videos', 'tracks', 'tour_dates', 'releases') then
    raise exception 'reorder_rows: table % not allowed', p_table;
  end if;
  execute format(
    'update %I t set sort_order = v.ord - 1
       from unnest($1) with ordinality as v(id, ord)
      where t.id = v.id and t.artist_id = $2',
    p_table
  ) using p_ids, p_artist;
end;
$$;

grant execute on function public.reorder_rows(text, uuid, uuid[]) to authenticated;
