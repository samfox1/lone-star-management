-- The door now files a referrer-less visit from a known in-app browser under that
-- app (event/derive.ts IN_APP_SOURCES, 2026-09-14): TikTok's webview strips the
-- referrer on every visit, so every TikTok visit to Skeen had been counted as
-- Direct. This re-files the rows already recorded the old way, then re-rolls the
-- days they fall on so the source tallies agree. Only rows the raw table still
-- holds can move; the cut-over was 2026-09-12, so nothing older qualifies.
update public.analytics_events
set source = browser
where source = 'direct'
  and referrer_host is null
  and utm_source is null
  and browser in ('instagram', 'tiktok', 'facebook')
  and created_at >= '2026-09-12';

do $$
declare d date;
begin
  for d in
    select distinct (created_at at time zone 'UTC')::date
    from public.analytics_events
    where browser in ('instagram', 'tiktok', 'facebook') and referrer_host is null and created_at >= '2026-09-12'
    order by 1
  loop
    perform public.roll_up_analytics(d);
  end loop;
end
$$;
