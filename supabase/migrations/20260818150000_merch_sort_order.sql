-- Manual ordering for merch (Sam, 2026-08-18: "add the same dragging to reorder to
-- merchandise"). Merch was the last grid with no sort_order — rows rendered in
-- created_at order everywhere and the editor's new cover grid had nothing to drag by.
--
-- Rides `PUBLISHABLE.merch.snapshot` + orderBy to the public door with no
-- get_public_site change (the merch branch serves each revision's `data` wholesale) —
-- the same seam tour_dates.sort_order used (20260723120000).

alter table public.merch add column if not exists sort_order integer;

-- Backfill deterministically so nothing appears to shuffle at the cutover: number every
-- row per artist by the order it was created — exactly the order everything renders in
-- today.
with ordered as (
  select id, row_number() over (partition by artist_id order by created_at, id) - 1 as ord
  from public.merch
)
update public.merch m
set sort_order = ordered.ord
from ordered
where m.id = ordered.id and m.sort_order is null;

-- Let the atomic reorder RPC renumber this table. RLS still scopes the write to the
-- caller's own artist (SECURITY INVOKER).
create or replace function public.reorder_rows(p_table text, p_artist uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_table not in ('media', 'links', 'videos', 'tracks', 'tour_dates', 'releases', 'merch') then
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
