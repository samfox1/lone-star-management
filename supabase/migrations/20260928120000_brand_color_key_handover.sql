-- Brand colours: a deleted colour hands its key to its namesake (Sam, 2026-09-28).
--
-- A colour's `key` is what a site's stylesheet reads (`--brand-cream`), so it never changes
-- (20260925120000). That left one trap: add a new "Cream" while the old one still exists and
-- the new one is keyed `cream-2` (`cream` is taken); delete the old one and publish, and the
-- site's `--brand-cream` points at nothing, so it quietly falls back to its own cream while
-- the Brand page shows a Cream.
--
-- Now, when an ADDED colour is deleted, its key passes to a colour of the same artist whose
-- current NAME slugs to that key — the oldest, if several — but only one that has NEVER been
-- published. A key the site already reads never moves; a draft's key the site has never seen
-- is free to. Built-ins are keyed by their slot and are never part of this.
--
-- The handover is the ONLY way a key changes. `brand_color_key()` still refuses every other
-- key update, service role included; it lets this one through on a transaction-local flag
-- that only the handover trigger sets. PostgREST exposes no way to call `set_config`, so no
-- client can raise the flag. The format, slot and unique checks still judge the new key.
--
-- Revert (restoreBrandToPublished) deletes draft rows before it re-inserts published ones,
-- so an heir that took `cream` is gone before the published Cream comes back under it.

create or replace function public.brand_color_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  n int := 1;
begin
  if tg_op = 'UPDATE' then
    if new.key is distinct from old.key then
      -- The handover (brand_color_key_handover, below) and nothing else.
      if coalesce(current_setting('lone_star.brand_key_handover', true), '') = 'on' then
        return new;
      end if;
      raise exception 'a brand color''s key cannot change (% → %); rename the color instead', old.key, new.key
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.slot is not null then
    new.key := new.slot;
    return new;
  end if;
  if new.key is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('brand_colors:' || new.artist_id::text));
  base := public.brand_color_slug(new.name);
  candidate := base;
  while candidate in ('primary', 'secondary')
     or exists (select 1 from public.brand_colors c where c.artist_id = new.artist_id and c.key = candidate)
  loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  new.key := candidate;
  return new;
end;
$$;

create or replace function public.brand_color_key_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  heir uuid;
begin
  if old.slot is not null then
    return null;
  end if;

  -- The same per-artist lock the insert path takes, so a concurrent "Cream" cannot be
  -- keyed into the gap while the key is being handed over.
  perform pg_advisory_xact_lock(hashtext('brand_colors:' || old.artist_id::text));

  select c.id into heir
    from public.brand_colors c
   where c.artist_id = old.artist_id
     and c.slot is null
     and public.brand_color_slug(c.name) = old.key
     and not exists (
       select 1 from public.revisions r
        where r.artist_id = c.artist_id
          and r.entity_type = 'brand_color'
          and r.entity_id = c.id)
   order by c.created_at, c.id
   limit 1;

  if heir is null then
    return null;
  end if;

  perform set_config('lone_star.brand_key_handover', 'on', true);
  update public.brand_colors set key = old.key where id = heir;
  perform set_config('lone_star.brand_key_handover', '', true);
  return null;
end;
$$;

drop trigger if exists brand_colors_key_handover on public.brand_colors;
create trigger brand_colors_key_handover
  after delete on public.brand_colors
  for each row execute function public.brand_color_key_handover();

-- Trigger functions: not callable through PostgREST whatever the grant, but revoked from
-- `public, anon` as for brand_color_key (it fires on a MANAGER's delete).
revoke all on function public.brand_color_key_handover() from public, anon;
