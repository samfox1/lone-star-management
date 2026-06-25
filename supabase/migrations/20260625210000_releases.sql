-- Phase 5 (Releases): a `release` content type — a title + cover + a set of DSP
-- links (jsonb), published like content (entity_type='release'). Each release has
-- its own public smart-link landing page, read via get_release(artist, release).

create table public.releases (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references public.artists (id) on delete cascade,
  title        text not null,
  slug         text not null,
  cover_url    text,
  release_date date,
  links        jsonb not null default '[]'::jsonb,
  source       text not null default 'manual',
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (artist_id, slug)
);
create index releases_artist_idx on public.releases (artist_id, sort_order);

create trigger releases_updated_at
  before update on public.releases
  for each row execute function public.set_updated_at();

alter table public.releases enable row level security;
create policy releases_rw on public.releases
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

alter table public.revisions drop constraint if exists revisions_entity_type_check;
alter table public.revisions
  add constraint revisions_entity_type_check
  check (entity_type in ('artist', 'track', 'tour_date', 'merch', 'link', 'media', 'site_content', 'video', 'release'));

-- The smart-link door: the PUBLISHED release for (artist slug, release slug), or
-- null (unpublished/tombstoned/unknown). Public-safe by construction — the
-- snapshot is the allowlist (title/cover/date/links), no source/internal fields.
create or replace function public.get_release(p_artist_slug text, p_release_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (
    select id from public.artists where slug = p_artist_slug
  ),
  latest as (
    select distinct on (r.entity_id) r.data
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type = 'release'
    order by r.entity_id, r.published_at desc, r.id desc
  )
  select data
  from latest
  where coalesce(data ->> '_deleted', 'false') <> 'true'
    and data ->> 'slug' = p_release_slug
  limit 1
$$;

revoke all on function public.get_release(text, text) from public;
grant execute on function public.get_release(text, text) to anon, authenticated;
