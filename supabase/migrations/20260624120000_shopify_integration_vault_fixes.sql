-- Fixes for per-store Shopify Vault integration (supersedes 20260624110000).
-- Additive + immutable-safe: CREATE OR REPLACE only; no schema changes.
--
--   1. Authoritative domain validation — reject anything that isn't a bare
--      *.myshopify.com storefront host (the canonical Storefront API host even
--      for stores on a custom/vanity domain). Stops token exfiltration to a
--      attacker host.
--   2. Reconnect with orphaned Vault ref — if the secret behind secret_ref was
--      deleted, fall through to create a fresh secret and overwrite the pointer
--      (was a silent no-op that broke pulls forever).
--   3. Disconnect ordering — destroy the Vault secret BEFORE deleting the row,
--      so any failure leaves the recoverable pointer, never an invisible orphan.
--   4. Concurrency — a per-artist transaction-scoped advisory lock serializes
--      connects, so a double-submit can't race unique(artist_id,provider) and
--      strand a just-created secret.

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
  v_ref text;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  -- (1) Authoritative storefront-host validation. Guard of record; the client
  -- sanitizes defensively but must not be trusted.
  if p_domain is null or p_domain !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' then
    raise exception 'invalid shopify domain: %', p_domain
      using hint = 'expected a bare {store}.myshopify.com host';
  end if;

  -- (4) Serialize per-artist connects (transaction-scoped; auto-released).
  perform pg_advisory_xact_lock(hashtext('connect_shopify:' || p_artist_id::text));

  select secret_ref into v_ref
  from public.integrations
  where artist_id = p_artist_id and provider = 'shopify';

  -- (2) Treat a pointer whose underlying secret is gone as "no secret": fall
  -- through to create and overwrite secret_ref.
  if v_ref is not null
     and exists (select 1 from vault.secrets s where s.id = v_ref::uuid) then
    perform vault.update_secret(v_ref::uuid, p_token);
    update public.integrations
       set metadata = jsonb_build_object('store_domain', p_domain)
     where artist_id = p_artist_id and provider = 'shopify';
  else
    insert into public.integrations (artist_id, provider, secret_ref, metadata)
    values (
      p_artist_id,
      'shopify',
      vault.create_secret(p_token)::text,
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
  v_ref text;
  v_domain text;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  select secret_ref, metadata->>'store_domain'
    into v_ref, v_domain
  from public.integrations
  where artist_id = p_artist_id and provider = 'shopify';

  if v_ref is null then
    return;
  end if;

  return query
    select v_domain, ds.decrypted_secret
    from vault.decrypted_secrets ds
    where ds.id = v_ref::uuid;
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

  -- (3) Destroy the Vault secret FIRST; if it fails, the recoverable pointer
  -- row survives rather than orphaning an invisible secret.
  if v_ref is not null then
    delete from vault.secrets where id = v_ref::uuid;
  end if;

  delete from public.integrations
   where artist_id = p_artist_id and provider = 'shopify';
end;
$$;

revoke all on function public.connect_shopify(uuid, text, text) from public, anon;
revoke all on function public.shopify_credentials(uuid) from public, anon;
revoke all on function public.disconnect_shopify(uuid) from public, anon;
grant execute on function public.connect_shopify(uuid, text, text) to authenticated;
grant execute on function public.shopify_credentials(uuid) to authenticated;
grant execute on function public.disconnect_shopify(uuid) to authenticated;
