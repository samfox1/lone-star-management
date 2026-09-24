-- Primary and Secondary colours (BRAND_PAGE_PLAN.md, Colors), 2026-09-24.
--
-- Sam, 2026-09-23 later: "Primary and secondary colors should be default on the colors page,
-- they just dont have to be filled in yet." The Colors tab now opens on two BUILT-IN rows,
-- Primary and Secondary, then the added palette ("Color 3", …).
--
-- A built-in is a brand_colors row with a SLOT. Empty means NO ROW: the page draws the two
-- rows from its own list, and the first pick writes the row (lib/brand-colors.ts
-- `setSlotColor`, one upsert on (artist_id, slot)); every later pick updates it.
--
-- PURELY ADDITIVE: one nullable column (every existing colour reads slot = null, an added
-- colour, exactly what it was), three constraints no existing row can violate, and the cap
-- trigger taught not to count the row an upsert is about to replace.
--
-- NO grant, RLS or door changes, on purpose:
--   * brand_colors_rw (20260924120000) already scopes every verb to is_admin() or
--     is_manager_of(artist_id); a slotted row is an ordinary row to it.
--   * The table grants from 20260924120000 (anon: nothing; authenticated: select/insert/
--     update/delete; service_role: all) are table-wide and cover the new column. An upsert
--     is INSERT + UPDATE, both already granted.
--   * No new function. enforce_brand_color_cap is REPLACED, which keeps its owner and its
--     ACL; the revoke is restated anyway so this file alone says who can run it.
--   * Still dashboard-only: not a revisions entity type, not in get_public_site.

-- ---------------------------------------------------------------------------
-- 1. The slot
-- ---------------------------------------------------------------------------
alter table public.brand_colors add column if not exists slot text;

-- Only the two built-ins. (NULL = an added colour; `null in (…)` is NULL, which a CHECK passes.)
alter table public.brand_colors drop constraint if exists brand_colors_slot_known;
alter table public.brand_colors add constraint brand_colors_slot_known
  check (slot in ('primary', 'secondary'));

-- One Primary and one Secondary per artist. A plain UNIQUE, not a partial index: PostgREST's
-- upsert names its conflict target by columns (on_conflict=artist_id,slot), and
-- ON CONFLICT (artist_id, slot) can only infer a NON-partial unique index. Added colours all
-- have slot NULL, and NULLs never collide (NULLS DISTINCT, the default), so the palette
-- itself is unconstrained.
alter table public.brand_colors drop constraint if exists brand_colors_slot_once;
alter table public.brand_colors add constraint brand_colors_slot_once unique (artist_id, slot);

-- A built-in's title is FIXED and it has no note (the page shows fixed guide text instead),
-- in the database, so no writer — the copilot, a script, a stale tab renaming "Primary" —
-- can make the row say something the page would then show as the built-in.
alter table public.brand_colors drop constraint if exists brand_colors_slot_fixed;
alter table public.brand_colors add constraint brand_colors_slot_fixed check (
  slot is null
  or (note is null
      and name = case slot when 'primary' then 'Primary' when 'secondary' then 'Secondary' end)
);

-- ---------------------------------------------------------------------------
-- 2. The cap still counts the built-ins — but not the row an upsert replaces
-- ---------------------------------------------------------------------------
-- 24 per artist, Primary and Secondary included (the page keeps room for them: it stops
-- offering "+ Add color" at 22 added). An upsert of Primary fires BEFORE INSERT with a
-- fresh id even when it will end as an UPDATE of the row already holding 'primary' (Postgres
-- runs BEFORE INSERT triggers before it looks for the conflict). Counting that row would
-- refuse re-picking Primary on a full palette. It is not counted: the incoming row either
-- replaces it (the upsert) or collides with brand_colors_slot_once (a plain insert), so the
-- total never grows by it. Same lock-then-count shape as before.
create or replace function public.enforce_brand_color_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap constant int := 24;
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('brand_colors:' || new.artist_id::text));
  select count(*) into n
    from public.brand_colors c
   where c.artist_id = new.artist_id
     and c.id is distinct from new.id
     and (new.slot is null or c.slot is distinct from new.slot);
  if n >= cap then
    raise exception 'brand color cap reached: at most % colors per artist', cap
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- As in 20260924120000 (`public, anon` only): it fires on a MANAGER's insert, and a trigger
-- function is not callable through PostgREST whatever its grant.
revoke all on function public.enforce_brand_color_cap() from public, anon;
