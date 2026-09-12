# The analytics event endpoint — setup, smoke test, abuse controls

`POST /functions/v1/event` is the ingest door every artist site posts fan events to
(ADR 0010 shape, ADR 0012 data). Code: `supabase/functions/event/` (`index.ts` is
plumbing, `derive.ts` decides everything and is unit + mutation tested). The site side
(the bridge's `track()`) arrives in step 5 and is documented in CONNECTING.md.

## Secrets (state as of 2026-09-11)

| secret | state | what |
|---|---|---|
| `ANALYTICS_SALT` | **set** | Salts the per-IP key and the daily visitor hash. The door REFUSES TO START below 32 chars: unsalted, the geo cache is a 2^32 brute force from an IP → city table. `supabase secrets set ANALYTICS_SALT="$(openssl rand -hex 32)"`. Rotating it starts a fresh visitor-count day and clears the burst window; harmless once. |
| `IPINFO_TOKEN` | unset | Optional. Without it events are recorded with no location. `supabase secrets set IPINFO_TOKEN=…` (ipinfo.io, free tier 50k lookups/month). |
| `EVENT_ALLOWED_ORIGINS` | unset (empty) | Optional allowlist. Empty on purpose: every artist site posts here and CORS is not the control. |

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are platform-injected. Never set them.

## Deploy order

1. `npm run db:push` — the door needs `record_site_event`, `bump_event_attempt`,
   `lookup_geo_cache`, `cache_geo` (migrations `20260911180000`, `…190000`, `…200000`).
2. `npm run fn:deploy:event` (or `npm run fn:deploy` for every door).
3. Smoke test below. Then `npm run audit:grants` — the four RPCs must NOT appear (they
   are service-only); `record_event` still does until the step-5 cut-over.

## Smoke test

```bash
URL=https://<project>.supabase.co/functions/v1/event
ANON=<anon key>
SITE=https://<a real slug>.example      # Origin AND the url's host must agree

# 1. Preflight → 204 with the CORS headers, including `apikey`.
curl -si -X OPTIONS "$URL" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, apikey, content-type" | head -8

# 2. A page view → 204. Then the row:
curl -si "$URL" -H "Authorization: Bearer $ANON" -H "apikey: $ANON" -H "Origin: $SITE" \
  -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0 (iPhone) Instagram 300.0" \
  -d "{\"slug\":\"<slug>\",\"type\":\"view\",\"url\":\"$SITE/?utm_source=ig\",\"referrer\":\"https://l.instagram.com/\"}"
#    select path, referrer_host, source, device, browser, visitor_hash, is_bot, country
#    from analytics_events where artist_id = (select id from artists where slug = '<slug>')
#    order by created_at desc limit 1;
#    → / | l.instagram.com | instagram | mobile | instagram | <32 hex> | false | NULL (no token)

# 3. Wrong type → 400 {"ok":false,"error":"bad_type"}
# 4. No Authorization → 401. Page host ≠ Origin host → 403 origin_mismatch. GET → 405.
# 5. Body > 8 KB → 413. Unknown slug → 204 and no row. url /edit/... → 204 and no row.
# 6. 61 requests inside a minute from one address to one slug → 429 rate_limited,
#    Retry-After: 60. (tests/integration/analytics/event-door.test.ts does exactly this.)
```

## Abuse controls, in the order they run

1. **Origin vs page.** A browser sends `Origin`; the page URL in the body must be on that
   host, or 403. Stops beacons embedded on someone else's site. (Scripted callers can
   forge both; the caps are for them.)
2. **Per-(site, IP) cap: 60 events a minute.** Keyed on the salted hash of `slug:ip`,
   the IP being the /64 for IPv6 (a consumer connection owns at least a /64; per-address
   keys would hand an attacker 2^64 fresh buckets). One address cannot starve an artist's
   per-artist cap from outside, and a carrier-NAT fan has a budget per site.
3. **Per-artist caps, in `record_site_event`:** 120 real + 60 bot events a minute. The
   floor under everything.
4. **Bot flag.** Known crawlers, previews, headless and scripted UAs (`BOT_UA_NAMES` in
   derive.ts; empty UA counts). Stored, never counted as traffic, and they skip the
   location lookup.
5. **Location budget.** Cache per IP for two days; a global budget of 500 lookups an hour
   (ledger key `ipinfo:<hour>`); a failed lookup is cached as "no location". A flood of
   fresh addresses cannot spend the month's quota.
6. **What is trusted.** Only the gateway's `cf-connecting-ip` (a client-set one is refused
   by the gateway with 403; `x-forwarded-for` is client-writable and ignored). No header
   → `'unknown'`, one strict shared bucket, no lookup.

What an attacker CAN still do: inflate one artist's `views` at up to 120/minute from many
addresses. What they cannot do: inflate `visitors` past the number of addresses they own
(one hash per address per day), choose their location, or make the door spend money.
The page leads with visitors and shows the bot count for that reason.

## Never stored, never logged

The IP, the full user agent, the full referrer URL, cookies (none read, none set). Error
logs carry a truncated message, never a row. The visitor hash is unlinkable across days
to anyone without the salt; the operator, who holds it, could recompute
`hash(salt, day, ip, ua)` for a known IP and UA — a policy statement, not a technical
impossibility. Rotate the salt if that guarantee ever needs to be technical.

## Cleanup

Events cascade with their artist. `analytics.event_attempts` rows expire after a day and
`analytics.geo_cache` after two, both through `prune_analytics` (step 4 schedules it).

## Verifying a change to the door

```bash
npx vitest run tests/unit/analytics/event-derive.test.ts        # every rule, DB-free
npm run fn:deploy:event
npx vitest run tests/integration/analytics/event-door.test.ts   # the deployed door, end to end
npm run mutation:changed                                         # derive.ts must stay watched
```
