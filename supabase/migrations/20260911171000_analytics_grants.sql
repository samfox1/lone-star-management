-- Grants for the analytics functions, done the way that actually holds.
--
-- WHAT WENT WRONG in 20260911170000 (caught by tests/integration/analytics/context.test.ts
-- minutes after the push): every `revoke all ... from public` there removed the PUBLIC
-- grant, but Supabase's default privileges on the `public` schema grant EXECUTE on each
-- new function to `anon`, `authenticated` and `service_role` BY ROLE, and a revoke from
-- PUBLIC does not touch a role-specific grant. So `record_event_v2` — meant to be the
-- service-only write path — was callable by anon, and the readers were callable by
-- anon too (they failed one step later on `usage` of schema analytics, which is the
-- defence in depth doing its job, not a reason to leave the front door open).
--
-- The codebase learned this once already: 20260804240000 revokes submit_enquiry
-- `from public, anon, authenticated`. That is the form, always. This migration applies
-- it to every analytics function, including the four older readers whose anon grant
-- had survived since 20260714140000 for the same reason (harmless there — they are
-- security invoker and RLS filters anon to zero rows — but wrong).

-- Service-only: the door's write path, the roll-up, the prune.
revoke all on function public.record_event_v2(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_event_v2(text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean) to service_role;

revoke all on function public.roll_up_analytics(date) from public, anon, authenticated;
revoke all on function public.roll_up_pending(integer) from public, anon, authenticated;
revoke all on function public.prune_analytics(interval) from public, anon, authenticated;
grant execute on function public.roll_up_analytics(date) to service_role;
grant execute on function public.roll_up_pending(integer) to service_role;
grant execute on function public.prune_analytics(interval) to service_role;

-- Readers: signed-in managers (RLS decides which rows) and service_role. Never anon.
do $$
declare fn text;
begin
  foreach fn in array array['analytics_timeline', 'analytics_sources', 'analytics_places', 'analytics_devices', 'analytics_paths', 'analytics_campaigns']
  loop
    execute format('revoke all on function public.%I(uuid, date, date) from public, anon', fn);
    execute format('grant execute on function public.%I(uuid, date, date) to authenticated, service_role', fn);
  end loop;
end $$;

revoke all on function public.analytics_summary(uuid, timestamptz) from public, anon;
revoke all on function public.analytics_daily(timestamptz, uuid) from public, anon;
revoke all on function public.analytics_by_entity(uuid, timestamptz) from public, anon;
revoke all on function public.analytics_entity_daily(uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.analytics_summary(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.analytics_daily(timestamptz, uuid) to authenticated, service_role;
grant execute on function public.analytics_by_entity(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.analytics_entity_daily(uuid, uuid[], timestamptz) to authenticated, service_role;
