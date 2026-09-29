-- EVENTBRITE — "Connect with Eventbrite" and the artist's shows in Tour (Sam, 2026-09-28:
-- "by adding eventbrite, I will allow users to be redirected to the artist's event
-- information via eventbrite"). See src/lib/manager-tools/connections/services/eventbrite/README.md.
--
-- WHY A TOKEN IS STORED AT ALL. Pulling shows later needs the artist's own Eventbrite token:
-- Eventbrite's v3 API has no anonymous access and no app-only token, and an organization's
-- events are read with a member's token. Eventbrite tokens carry no scopes (the whole
-- account) and do not expire, so it lives ONLY in Supabase Vault, the way Shopify's
-- storefront token does (20260624110000 / 20260624120000): encrypted, the integrations row
-- holding just a pointer, reachable only through the owner-gated SECURITY DEFINER functions
-- below. No column, cookie or log ever holds it.
--
-- ONE HARDENING BEYOND SHOPIFY'S. `integrations_rw` is FOR ALL to a manager, so a manager can
-- repoint their own row's `secret_ref` at any Vault secret id. Shopify's readers decrypt
-- whatever the pointer names. Here the secret is BOUND to the artist (its description is
-- 'eventbrite:<artist_id>'), and every function checks the binding before it reads,
-- updates or deletes a secret: a repointed ref reads nothing and deletes nothing.

-- ── 1. Tour dates from Eventbrite ─────────────────────────────────────────────────────

-- The stable id a re-pull matches on (Eventbrite event ids are digits; it goes into no URL
-- of ours, but a CHECK keeps junk out anyway).
alter table public.tour_dates
  add column if not exists eventbrite_id text
  check (eventbrite_id is null or eventbrite_id ~ '^[0-9]{1,20}$');

-- What the row's source last wrote, column → value (src/lib/tour-pull.ts). A re-pull changes
-- a column only while the row still holds that value, so a manager's edit is never undone.
-- Only Eventbrite writes it today. Dashboard-only: never in the published snapshot.
alter table public.tour_dates
  add column if not exists pulled jsonb not null default '{}'::jsonb;

-- One row per event per artist, even when two pulls race (the second insert gets 23505 and
-- the sync counts it as already there).
create unique index if not exists tour_dates_artist_eventbrite_id_key
  on public.tour_dates (artist_id, eventbrite_id)
  where eventbrite_id is not null;

-- The source vocabulary, as 20260625160000 left it, plus 'eventbrite'.
alter table public.tour_dates drop constraint if exists tour_dates_source_check;
alter table public.tour_dates
  add constraint tour_dates_source_check
  check (source in ('manual', 'spotify', 'bandsintown', 'shopify', 'ticketmaster', 'eventbrite'));

-- ── 2. The sign-in, in Vault ──────────────────────────────────────────────────────────

create extension if not exists supabase_vault with schema vault;

-- Connect (or renew) the sign-in: the token into Vault, the pointer + which organization and
-- organizer page into the integrations row. Serialised per artist, like connect_shopify.
create or replace function public.connect_eventbrite(
  p_artist_id uuid,
  p_organization_id text,
  p_organizer_id text,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref   text;
  v_bound text := 'eventbrite:' || p_artist_id::text;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  -- Guards of record (the callback checks the same). Messages never echo the token.
  if p_organization_id is null or p_organization_id !~ '^[0-9]{1,20}$' then
    raise exception 'invalid eventbrite organization id';
  end if;
  if p_organizer_id is null or p_organizer_id !~ '^[0-9]{1,20}$' then
    raise exception 'invalid eventbrite organizer id';
  end if;
  if p_token is null or length(p_token) = 0 or length(p_token) > 512 then
    raise exception 'invalid eventbrite token';
  end if;

  perform pg_advisory_xact_lock(hashtext('connect_eventbrite:' || p_artist_id::text));

  select secret_ref into v_ref
  from public.integrations
  where artist_id = p_artist_id and provider = 'eventbrite';

  -- Renew in place only a secret that exists AND is bound to this artist; anything else
  -- (none, orphaned, repointed) gets a fresh bound secret and the pointer overwritten.
  if v_ref is not null
     and v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from vault.secrets s where s.id = v_ref::uuid and s.description = v_bound) then
    perform vault.update_secret(v_ref::uuid, p_token);
    update public.integrations
       set metadata = jsonb_build_object('organization_id', p_organization_id, 'organizer_id', p_organizer_id)
     where artist_id = p_artist_id and provider = 'eventbrite';
  else
    insert into public.integrations (artist_id, provider, secret_ref, metadata)
    values (
      p_artist_id,
      'eventbrite',
      vault.create_secret(p_token, null, v_bound)::text,
      jsonb_build_object('organization_id', p_organization_id, 'organizer_id', p_organizer_id)
    )
    on conflict (artist_id, provider) do update
      set secret_ref = excluded.secret_ref,
          metadata   = excluded.metadata;
  end if;
end;
$$;

-- The decrypted token + which organization/organizer, for the owner (the server-side pull).
create or replace function public.eventbrite_credentials(p_artist_id uuid)
returns table(organization_id text, organizer_id text, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref       text;
  v_org       text;
  v_organizer text;
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;

  select i.secret_ref, i.metadata->>'organization_id', i.metadata->>'organizer_id'
    into v_ref, v_org, v_organizer
  from public.integrations i
  where i.artist_id = p_artist_id and i.provider = 'eventbrite';

  if v_ref is null or v_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;

  return query
    select v_org, v_organizer, ds.decrypted_secret
    from vault.decrypted_secrets ds
    where ds.id = v_ref::uuid
      and ds.description = 'eventbrite:' || p_artist_id::text;
end;
$$;

-- Remove: forget the sign-in. The Vault secret FIRST (only one bound to this artist), then
-- the pointer row — the order Shopify's fixes settled on (20260624120000 #3).
create or replace function public.disconnect_eventbrite(p_artist_id uuid)
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
  where artist_id = p_artist_id and provider = 'eventbrite';

  if v_ref is not null and v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    delete from vault.secrets
     where id = v_ref::uuid
       and description = 'eventbrite:' || p_artist_id::text;
  end if;

  delete from public.integrations
   where artist_id = p_artist_id and provider = 'eventbrite';
end;
$$;

-- Owner-gated, authenticated only — Shopify's grants exactly. Never anon.
revoke all on function public.connect_eventbrite(uuid, text, text, text) from public, anon;
revoke all on function public.eventbrite_credentials(uuid) from public, anon;
revoke all on function public.disconnect_eventbrite(uuid) from public, anon;
grant execute on function public.connect_eventbrite(uuid, text, text, text) to authenticated;
grant execute on function public.eventbrite_credentials(uuid) to authenticated;
grant execute on function public.disconnect_eventbrite(uuid) to authenticated;
