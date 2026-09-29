-- SHOPIFY'S VAULT SECRET, TIED TO ITS ARTIST (security review, 2026-09-29).
--
-- THE HOLE. `integrations_rw` (20260623162707) is FOR ALL to a manager, and stock Supabase
-- grants `authenticated` INSERT and UPDATE on every public table (nothing ever revoked them
-- here). So a manager could set their OWN integrations row's `secret_ref` to any Vault secret
-- id, and Shopify's SECURITY DEFINER functions (20260624120000, 20260902130000) act on
-- whatever the pointer names, with no check that the secret is theirs:
--
--   shopify_credentials(own artist)   → the DECRYPTED token of that secret, to the manager
--   connect_shopify(own artist, …)    → vault.update_secret on it: the victim's token overwritten
--   disconnect_shopify(own artist)    → deletes it: the victim's connection destroyed
--   shopify_store_for_slug(own slug)  → hands it to the merch live lane
--
-- The precondition is knowing the victim secret's uuid. It is random, but it is stable across
-- reconnects (connect updates in place), so anyone who ever read the row keeps it: a removed
-- co-manager, a log, a screenshot. And Shopify's reader decrypts ANY secret, so it also undid
-- Eventbrite's binding (20260929120500): a Shopify row pointed at an Eventbrite secret read it.
--
-- THE FIX, in two layers (either alone closes the reads; both, because each covers a
-- mistake in the other):
--
--   1. The pointer is written only by the definer functions. `authenticated` and `anon` lose
--      INSERT and UPDATE on public.integrations. No app code writes the table as a manager:
--      connects go through connect_shopify / connect_eventbrite, and the Shopify uninstall
--      webhook deletes with the service role. SELECT and DELETE (own rows, by RLS) stay.
--
--   2. Every Shopify function checks the secret is BOUND to that artist before it reads,
--      renews or deletes it: Eventbrite's pattern, description 'shopify:<artist_id>', set
--      only by these definer functions. A pointer to anything else reads nothing and deletes
--      nothing, and a connect through it writes a fresh bound secret and repoints the row.
--
--   3. Existing secrets are bound once, below: each one that is unbound AND pointed at by
--      exactly ONE integrations row, which must be a Shopify row. A secret two rows point at
--      (a repoint already happened) is left unbound: both rows read nothing until their
--      owner reconnects. Fail closed, never guess the owner.
--
-- Grants on the functions are restated exactly as before (audit:grants: none is anon).

create extension if not exists supabase_vault with schema vault;

-- ── 1. Only the definer functions write the pointer ──────────────────────────────────────

revoke insert, update on table public.integrations from anon, authenticated;

-- ── 2. The functions check the binding ───────────────────────────────────────────────────

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
  v_ref   text;
  v_bound text := 'shopify:' || p_artist_id::text;
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

  select secret_ref into v_ref
  from public.integrations
  where artist_id = p_artist_id and provider = 'shopify';

  -- Renew in place only a secret that exists AND is bound to this artist. Anything else
  -- (none, orphaned, unbound, someone else's) gets a fresh bound secret and the pointer
  -- overwritten; the secret the old pointer named is left exactly as it was.
  if v_ref is not null
     and v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from vault.secrets s where s.id = v_ref::uuid and s.description = v_bound) then
    perform vault.update_secret(v_ref::uuid, p_token);
    update public.integrations
       set metadata = jsonb_build_object('store_domain', p_domain)
     where artist_id = p_artist_id and provider = 'shopify';
  else
    insert into public.integrations (artist_id, provider, secret_ref, metadata)
    values (
      p_artist_id,
      'shopify',
      vault.create_secret(p_token, null, v_bound)::text,
      jsonb_build_object('store_domain', p_domain)
    )
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
  v_ref    text;
  v_domain text;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  select i.secret_ref, i.metadata->>'store_domain'
    into v_ref, v_domain
  from public.integrations i
  where i.artist_id = p_artist_id and i.provider = 'shopify';

  if v_ref is null or v_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;

  return query
    select v_domain, ds.decrypted_secret
    from vault.decrypted_secrets ds
    where ds.id = v_ref::uuid
      and ds.description = 'shopify:' || p_artist_id::text;
end;
$$;

create or replace function public.disconnect_shopify(p_artist_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  select secret_ref into v_ref
  from public.integrations
  where artist_id = p_artist_id and provider = 'shopify';

  -- The secret FIRST (20260624120000 #3), and only one bound to this artist.
  if v_ref is not null and v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    delete from vault.secrets
     where id = v_ref::uuid
       and description = 'shopify:' || p_artist_id::text;
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
  v_ref    text;
  v_domain text;
begin
  select id into v_artist from public.artists where slug = p_slug;
  if v_artist is null then
    return;
  end if;

  if not exists (select 1 from public.published_revisions(v_artist, 'merch')) then
    return;
  end if;

  select i.secret_ref, i.metadata->>'store_domain'
    into v_ref, v_domain
  from public.integrations i
  where i.artist_id = v_artist and i.provider = 'shopify';

  if v_ref is null or v_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;

  return query
    select v_domain, ds.decrypted_secret
    from vault.decrypted_secrets ds
    where ds.id = v_ref::uuid
      and ds.description = 'shopify:' || v_artist::text;
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

-- ── 3. Bind the secrets that already exist ───────────────────────────────────────────────
-- vault.update_secret, never a direct UPDATE of vault.secrets: on pgsodium-era Vault the
-- description is part of the encryption's associated data, and update_secret re-encrypts.
-- A NULL new_secret keeps the token as it is.

do $$
declare
  r record;
begin
  for r in
    select i.artist_id, i.secret_ref
    from public.integrations i
    where i.provider = 'shopify'
      and i.secret_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  loop
    if (select count(*) from public.integrations j where j.secret_ref = r.secret_ref) = 1
       and exists (
         select 1 from vault.secrets s
         where s.id = r.secret_ref::uuid and coalesce(s.description, '') = ''
       ) then
      perform vault.update_secret(r.secret_ref::uuid, null::text, null::text, 'shopify:' || r.artist_id::text);
    end if;
  end loop;
end;
$$;
