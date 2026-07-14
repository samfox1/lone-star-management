-- Site styling: per-region editable class names, so each site's layout/format is
-- data-driven instead of locked to a hardcoded template (SITE_STYLING_PLAN.md).
--
-- Modeled on `site_content` (20260624180000): a per-artist key/value table that is a
-- PUBLISHABLE entity (draft → publish like content), reconciled into `revisions` by row
-- id, snapshot {id, region_key, class_names}, and folded by get_public_site into a
-- {region_key: class_names} object.
--
-- `region_key` is a manifest style-region key. Section regions use a plain key
-- (e.g. 'hero_wordmark'); per-item regions use '<slot>:<itemId>' (e.g. 'videos:<uuid>'),
-- reusing the data-lse-item UUID convention (the first ':' is an unambiguous separator).
-- `class_names` is a raw class string (Tailwind/arbitrary utilities); null/'' means the
-- region falls back to its base classes only.

create table public.site_styles (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references public.artists (id) on delete cascade,
  region_key  text not null,
  class_names text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (artist_id, region_key)
);

create index site_styles_artist_idx on public.site_styles (artist_id, region_key);

create trigger site_styles_updated_at
  before update on public.site_styles
  for each row execute function public.set_updated_at();

-- RLS: standard tenant isolation. The value is public ONCE published (via
-- get_public_site), so the only requirement here is owner-only read/write.
alter table public.site_styles enable row level security;

create policy site_styles_rw on public.site_styles
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

-- Allow 'site_styles' as a revision entity type.
alter table public.revisions drop constraint if exists revisions_entity_type_check;
alter table public.revisions
  add constraint revisions_entity_type_check
  check (entity_type in ('artist', 'track', 'tour_date', 'merch', 'link', 'media', 'site_content', 'video', 'release', 'site_styles'));

-- Custom-site wiring: an artist's public site is either a built-in template or a fully
-- custom site hosted elsewhere (e.g. the Vercel skeen-website). A custom site's /[slug]
-- redirects to custom_site_url (SITE_STYLING_PLAN.md D-F). These are config columns, not
-- draft/publish content, so they are NOT in ARTIST_SNAPSHOT.
alter table public.artists
  add column if not exists site_kind text not null default 'template'
    check (site_kind in ('template', 'custom')),
  add column if not exists custom_site_url text;

-- get_public_site: add a `styles` {region_key: class_names} object built from published
-- (non-tombstone) site_styles revisions. Everything else is unchanged from 20260713160000.
create or replace function public.get_public_site(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with a as (
    select id, slug from public.artists where slug = p_slug
  ),
  ap as (
    select r.data
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type = 'artist'
    order by r.published_at desc, r.id desc
    limit 1
  ),
  live as (
    select entity_type, data, published_at
    from public.published_revisions((select id from a))
  )
  select case
    when not exists (select 1 from a) then null
    when not exists (select 1 from ap) then null
    else jsonb_build_object(
      'artist',
        (select data from ap)
        || jsonb_build_object('id', (select id from a), 'slug', (select slug from a)),
      'tracks',     coalesce((
        select jsonb_agg(
                 (t.data - 'audio_path')
                 || jsonb_build_object('has_audio', (t.data ->> 'audio_path') is not null)
                 order by (t.data ->> 'sort_order')::int nulls last, t.published_at)
        from live t
        left join public.tracks trk on trk.id = (t.data ->> 'id')::uuid
        where t.entity_type = 'track'
          and coalesce(trk.visible, true)), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'date'), l.published_at)
        from live l
        left join public.tour_dates td on td.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'tour_date' and coalesce(td.visible, true)), '[]'::jsonb),
      'merch',      coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'created_at'), l.published_at)
        from live l
        left join public.merch m on m.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'merch' and coalesce(m.visible, true)), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'link'), '[]'::jsonb),
      'videos',     coalesce((
        select jsonb_agg(l.data order by (l.data ->> 'sort_order')::int nulls last, l.published_at)
        from live l
        left join public.videos v on v.id = (l.data ->> 'id')::uuid
        where l.entity_type = 'video' and coalesce(v.visible, true)), '[]'::jsonb),
      'media',      coalesce((
        select jsonb_agg(jsonb_build_object('purpose', data ->> 'purpose', 'path', data ->> 'storage_path')
                         order by (data ->> 'sort_order')::int nulls last, (data ->> 'created_at'), published_at)
        from live
        where entity_type = 'media'
          and (data ->> 'purpose' <> 'gallery_image' or coalesce((data ->> 'visible')::boolean, true))
        ), '[]'::jsonb),
      'site_content', coalesce((
        select jsonb_object_agg(data ->> 'key', data ->> 'value')
        from live where entity_type = 'site_content' and data ->> 'key' is not null), '{}'::jsonb),
      'styles', coalesce((
        select jsonb_object_agg(data ->> 'region_key', data ->> 'class_names')
        from live
        where entity_type = 'site_styles'
          and data ->> 'region_key' is not null
          and coalesce(data ->> 'class_names', '') <> ''), '{}'::jsonb)
    )
  end;
$$;
