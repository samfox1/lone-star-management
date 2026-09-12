# 0012 — Analytics: one schema per subject, tallied daily, bots flagged not counted

Status: Accepted (2026-09-11; migrations `20260911170000` → `20260911180000`, extended by
`20260911190000`/`200000` for the door's RPCs and `20260912120000` for `daily_type`).
Extends 0001; the door half extends 0010.

## Context

Step 2 of ANALYTICS_PAGE_PLAN.md gives every recorded fan event its context — where the
fan came from (referrer, source bucket, UTM), where they are (country, region, city),
what they used (device, browser), a daily visitor hash, and a bot flag — so the artist's
Analytics tab can answer "where do my fans come from and what do they click" from one
database, for every site, wherever that site is hosted.

Three questions had a considered alternative and settled the shape of everything after:

1. **How is the data organised per artist?** Sam asked for "an organised hierarchy of
   databases for each artist, so it's not just a bunch of events in one table for all
   artists." A schema or database per artist was considered.
2. **How does the page stay fast at hundreds of thousands of events, without the
   database becoming a burden?** Sam: "I don't need each event staying tracked… it's a
   stat to show the artist which avenue their fans are taking."
3. **What happens to bot traffic?** Drop it at the door, or keep it.

## Decision

- **One table per kind of thing, `artist_id` on every row, RLS isolates — exactly ADR
  0001. NOT a schema or database per artist.** Per-artist schemas would run every
  migration N times, make roster-wide questions N queries, and cost per project. The
  hierarchy is real; it is enforced by the database, not by folders.
- **Grouping is by SUBJECT: the new analytics tables live in schema `analytics`**
  (`daily_total`, `daily_type`, `daily_source`, `daily_place`, `daily_device`, `daily_path`,
  `daily_campaign`, `daily_entity`, `rolled_days`, `geo_cache`, `event_attempts`).
  The schema is **not exposed through PostgREST**: `db.schemas` is unchanged, `anon` has
  no `usage`, and the only way in is the `public` RPCs. That is defence in depth (a
  policy slip on a tally table is unreachable from the API), and it also happens to group
  the tables in the dashboard. `analytics_events` itself stays in `public`; moving a live
  table buys nothing.
- **Tally daily, keep raw 90 days.** `roll_up_analytics(day)` writes one row per
  (artist, day, dimension value) with views and distinct daily visitors; the `rolled_days`
  ledger names the days whose tallies are authoritative. Readers use tallies for ledger
  days and raw rows for every other day, so a window straddling the boundary is exact and
  no day is counted twice. `prune_analytics` deletes raw rows only for ledger days, in
  whole UTC days, never the last three, and stamps `pruned_at`; a pruned day is never
  re-rolled (rebuilding from missing raw would erase it). The last two complete days ARE
  re-rolled on every scheduled run, so a late-arriving row for yesterday is counted.
  Roll-ups take an advisory lock per day, so concurrent runs serialise.
- **Visitors are a daily rotating hash** `sha256(salt + date + ip + user-agent)`,
  nothing stored on the device, no banner — the Plausible / Vercel / Cloudflare standard.
  Returning visitors across days are not tracked, by design. `visitors` over a window is
  the sum of daily distinct hashes, the only definition that hash supports.
- **Bots are stored, flagged (`is_bot`), counted as bots on `daily_total.bots`, and never
  counted as traffic.** Every reader filters them. Storing them keeps the filter auditable
  and tunable and lets the PostHog cross-check be compared like for like.
- **The write path for the Edge Function door is `record_site_event`**, `security
  invoker`, granted to `service_role` only — the ADR 0010 inverse (the caller bypasses RLS
  anyway; INVOKER fails closed if the grant is ever widened). Real and bot traffic have
  separate per-artist burst caps (120 / 60 per minute) so a flood can neither fill the
  table nor crowd out fans. `record_event` (the anon door) is dropped at the cut-over.

## Consequences

- Every page number comes from a reader in `public` that unions tallies and raw. A new
  dimension means a new tally table, a new branch in the roll-up, and a new reader; the
  test suite asserts tally state THROUGH the readers, because nothing else can reach the
  schema.
- ~~The per-entity and artist-wide readers still read raw only.~~ DISCHARGED 2026-09-12
  (`20260912120000`): all four use tallies for rolled days and raw for the rest. It needed a
  new tally, `analytics.daily_type`, because an event that is neither a view nor
  entity-attributed appeared in no tally at all. **Every reader's window is whole UTC days,
  on both halves** — a tally is day-granular, so honouring an exact `p_since` on the raw
  half alone would make the same query answer differently once a day was rolled up. A day
  already stamped `pruned_at` cannot be rebuilt and is simply absent from the per-type
  tally; only test fixtures have ever been pruned.
- The `rolled_days` ledger is load-bearing for BOTH halves of every reader. Its policy is
  `using (true)` (it names no artist). Tighten it and managers' numbers vanish rather
  than double — the failure mode chosen on purpose; the positive-manager test in
  `tests/integration/analytics/analytics-context.test.ts` pins it.
- The test suite leaves one date row in the ledger per run (it cannot delete through
  PostgREST). Known, harmless, documented in the suite header.
- Supabase's default privileges grant EXECUTE by role. The revoke form is `from public,
  anon, authenticated`, always; `npm run audit:grants` lists every anon-executable
  function and fails on any that is not an intended door. AGENTS.md carries the rule.
