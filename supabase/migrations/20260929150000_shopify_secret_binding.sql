-- SHOPIFY'S VAULT SECRET, TIED TO ITS ARTIST (security review, 2026-09-29; revised the same
-- day after an independent review of this file, see "REVISION" below).
--
-- ── AT PUSH TIME, IN THIS ORDER ─────────────────────────────────────────────────────────
--   1. READ-ONLY pre-check, in the SQL editor. The reviewer's query catches a second pointer in
--      another CASE; this one also catches braces and missing hyphens (every spelling Postgres
--      reads as the same uuid; checked on a local copy, 2026-09-29):
--        select regexp_replace(lower(secret_ref), '[^0-9a-f]', '', 'g') as secret, count(*),
--               array_agg(artist_id || ':' || provider) as rows
--        from public.integrations where secret_ref is not null group by 1 having count(*) > 1;
--      Zero rows: the backfill below cannot misfire on this push. Any row: two integrations
--      rows reach the same secret, which only the old hole makes. The backfill leaves such a
--      secret UNBOUND (both rows then read nothing and their owners reconnect); look at who
--      they are before pushing.
--   2. Vault version, informational: select extversion from pg_extension where extname = 'supabase_vault';
--      This migration never updates a secret (the binding lives in its own table, never in
--      the secret's description), so an older pgsodium Vault cannot corrupt a token here.
--   3. Test on ONE throwaway secret first, in the SQL editor:
--        select vault.create_secret('tapir-throwaway-check');   -- note the id it returns
--        select decrypted_secret from vault.decrypted_secrets where id = '<that id>';
--        delete from vault.secrets where id = '<that id>';
--      The value must read back exactly. (create / read / delete is all the functions below
--      do, plus update_secret(id, token) on a reconnect, which is unchanged since 20260624.)
--   4. Push (with 20260929120500 and 20260929140000). Then `npm run audit:grants`.
--   5. Run, against throwaway artists only: tests/integration/shopify/shopify-secret-binding.test.ts,
--      tests/integration/sync/integrations.test.ts, tests/integration/sync/eventbrite-vault.test.ts,
--      tests/integration/shopify/merch-live-door.test.ts, tests/integration/auth/public-read.isolation.test.ts.
--   6. Who must reconnect (read-only):
--        select i.artist_id from public.integrations i where i.provider = 'shopify'
--          and not exists (select 1 from public.shopify_secret_bindings b
--                          where b.artist_id = i.artist_id and b.secret_id = public.uuid_or_null(i.secret_ref));
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────────────────
-- `integrations_rw` (20260623162707) is FOR ALL to a manager, and stock Supabase grants
-- `authenticated` every privilege on every public table (nothing ever revoked them here). So a
-- manager could set their OWN integrations row's `secret_ref` to any Vault secret id, and
-- Shopify's SECURITY DEFINER functions (20260624120000, 20260902130000) acted on whatever the
-- pointer named, with no check that the secret was theirs:
--
--   shopify_credentials(own artist)   → the DECRYPTED token of that secret, to the manager
--   connect_shopify(own artist, …)    → vault.update_secret on it: the victim's token overwritten
--   disconnect_shopify(own artist)    → deletes it: the victim's connection destroyed
--   shopify_store_for_slug(own slug)  → hands it to the merch live lane
--
-- The precondition is knowing the victim secret's uuid. It is random, but stable across
-- reconnects (connect updates in place), so anyone who ever read the row keeps it: a removed
-- co-manager, a log, a screenshot. And Shopify's reader decrypted ANY secret, so it also undid
-- Eventbrite's binding (20260929120500): a Shopify row pointed at an Eventbrite secret read it.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────────────────
--   1. Managers only READ integrations. `anon` and `authenticated` lose every privilege but
--      SELECT, and the FOR ALL policy becomes a SELECT policy. Connect and Remove go through
--      the definer functions; the Shopify uninstall webhook deletes with the service role. No
--      app code writes this table as a manager (checked 2026-09-29). DELETE goes too: a
--      manager deleting their own row orphaned a live token in Vault with no pointer left
--      (for Eventbrite, a whole-account token that never expires).
--
--   2. Every Shopify function checks the secret is BOUND to that artist before it reads,
--      renews or deletes it. The binding is a row in `shopify_secret_bindings`, written only
--      by these definer functions, never by a manager. A pointer to anything else reads
--      nothing and deletes nothing; a connect through it makes a fresh bound secret and
--      repoints the row, leaving the named secret exactly as it was.
--
--   3. Existing secrets are bound once, by `bind_legacy_shopify_secrets()` at the bottom.
--
-- ── REVISION (independent review, same day) ─────────────────────────────────────────────
--   F1. The first backfill counted "rows pointing at this secret" with a case-sensitive TEXT
--       compare but found the secret with a case-insensitive uuid cast: `8a84…` and `8A84…`
--       are two strings and one secret. An attacker who had repointed their row (UPPER CASE)
--       before the push could be bound to the victim's token, and the victim locked out.
--       Now every pointer is cast to a uuid first (any casing, any spelling Postgres accepts),
--       and a secret more than one row reaches is never bound.
--   F6. The first version bound a secret by writing its Vault DESCRIPTION. On an older
--       pgsodium Vault the description is part of the encryption's associated data, so a
--       description-only update could corrupt the token. The binding now lives outside the
--       secret, in its own table; no existing secret is updated by this migration.
--   L1. DELETE revoked too (see 1).
--
-- Function grants are restated as before (audit:grants: none is anon-executable).

create extension if not exists supabase_vault with schema vault;

-- ── 1. Managers only read integrations ─────────────────────────────────────────────────

revoke all on table public.integrations from anon, authenticated;
grant select on table public.integrations to authenticated;

drop policy if exists integrations_rw on public.integrations;
drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations
  for select using (public.is_admin() or public.is_manager_of(artist_id));

-- ── 2. The binding, outside the secret ─────────────────────────────────────────────────

-- One secret, one artist. Written only by the definer functions below (no grant to anon or
-- authenticated; RLS on with no policy, so even a future grant reads nothing).
create table if not exists public.shopify_secret_bindings (
  secret_id  uuid primary key,
  artist_id  uuid not null references public.artists (id) on delete cascade,
  bound_at   timestamptz not null default now()
);
create index if not exists shopify_secret_bindings_artist_idx on public.shopify_secret_bindings (artist_id);
alter table public.shopify_secret_bindings enable row level security;
revoke all on table public.shopify_secret_bindings from public, anon, authenticated;

-- A pointer as a uuid, or null when it is not one. Every spelling Postgres accepts (any case,
-- braces, no hyphens) is the SAME secret, so pointers are compared as uuids, never as text.
create or replace function public.uuid_or_null(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;
revoke all on function public.uuid_or_null(text) from public, anon, authenticated;

create or replace function public.connect_shopify(
  p_artist_id uuid,
  p_domain text,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id  uuid;
  v_new uuid;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  -- Guard of record for the storefront host (20260624120000 #1).
  if p_domain is null or p_domain !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' then
    raise exception 'invalid shopify domain: %', p_domain
      using hint = 'expected a bare {store}.myshopify.com host';
  end if;

  perform pg_advisory_xact_lock(hashtext('connect_shopify:' || p_artist_id::text));

  select public.uuid_or_null(i.secret_ref) into v_id
  from public.integrations i
  where i.artist_id = p_artist_id and i.provider = 'shopify';

  -- Renew in place only a secret that exists AND is bound to this artist. Anything else
  -- (none, orphaned, unbound, someone else's) gets a fresh bound secret and the pointer
  -- overwritten; the secret the old pointer named is left exactly as it was.
  if v_id is not null
     and exists (select 1 from public.shopify_secret_bindings b where b.secret_id = v_id and b.artist_id = p_artist_id)
     and exists (select 1 from vault.secrets s where s.id = v_id) then
    perform vault.update_secret(v_id, p_token);
    update public.integrations
       set metadata = jsonb_build_object('store_domain', p_domain)
     where artist_id = p_artist_id and provider = 'shopify';
  else
    -- A binding of this artist's whose secret is gone is dead weight.
    if v_id is not null then
      delete from public.shopify_secret_bindings b
       where b.secret_id = v_id and b.artist_id = p_artist_id
         and not exists (select 1 from vault.secrets s where s.id = v_id);
    end if;
    v_new := vault.create_secret(p_token);
    insert into public.shopify_secret_bindings (secret_id, artist_id) values (v_new, p_artist_id);
    insert into public.integrations (artist_id, provider, secret_ref, metadata)
    values (p_artist_id, 'shopify', v_new::text, jsonb_build_object('store_domain', p_domain))
    on conflict (artist_id, provider) do update
      set secret_ref = excluded.secret_ref,
          metadata   = excluded.metadata;
  end if;
end;
$$;

create or replace function public.shopify_credentials(p_artist_id uuid)
returns table(store_domain text, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_domain text;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  select public.uuid_or_null(i.secret_ref), i.metadata->>'store_domain'
    into v_id, v_domain
  from public.integrations i
  where i.artist_id = p_artist_id and i.provider = 'shopify';

  if v_id is null then
    return;
  end if;

  return query
    select v_domain, ds.decrypted_secret
    from vault.decrypted_secrets ds
    join public.shopify_secret_bindings b on b.secret_id = ds.id and b.artist_id = p_artist_id
    where ds.id = v_id;
end;
$$;

create or replace function public.disconnect_shopify(p_artist_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  select public.uuid_or_null(i.secret_ref) into v_id
  from public.integrations i
  where i.artist_id = p_artist_id and i.provider = 'shopify';

  -- The secret FIRST (20260624120000 #3), and only one bound to this artist.
  if v_id is not null
     and exists (select 1 from public.shopify_secret_bindings b where b.secret_id = v_id and b.artist_id = p_artist_id) then
    delete from vault.secrets where id = v_id;
    delete from public.shopify_secret_bindings where secret_id = v_id;
  end if;

  delete from public.integrations
   where artist_id = p_artist_id and provider = 'shopify';
end;
$$;

-- The live lane's door (20260902130000), unchanged but for the binding check.
create or replace function public.shopify_store_for_slug(p_slug text)
returns table(store_domain text, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_id     uuid;
  v_domain text;
begin
  select id into v_artist from public.artists where slug = p_slug;
  if v_artist is null then
    return;
  end if;

  if not exists (select 1 from public.published_revisions(v_artist, 'merch')) then
    return;
  end if;

  select public.uuid_or_null(i.secret_ref), i.metadata->>'store_domain'
    into v_id, v_domain
  from public.integrations i
  where i.artist_id = v_artist and i.provider = 'shopify';

  if v_id is null then
    return;
  end if;

  return query
    select v_domain, ds.decrypted_secret
    from vault.decrypted_secrets ds
    join public.shopify_secret_bindings b on b.secret_id = ds.id and b.artist_id = v_artist
    where ds.id = v_id;
end;
$$;

revoke all on function public.connect_shopify(uuid, text, text) from public, anon;
revoke all on function public.shopify_credentials(uuid) from public, anon;
revoke all on function public.disconnect_shopify(uuid) from public, anon;
grant execute on function public.connect_shopify(uuid, text, text) to authenticated;
grant execute on function public.shopify_credentials(uuid) to authenticated;
grant execute on function public.disconnect_shopify(uuid) to authenticated;
revoke all on function public.shopify_store_for_slug(text) from public, anon, authenticated;
grant execute on function public.shopify_store_for_slug(text) to service_role;

-- ── 3. Bind the secrets that already exist ─────────────────────────────────────────────

-- Binds each existing Shopify secret to the one artist whose row points at it, and nothing
-- else. A secret is bound only when ALL hold:
--   - exactly ONE integrations row, of any provider, reaches it (pointers compared as uuids,
--     so a second row in another casing or spelling counts: F1);
--   - that row is a Shopify row;
--   - the secret exists and looks like one the old connect_shopify made (no name, no
--     description), so an app secret or an Eventbrite secret (described 'eventbrite:<id>')
--     is never handed to a Shopify row;
--   - it is not bound already.
-- Reads Vault, never writes it (F6). Idempotent. Service role only: it runs once below, and
-- the integration test runs it again on throwaway artists.
create or replace function public.bind_legacy_shopify_secrets()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bound integer;
begin
  with refs as (
    select i.artist_id, i.provider, public.uuid_or_null(i.secret_ref) as secret
    from public.integrations i
    where i.secret_ref is not null
  ),
  reach as (
    select r.secret, count(*) as n
    from refs r
    where r.secret is not null
    group by r.secret
  )
  insert into public.shopify_secret_bindings (secret_id, artist_id)
  select r.secret, r.artist_id
  from refs r
  join reach c on c.secret = r.secret and c.n = 1
  where r.provider = 'shopify'
    and exists (
      select 1 from vault.secrets s
      where s.id = r.secret and s.name is null and coalesce(s.description, '') = ''
    )
    and not exists (select 1 from public.shopify_secret_bindings b where b.secret_id = r.secret)
  on conflict (secret_id) do nothing;
  get diagnostics v_bound = row_count;
  return v_bound;
end;
$$;
revoke all on function public.bind_legacy_shopify_secrets() from public, anon, authenticated;
grant execute on function public.bind_legacy_shopify_secrets() to service_role;

select public.bind_legacy_shopify_secrets();
