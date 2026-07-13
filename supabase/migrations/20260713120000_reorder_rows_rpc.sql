-- Atomic reorder for the visual editor (review finding #3).
--
-- The editor persisted a new order by writing sort_order row-by-row in a client loop;
-- a mid-loop failure left the table half-renumbered with no rollback. This RPC does the
-- whole renumber in ONE statement (one transaction) so it's all-or-nothing.
--
-- SECURITY INVOKER: the caller's RLS on the target table still applies, so a manager can
-- only reorder their own artist's rows. A table whitelist + `artist_id` filter are
-- belt-and-suspenders. `p_ids` is the rows in their new order; each row's sort_order
-- becomes its 0-based index (unlisted rows are untouched).
create or replace function public.reorder_rows(p_table text, p_artist uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_table not in ('media', 'links', 'videos', 'tracks') then
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
