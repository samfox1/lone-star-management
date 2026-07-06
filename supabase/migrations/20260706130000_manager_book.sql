-- The "Book": manager-facing rollups over subscribers across a whole roster.
--
-- No new tenancy columns. `subscribers.artist_id` already says which artist a
-- fan belongs to, and RLS (`subscribers_read` = is_admin() OR is_manager_of)
-- already limits a manager to their own artists' rows. These are read-only views
-- layered on top, declared `security_invoker` so the CALLER's RLS applies: a
-- manager sees only their roster; an admin sees everyone. Manager identity is
-- derived through `artist_managers`, never stamped onto the data rows (which
-- would drift on reassignment and be null for anon-collected signups).

-- Per-artist rollup: subscriber count + latest signup, one row per artist that
-- has at least one subscriber. RLS from `subscribers` flows through the group-by.
create or replace view public.subscriber_counts_by_artist
with (security_invoker = true) as
  select artist_id,
         count(*)        as subscriber_count,
         max(created_at) as latest_at
  from public.subscribers
  group by artist_id;

comment on view public.subscriber_counts_by_artist is
  'Per-artist subscriber rollup (count + latest signup), RLS-scoped via security_invoker. Backs the manager Book.';

-- Cross-artist subscriber list, denormalized with the artist and the managing
-- user(s). Joining `artist_managers` yields one row per (subscriber, manager),
-- so filtering by `manager_id` returns exactly that manager's whole book — the
-- admin "show me a specific manager's subscribers" tool. One manager per artist
-- today, but the join already handles the eventual many-to-many.
create or replace view public.manager_subscribers
with (security_invoker = true) as
  select am.user_id  as manager_id,
         s.artist_id,
         a.name       as artist_name,
         a.slug       as artist_slug,
         s.email,
         s.created_at
  from public.subscribers s
  join public.artists a          on a.id = s.artist_id
  join public.artist_managers am on am.artist_id = s.artist_id;

comment on view public.manager_subscribers is
  'Admin/manager cross-artist subscriber list keyed by managing user; RLS-scoped. Filter by manager_id for one manager''s book.';

grant select on public.subscriber_counts_by_artist to authenticated;
grant select on public.manager_subscribers to authenticated;
