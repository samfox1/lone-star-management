# Per-item analytics stats — plan

Grilled + decided 2026-07-07. Goal: a small, on-brand stat on each content card
(30-day, mono figure) backed by a data model that's accurate and rename-proof —
not the fragile title-string matching we have today.

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Ambition | **Fix the data model** — stable entity ids + the missing events, not title-matching. |
| 2 | Card display | **30-day number + mono caption** (e.g. `128 CLICKS · 30D`). Sparkline/trend + per-track breakdown live in the item's edit modal, not the grid. |
| 3 | Historical data | **Start fresh** at the switch. No backfill. Artist-level totals (views etc.) keep working unchanged. |
| 4 | YouTube views | **Store on the videos row** (`youtube_views` + `youtube_views_at`), refreshed on sync/import. |

### Metric per content type

| Card | Headline metric | Events used |
|------|-----------------|-------------|
| **Release** (Music grid) | release-level **engagement** = plays + DSP link-clicks, summed across its tracks | `play` (per track) + `link_click` (release smart-link DSP buttons) |
| **Track** (inside release modal) | per-track plays + DSP clicks | same, filtered to the track |
| **Tour date** | ticket clicks | `ticket_click` |
| **Merch** | buy clicks | `buy_click` |
| **Video** | **two numbers**: YouTube global views (under the card) + on-site **clicks from your site** | `video_click` (NEW) + `youtube_views` (from YT API) — shown side by side to demonstrate the lift, never claiming causation |
| **Link** | link clicks | `link_click` |

## Today's reality (why this is needed)

- `analytics_events(type, target, ...)` — `type ∈ view|play|link_click|ticket_click|buy_click`.
- `target` is a **display string** (venue name, item title) — not a stable id.
- `play` events currently carry **no target at all** (the play button emits no `data-target`).
- **No `video` event** exists; YouTube embeds can't report plays to us.
- `analytics_daily` rolls up **only `view`** (for the roster sparklines).

## Data-model changes

**A. `analytics_events`** (migration)
- Add `entity_type text` + `entity_id uuid` (both nullable — `view` stays site-level).
- Add `video_click` to the `type` CHECK.
- Index `(artist_id, entity_type, entity_id, created_at)`.
- Keep `target` as an optional human label (no longer the join key).

**B. `record_event`** — extend to
`record_event(p_slug, p_type, p_target, p_entity_id uuid default null, p_entity_type text default null)`.
Backward compatible (existing 3-arg callers unaffected).

**C. Public-site emitters** — add `data-entity-id` + `data-entity-type`, and read them in
`SiteAnalytics` (`src/components/site-analytics.tsx`) to pass through:
- `track-play-button` → `play`, entity = **track id**.
- release smart-link DSP buttons (`/[slug]/r/[release]`) → `link_click`, entity = **release id**.
- tour ticket buttons (`artist-site.tsx`, `templates/cinematic.tsx`) → `ticket_click`, entity = **tour_date id**.
- merch buy buttons → `buy_click`, entity = **merch id**.
- social/external links → `link_click`, entity = **link id**.
- **video tiles (public site) → `video_click`, entity = video id** (new emitter).

**D. `videos` table** (migration) — add `youtube_views bigint`, `youtube_views_at timestamptz`.
Populated by `syncYouTubeVideos`; the YouTube client gains a `videos.list?part=statistics`
batch to fetch `viewCount` for the imported ids. (Coordinate with the in-flight Shorts /
`is_short` work also touching `youtube.ts`.)

**E. Query RPC** — `analytics_by_entity(p_artist_id, p_since)` →
`(entity_type, entity_id, type, count)` grouped, `security invoker` (owner-read), like
`analytics_summary`. Section server components fetch the 30-day slice and map counts to cards.

## Display

- Card stat: one mono figure + `KLabel` caption, 30-day rolling (matches `SITE VIEWS · 30 DAYS`).
  - Release: `{plays+clicks} PLAYS · 30D` (or `ENGAGEMENT`).
  - Tour: `{n} TICKET CLICKS · 30D`. Merch: `{n} BUY CLICKS · 30D`.
  - Video: YouTube views under the thumbnail; `{n} FROM YOUR SITE · 30D` for on-site clicks.
- Detail (item edit modal): sparkline + per-track breakdown — a later phase, reuses the roster sparkline.

## Sequencing

1. ✅ **Plumbing** — migration (`20260707160000`), extended `record_event`, `SiteAnalytics` + all emitters carry entity ids, `analytics_by_entity` RPC. **Also fixed a latent bug: `void supabase.rpc()` never executed, so browser analytics ingestion was silently dead — now fires.**
2. ✅ **Query + card display** — `entityCounts`/`CardStat`; 30-day stat on release (listens), tour (ticket clicks), merch (buy clicks).
3. ✅ **Video** — public-site click-to-load facade fires `video_click` (public site only); YT `viewCounts` fetched on sync + cached on the row; video card shows YT views + "clicks from your site". Decoupled from the Shorts work (separate `viewCounts` method + test).
4. ✅ **Detail** — `analytics_entity_daily` RPC + `EntitySparkline` (30-day sparkline + total) in the release/merch/tour edit modals; release modal also shows a per-track listens breakdown.

All phases done + verified live. NOTES: view counts need `YOUTUBE_API_KEY` set to populate; browser event ingestion was silently broken before Phase 1 (`void supabase.rpc` never executed) — now fixed, so stats accrue with real traffic.
