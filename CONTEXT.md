# Domain language — Lone Star (artist website manager)

Shared vocabulary for the publish model (the system's core). Use these exact
terms in code, comments, and architecture discussion. See `docs/adr/` for the
decisions behind them (esp. ADR-0002).

## Publish model

- **Working rows** — the editable/draft state a manager edits (the content
  tables + the `artists` profile row + `media`/`site_content`/`videos`/
  `releases`). What the manager sees and the preview renders.
- **Revision** — an immutable snapshot of one entity's public-safe fields,
  written into the `revisions` table when a section is **published**. History is
  the point: every publish appends.
- **Tombstone** — a revision whose `data` is `{"_deleted": true}`, written when a
  previously-published entity no longer has a working row (a delete). Marks the
  entity as gone without losing its history.
- **Snapshot allowlist** — the exact public-safe columns copied into a revision
  (`PUBLISHABLE[type].snapshot` in `src/lib/content.ts`, and `ARTIST_SNAPSHOT`
  for the profile). The contract for "what fans may see." Config/secret columns
  are never in it.

## Published state (the live view)

- **Latest revisions** — the newest revision **per entity**, *including*
  tombstones. SQL: `latest_revisions(artist_id)`. The `diffUnpublished` path uses
  this because detecting a delete *requires* seeing the tombstone.
- **Published state** (a.k.a. **live revisions**) — the newest revision per
  entity *with tombstones removed*. This is "what is currently live on the public
  site." SQL: `published_revisions(artist_id, entity_type?)`. The single home for
  the rule (latest-per-entity tie-broken `published_at desc, id desc`, minus
  tombstones); every **public door** projects over it.

## Public access

- **Public door** — a `SECURITY DEFINER` SQL function that resolves the tenant
  from a slug and returns *published, public-safe* data only — the one way anon
  fans read tenant data (ADR-0001). Each door is a thin **projection** over the
  published state into its output shape (`get_public_site`, `get_release`,
  `get_public_releases`, `audio_path_for_play`).

## Analytics

- **On-site event** — a fan interaction recorded from the PUBLIC site only (never the
  dashboard): a `view` on load, or a `play` / `link_click` / `ticket_click` /
  `buy_click` / `video_click`. Declared through `trackAttrs` (`src/lib/events.ts`) —
  the one typed seam, so an emitter can't forget an attribute or use an off-allowlist
  type — and ingested by the `record_event` public door (anon, type-allowlisted).
  `SiteAnalytics` (`src/components/site-analytics.tsx`) is the delegated listener,
  mounted only on public pages.
- **Attribution** — the content row an event is about: `entity_id` + `entity_type`
  (release / track / merch / video / tour_date / link) on `analytics_events`.
  Unattributed events (`view`) are site-level. Attribution is what lets a stat hang off
  a specific card.
- **On-site metric** — the 30-day per-item number on a content card. Its definition
  (which events sum, what it's labelled) lives once in `ON_SITE_METRIC`
  (`src/lib/analytics.ts`): release = **listens** (plays + DSP clicks over the release
  AND its tracks), merch = buy clicks, tour = ticket clicks, video = clicks from your
  site. Read via `analytics_by_entity` (totals) / `analytics_entity_daily` (the modal
  sparkline), both owner-read (RLS).
- **Reach** — a video's GLOBAL YouTube view count (`youtube_views`, cached on sync).
  Shown ALONGSIDE the on-site metric to contrast total reach vs the lift this site
  drives — never conflated, since we can't prove a YouTube view came from us.
