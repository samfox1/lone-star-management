-- Per-store Shopify credentials via Supabase Vault (PLAN #3).
--
-- The storefront token is encrypted in Vault; the integrations row holds only a
-- secret_ref pointer (the Vault secret id), never the raw token. Access is
-- owner-only through these SECURITY DEFINER functions — there is no
-- manager-readable column holding the token, and the public read path never
-- touches integrations.

create extension if not exists supabase_vault with schema vault;

-- Connect (or rotate) a store: store/refresh the token in Vault and upsert the
-- integration row with the pointer + store domain.
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
  v_id  uuid;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  select secret_ref into v_ref
  from public.integrations
  where artist_id = p_artist_id and provider = 'shopify';

  if v_ref is not null then
    perform vault.update_secret(v_ref::uuid, p_token);
    update public.integrations
       set metadata = jsonb_build_object('store_domain', p_domain)
     where artist_id = p_artist_id and provider = 'shopify';
  else
    select vault.create_secret(p_token) into v_id;
    insert into public.integrations (artist_id, provider, secret_ref, metadata)
    values (p_artist_id, 'shopify', v_id::text, jsonb_build_object('store_domain', p_domain));
  end if;
end;
$$;

-- Retrieve the decrypted token + domain for the owner (server-side use only).
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

-- Disconnect a store: remove the integration row and its Vault secret.
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

  delete from public.integrations
   where artist_id = p_artist_id and provider = 'shopify';

  if v_ref is not null then
    delete from vault.secrets where id = v_ref::uuid;
  end if;
end;
$$;

-- Owner-gated, authenticated only. Never anon.
revoke all on function public.connect_shopify(uuid, text, text) from public, anon;
revoke all on function public.shopify_credentials(uuid) from public, anon;
revoke all on function public.disconnect_shopify(uuid) from public, anon;
grant execute on function public.connect_shopify(uuid, text, text) to authenticated;
grant execute on function public.shopify_credentials(uuid) to authenticated;
grant execute on function public.disconnect_shopify(uuid) to authenticated;
