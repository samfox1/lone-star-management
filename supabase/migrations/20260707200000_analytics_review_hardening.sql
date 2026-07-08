-- Review hardening (pre-landing /review of the analytics work):
--
-- 1. record_event (anon door) now ALLOWLISTS entity_type. An anonymous caller could
--    forge events with an arbitrary entity_type/entity_id; we drop both unless the
--    type is a real content kind, so junk can't accrete. (Forging still only inflates
--    the artist's OWN vanity counts — never cross-tenant — and a per-slug rate limit
--    like the subscribe door is a tracked follow-up; see TODO.md.)
--
-- 2. get_public_site gates videos/merch/tour_dates with a LEFT JOIN + coalesce(visible,
--    true) instead of an INNER JOIN. The INNER JOIN dropped a published item the instant
--    its working row was deleted — BEFORE the tombstone/publish flow — silently
--    unpublishing live content. LEFT JOIN keeps the published snapshot live until a real
--    publish tombstones it (matching tracks/links), while a live visible=false still hides.

create or replace function public.record_event(
  p_slug        text,
  p_type        text,
  p_target      text default null,
  p_entity_id   uuid default null,
  p_entity_type text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid uuid;
  etype text;
  eid uuid;
begin
  if p_type not in ('view', 'link_click', 'ticket_click', 'buy_click', 'play', 'video_click') then
    return;
  end if;
  select id into aid from public.artists where slug = p_slug;
  if aid is null then
    return;
  end if;
  -- Only keep the entity attribution when the type is a real content kind.
  if p_entity_type in ('release', 'track', 'merch', 'video', 'tour_date', 'link') then
    etype := p_entity_type;
    eid := p_entity_id;
  else
    etype := null;
    eid := null;
  end if;
  insert into public.analytics_events (artist_id, type, target, entity_id, entity_type)
  values (aid, p_type, nullif(left(coalesce(p_target, ''), 200), ''), eid, etype);
end;
$$;

revoke all on function public.record_event(text, text, text, uuid, text) from public;
grant execute on function public.record_event(text, text, text, uuid, text) to anon, authenticated;

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
                 (data - 'audio_path')
                 || jsonb_build_object('has_audio', (data ->> 'audio_path') is not null)
                 order by (data ->> 'sort_order')::int nulls last, published_at)
        from live where entity_type = 'track'), '[]'::jsonb),
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
        from live where entity_type = 'media'), '[]'::jsonb),
      'site_content', coalesce((
        select jsonb_object_agg(data ->> 'key', data ->> 'value')
        from live where entity_type = 'site_content' and data ->> 'key' is not null), '{}'::jsonb)
    )
  end;
$$;

revoke all on function public.get_public_site(text) from public;
grant execute on function public.get_public_site(text) to anon, authenticated;
