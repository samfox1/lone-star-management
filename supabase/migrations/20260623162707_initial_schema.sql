-- Lone Star Management — initial schema
-- Multi-tenant artist site manager. Tenant = artist. Isolation enforced in Postgres
-- with Row-Level Security (deny-by-default). See PLAN.md for the locked decisions.

-- ---------------------------------------------------------------------------
-- Helper: keep updated_at fresh on content rows.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One profile per auth user. Role is the coarse admin/manager split; admin is
-- ALSO carried as a signed JWT claim (see is_admin()), which is what RLS trusts.
create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'manager' check (role in ('admin', 'manager')),
  created_at timestamptz not null default now()
);

-- The tenant.
create table public.artists (
  id                uuid primary key default gen_random_uuid(),
  slug              text unique not null,
  name              text not null,
  bio               text,
  hero_image_url    text,
  spotify_artist_id text,
  bandsintown_name  text,
  shopify_domain    text,
  created_at        timestamptz not null default now()
);

-- The isolation join: who manages whom.
create table public.artist_managers (
  user_id   uuid not null references auth.users (id) on delete cascade,
  artist_id uuid not null references public.artists (id) on delete cascade,
  primary key (user_id, artist_id)
);

create table public.tracks (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  title      text not null,
  cover_url  text,
  spotify_id text,
  stream_url text,
  sort_order int not null default 0,
  source     text not null default 'manual' check (source in ('manual','spotify','bandsintown','shopify')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tour_dates (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  date       date not null,
  venue      text,
  city       text,
  country    text,
  ticket_url text,
  source     text not null default 'manual' check (source in ('manual','spotify','bandsintown','shopify')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.merch (
  id                 uuid primary key default gen_random_uuid(),
  artist_id          uuid not null references public.artists (id) on delete cascade,
  title              text not null,
  image_url          text,
  price              numeric(10, 2),
  url                text,
  shopify_product_id text,
  source             text not null default 'manual' check (source in ('manual','spotify','bandsintown','shopify')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.links (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  label      text not null,
  url        text not null,
  sort_order int not null default 0,
  source     text not null default 'manual' check (source in ('manual','spotify','bandsintown','shopify')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-tenant external-service credentials. secret_ref points into Supabase Vault;
-- the raw token never lives in this table and is never on the public read path.
create table public.integrations (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  provider   text not null,
  secret_ref text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (artist_id, provider)
);

-- Published history and source of truth for the live site. Publish = snapshot a
-- working row into here; the public site reads the latest revision per entity.
create table public.revisions (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.artists (id) on delete cascade,
  entity_type  text not null check (entity_type in ('artist','track','tour_date','merch','link')),
  entity_id    uuid,
  data         jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id)
);

create index revisions_lookup_idx on public.revisions (artist_id, entity_type, entity_id, published_at desc);
create index artist_managers_user_idx on public.artist_managers (user_id);

-- updated_at triggers on content tables
create trigger tracks_updated_at     before update on public.tracks     for each row execute function public.set_updated_at();
create trigger tour_dates_updated_at before update on public.tour_dates for each row execute function public.set_updated_at();
create trigger merch_updated_at      before update on public.merch      for each row execute function public.set_updated_at();
create trigger links_updated_at      before update on public.links      for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

-- Admin is an un-forgeable signed JWT claim. Checking it costs nothing per row.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- Manager membership decided in exactly one place. SECURITY DEFINER so the lookup
-- against artist_managers does not itself trigger RLS (no recursion).
create or replace function public.is_manager_of(target_artist_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.artist_managers
    where artist_id = target_artist_id
      and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security — enable on every table, deny-by-default.
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.artists         enable row level security;
alter table public.artist_managers enable row level security;
alter table public.tracks          enable row level security;
alter table public.tour_dates      enable row level security;
alter table public.merch           enable row level security;
alter table public.links           enable row level security;
alter table public.integrations    enable row level security;
alter table public.revisions       enable row level security;

-- profiles: a user sees their own profile; admin sees all. Writes are admin-only
-- (role changes must not be self-service).
create policy profiles_select on public.profiles
  for select using (public.is_admin() or user_id = auth.uid());
create policy profiles_admin_write on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- artists: managers read/update the artists they manage; admin does everything.
create policy artists_select on public.artists
  for select using (public.is_admin() or public.is_manager_of(id));
create policy artists_update on public.artists
  for update using (public.is_admin() or public.is_manager_of(id))
              with check (public.is_admin() or public.is_manager_of(id));
create policy artists_admin_insert on public.artists
  for insert with check (public.is_admin());
create policy artists_admin_delete on public.artists
  for delete using (public.is_admin());

-- artist_managers: a manager reads only their own membership rows; admin manages all.
create policy artist_managers_select on public.artist_managers
  for select using (public.is_admin() or user_id = auth.uid());
create policy artist_managers_admin_write on public.artist_managers
  for all using (public.is_admin()) with check (public.is_admin());

-- Content tables: readable/writable iff admin OR a manager of that artist.
create policy tracks_rw on public.tracks
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));
create policy tour_dates_rw on public.tour_dates
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));
create policy merch_rw on public.merch
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));
create policy links_rw on public.links
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));
create policy integrations_rw on public.integrations
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));
create policy revisions_rw on public.revisions
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

-- ---------------------------------------------------------------------------
-- Public read path (security boundary)
-- The public site is unauthenticated, so it cannot use RLS. This SECURITY DEFINER
-- function is the ONE controlled door: keyed by slug, returns published snapshots
-- with public-safe fields only — never tokens, manager identity, or store creds.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_site(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (
    select id, slug, name, bio, hero_image_url
    from public.artists
    where slug = p_slug
  ),
  latest as (
    select distinct on (r.entity_type, r.entity_id)
      r.entity_type, r.data
    from public.revisions r
    join a on a.id = r.artist_id
    order by r.entity_type, r.entity_id, r.published_at desc
  )
  select case
    when not exists (select 1 from a) then null
    else jsonb_build_object(
      'artist',     (select to_jsonb(a) from a),
      'tracks',     coalesce((select jsonb_agg(data) from latest where entity_type = 'track'), '[]'::jsonb),
      'tour_dates', coalesce((select jsonb_agg(data) from latest where entity_type = 'tour_date'), '[]'::jsonb),
      'merch',      coalesce((select jsonb_agg(data) from latest where entity_type = 'merch'), '[]'::jsonb),
      'links',      coalesce((select jsonb_agg(data) from latest where entity_type = 'link'), '[]'::jsonb)
    )
  end;
$$;

-- The public door is the only thing anon may call here.
revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;
