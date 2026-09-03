-- The live lane's door (MERCH_PLAN step 2).
--
-- The site resolves merch price and availability from Shopify at RENDER rather than
-- reading them out of a published revision, so a price changed in Shopify is right
-- without anyone republishing. That lookup runs server-side on Lone Star (Sam,
-- 2026-09-02) so the storefront token stays in Vault and never becomes public on any
-- artist's site.
--
-- This is the only way that route reaches the token. It mirrors `shopify_credentials`
-- (20260624120000) but keys on the public SLUG instead of an artist id, because the
-- caller is an unauthenticated visitor's page render, not a signed-in manager.
--
-- AUTHORIZATION. `shopify_credentials` is safe for `authenticated` because it checks
-- is_manager_of. This one CANNOT: a slug identifies an artist, not a caller, so there
-- is nobody to check. It is therefore revoked from `authenticated` as well as `anon`
-- and granted to `service_role` only — reachable from Lone Star's server and nowhere
-- else. Granting it to authenticated would let any signed-in manager read every other
-- artist's storefront token by slug.
--
-- The published-merch condition keeps the door shut for an artist who has nothing on
-- their site: the live lane exists to correct prices on a LIVE page, so an artist with
-- nothing published has nothing to correct, and a connected-but-unlaunched store is
-- never reachable through a public route.
create or replace function public.shopify_store_for_slug(p_slug text)
returns table(store_domain text, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_ref text;
  v_domain text;
begin
  select id into v_artist from public.artists where slug = p_slug;
  if v_artist is null then
    return;
  end if;

  if not exists (select 1 from public.published_revisions(v_artist, 'merch')) then
    return;
  end if;

  select secret_ref, metadata->>'store_domain'
    into v_ref, v_domain
  from public.integrations
  where artist_id = v_artist and provider = 'shopify';

  if v_ref is null then
    return;
  end if;

  return query
    select v_domain, ds.decrypted_secret
    from vault.decrypted_secrets ds
    where ds.id = v_ref::uuid;
end;
$$;

revoke all on function public.shopify_store_for_slug(text) from public, anon, authenticated;
grant execute on function public.shopify_store_for_slug(text) to service_role;
