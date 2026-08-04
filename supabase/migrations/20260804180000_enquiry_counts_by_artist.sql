-- Per-artist enquiry rollup, backing the manager's cross-artist overview at /artists.
--
-- Deliberately the SAME shape as `subscriber_counts_by_artist` (20260706130000): a
-- read-only view declared `security_invoker` so the CALLER's RLS applies. `enquiries`
-- already carries `artist_id` and its policy is is_admin() OR is_manager_of(artist_id),
-- so that scoping flows straight through the group-by and a manager can never see another
-- tenant's VOLUME — not just not their messages. No new tenancy column, no SECURITY
-- DEFINER, no second permission model to keep in step with the first.
--
-- Note what is NOT here: `name`. Joining `artists` would work, but the roster is already
-- read RLS-scoped by `ownedArtists`, and keeping this view to pure counts means it says
-- exactly one thing. The page joins the two, which is also what the Book does.
--
-- An artist with no enquiries has NO row here (the group-by has nothing to group). That
-- absence means zero, and the page maps it that way — it is not missing data.
create or replace view public.enquiry_counts_by_artist
with (security_invoker = true) as
  select artist_id,
         count(*)                                as total,
         count(*) filter (where read_at is null) as unread,
         max(created_at)                         as latest_at
  from public.enquiries
  group by artist_id;

comment on view public.enquiry_counts_by_artist is
  'Per-artist enquiry rollup (total, unread, latest), RLS-scoped via security_invoker. Backs the manager overview at /artists.';

-- Match the Book views: readable by signed-in managers, scoped by the underlying RLS.
grant select on public.enquiry_counts_by_artist to authenticated;
