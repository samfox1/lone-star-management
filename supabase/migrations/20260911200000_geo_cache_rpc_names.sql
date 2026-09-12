-- Verb-first names for the two geo-cache RPCs, matching every other function here
-- (record_site_event, roll_up_analytics, prune_analytics, bump_event_attempt,
-- log_contact_attempt, submit_enquiry). `geo_cache_get` / `geo_cache_put` were the only
-- noun-first names in the project (REVIEW_2026-09-11_ANALYTICS.md, step 3 O7). Renamed
-- while nothing but the door calls them; grants travel with the function.
alter function public.geo_cache_get(text) rename to lookup_geo_cache;
alter function public.geo_cache_put(text, text, text, text) rename to cache_geo;
