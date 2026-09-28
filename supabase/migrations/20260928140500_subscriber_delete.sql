-- A manager can now remove a subscriber (Sam, 2026-09-28). The 20260706120000 migration
-- deliberately shipped `subscribers` with NO write policy at all — subscribe() was meant to
-- be the only door, full stop, and tests/integration/auth/subscribers.isolation.test.ts
-- pinned "even the artist's OWN manager cannot delete a fan email" as CRITICAL. Sam changed
-- that rule for DELETE only: a manager (or admin) may remove one of their own artist's
-- subscribers from the Subscribers ledger. INSERT and UPDATE stay closed — subscribe() is
-- still the only way a row is created or changed.
create policy subscribers_delete on public.subscribers
  for delete using (public.is_admin() or public.is_manager_of(artist_id));

-- AGENTS.md: revoke the stock per-role default first, then grant back explicitly only to
-- the role RLS actually lets through. The 20260706120000 comment already notes anon holds
-- a stock table-level INSERT grant it was never meant to use; the same default privilege
-- covers DELETE, so it gets the same treatment here rather than relying on the policy alone.
revoke delete on public.subscribers from public, anon;
grant delete on public.subscribers to authenticated;
