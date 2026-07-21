-- Manual ordering for UNDATED tour dates (Sam, 2026-07-21).
--
-- Tour dates sort by `date` everywhere, which works right up until a show has no date:
-- skeen's mapSite puts every undated show after the dated ones in whatever order the
-- payload happened to arrive in, and the manager has no way to sequence them. Most of
-- skeen's current shows are undated, so that list is effectively unordered.
--
-- `sort_order` is a TIE-BREAKER, not a replacement. Dated shows keep sorting themselves
-- chronologically forever (upcoming ascending, past descending) with no upkeep as dates
-- pass; sort_order only decides the order WITHIN the undated group. That's why the
-- editor only offers a drag handle on undated rows.
--
-- Rides `PUBLISHABLE.tour_date.snapshot` to the public door with no get_public_site
-- change: the tour_dates branch serves each revision's `data` wholesale (unlike the
-- media branch, which cherry-picks columns), so the column reaches skeen the moment it
-- is listed in the snapshot. Same seam the `support_urls` map used (20260717140000).

alter table public.tour_dates add column if not exists sort_order integer;

-- Backfill deterministically so nothing appears to shuffle at the cutover: number every
-- row per artist by the order it was created. Dated rows get a value too (harmless — it
-- is never consulted while `date` is set) so a date being cleared later still lands the
-- row somewhere stable instead of at a null.
with ordered as (
  select id, row_number() over (partition by artist_id order by created_at, id) - 1 as ord
  from public.tour_dates
)
update public.tour_dates t
set sort_order = ordered.ord
from ordered
where t.id = ordered.id and t.sort_order is null;

-- Let the atomic reorder RPC renumber this table. The whitelist is the only thing
-- standing between reorderContentAction and tour_dates; RLS still scopes the write to
-- the caller's own artist (the function is SECURITY INVOKER).
create or replace function public.reorder_rows(p_table text, p_artist uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_table not in ('media', 'links', 'videos', 'tracks', 'tour_dates') then
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
