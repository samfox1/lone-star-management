-- Site editor: per-artist editable site text (taglines, headings, booking email)
-- as a key/value table. It is a PUBLISHABLE entity (draft → publish like content):
-- reconciled into `revisions` by row id, snapshot {id,key,value}, surfaced by
-- get_public_site as a key→value object. A null/absent value means "use the
-- template default" (the override semantics live in the app's TEMPLATE_FIELDS).

create table public.site_content (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  key        text not null,
  value      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, key)
);

create index site_content_artist_idx on public.site_content (artist_id, key);

create trigger site_content_updated_at
  before update on public.site_content
  for each row execute function public.set_updated_at();

-- RLS: standard tenant isolation. The value is public ONCE published (via
-- get_public_site), so the only requirement here is owner-only read/write.
alter table public.site_content enable row level security;

create policy site_content_rw on public.site_content
  for all using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

-- Allow 'site_content' as a revision entity type.
alter table public.revisions drop constraint if exists revisions_entity_type_check;
alter table public.revisions
  add constraint revisions_entity_type_check
  check (entity_type in ('artist', 'track', 'tour_date', 'merch', 'link', 'media', 'site_content'));

-- get_public_site: add a `site_content` key→value object built from published
-- (non-tombstone) site_content revisions. Rest unchanged from 20260624160000.
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
  latest as (
    select distinct on (r.entity_type, r.entity_id)
      r.entity_type, r.entity_id, r.data, r.published_at, r.id
    from public.revisions r
    join a on a.id = r.artist_id
    where r.entity_type in ('track', 'tour_date', 'merch', 'link', 'media', 'site_content')
    order by r.entity_type, r.entity_id, r.published_at desc, r.id desc
  ),
  live as (
    select entity_type, data, published_at
    from latest
    where coalesce(data ->> '_deleted', 'false') <> 'true'
  )
  select case
    when not exists (select 1 from a) then null
    when not exists (select 1 from ap) then null
    else jsonb_build_object(
      'artist',
        (select data from ap)
        || jsonb_build_object('id', (select id from a), 'slug', (select slug from a)),
      'tracks',     coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'track'), '[]'::jsonb),
      'tour_dates', coalesce((
        select jsonb_agg(data order by (data ->> 'date'), published_at)
        from live where entity_type = 'tour_date'), '[]'::jsonb),
      'merch',      coalesce((
        select jsonb_agg(data order by (data ->> 'created_at'), published_at)
        from live where entity_type = 'merch'), '[]'::jsonb),
      'links',      coalesce((
        select jsonb_agg(data order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'link'), '[]'::jsonb),
      'media',      coalesce((
        select jsonb_agg(jsonb_build_object('purpose', data ->> 'purpose', 'path', data ->> 'storage_path')
                         order by (data ->> 'sort_order')::int nulls last, (data ->> 'created_at'), published_at)
        from live where entity_type = 'media'), '[]'::jsonb),
      'site_content', coalesce((
        select jsonb_object_agg(data ->> 'key', data ->> 'value')
        from live where entity_type = 'site_content' and data ->> 'key' is not null), '{}'::jsonb)
    )
  end;
$$;

revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;
