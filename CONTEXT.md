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
- **Edge door** — one of the TWO public entries that are not SQL functions (`/contact`, `/event`): the `/contact`
  Edge Function (ADR-0010; since 2026-09-11 the `/event` analytics door is the second, ADR 0012). Postgres provably cannot host it — it needs the client IP
  (per-IP rate limiting) and an outbound call to Resend — so the door moved to the edge
  and the RPC behind it (`submit_enquiry`) is `service_role`-only. "Resolve the tenant
  from the slug, never trust the client" still holds; only the runtime changed.

## Enquiries

- **Enquiry** — a contact-form submission from an artist site. Stored in `enquiries`
  (the manager's inbox, owner-read) *before* being emailed, so a bounced or failed send
  still leaves a record the manager can act on.
- **Recipient resolution** — the booking address, resolved SERVER-SIDE by
  `resolve_booking_recipient`: ops override → `links.role='booking'` →
  `site_content.booking_email` → configured default, each rung skipped if it isn't a
  valid address. Never accepted from the request body — that would be an open relay on
  our verified sending domain. Reads WORKING rows, so correcting a dead address takes
  effect immediately without publishing unrelated edits; `enquiries.to_email` freezes
  what was resolved per row.
- **Attempt ledger** — `contact_attempts`, admin-only: every attempt including honeypot
  hits and rejections, keyed by a salted IP hash. It is the rate limiter's counter
  (5/hour, 20/day per IP), kept separate from `enquiries` so a dropped attempt costs the
  attacker a slot without reaching a manager's screen. Runbook: `docs/contact-endpoint.md`.

## Music & assets

- **Song** — the UI/conversation word for a `tracks` row. Code and DB identifiers keep
  `track`; user-facing copy and these docs say **song**.
- **Project** — an album / EP / single / remix as one unit: the set of songs sharing a
  **parent release** (`tracks.release_id`, a stable FK). Membership is the parent link,
  NOT the album name (rename-unsafe, title-collision-prone) and NOT cover art (a heuristic
  that mis-groups variant covers). A song with no parent is a standalone single — its own
  one-song project. This grouping law lives in ONE seam, `groupTracksIntoProjects`
  (`src/lib/music.ts`); the editor's Music panel and the assets Music page both key on the
  parent through it. A project's TYPE is its songs' own `release_type` tag (per-song); its
  title + date come from the parent release row. The deployed skeen site already groups by
  `release_id` first, so the backfilled parent (`20260727120000`) aligns it too.
- **Assets** — the umbrella for a manager's uploadable/importable media surfaces (Music,
  Videos, Photos/Images, Media). They share the add-modal, Drive-import, and
  storage-upload primitives under `src/app/artists/[id]/(dashboard)/`.
- **Provenance** — the columns that record where a song/release came from (`source`,
  `spotify_id` / `apple_id` / `deezer_id`, `apple_url` / `soundcloud_url` / `provider_url`,
  `stream_url`, and the manual `released` flag). Provenance drives the Released/Unreleased
  split — it isn't shown to fans directly.
- **Released / Unreleased buckets** — the two halves of the artist's LIBRARY (the
  dashboard Music tab). **Released** = has platform presence (any provenance
  id/link/source) **OR** the stored `released` flag; **Unreleased** = everything else.
  It's an **organizing label only — it does NOT decide what's on the public site**
  (decoupled 2026-07-10, ADR 0007). Source of truth: `src/lib/music.ts` (library
  buckets + the release smart-link/EPK doors). See MUSIC_RESTRUCTURE.md (deleted 2026-08-05, in git history).
- **On-site (`on_site`)** — what's actually on the public site is each item's own
  `on_site` flag, gated by the public doors. It lives on all **7** content tables:
  tracks, videos, merch, tour_dates, releases, links, media. Decoupled from Released
  for tracks (ADR 0007). The visual editor is where a manager toggles/places on-site
  items. (Renamed from `visible` in `20260714150000` — the column now matches the
  word the UI and code already used. No table has a `visible` column.)
  - Two write paths, and a type is on **exactly one** (ADR 0009; both declared adjacently
    in `src/lib/content.ts`). **Live toggle** — photo / song / link / video / tour date
    flip instantly (`LIVE_TOGGLE`, `setOnSiteAction`) and reach the site with no publish,
    because the doors gate on the *working* row. **Publish-reconcile** — release / merch
    are reconciled from a password-gated selection at publish (`ON_SITE_ENTITIES` +
    `reconcileOnSite`). A type on both paths has its toggle silently reverted at the next
    publish; `tests/integration/site/on-site-paths.test.ts` guards that.
  - A row must be **published once** before its toggle does anything: the doors serve the
    published snapshot and gate it on the working row, so an unpublished row isn't in
    `live` to gate. New/imported video, merch and tour_date rows land **off-site**
    (`INSERT_OFF_SITE`) — the library is where content arrives, never where it goes live.
  - `media` is the one type whose flag rides the **snapshot** rather than a live join,
    so the gallery gate reads the *published* selection. It also defaults **false** (a
    new upload is off the site until chosen), where every other type defaults true.
  - **On-site gates discovery, not access.** Taking an asset off the site removes the
    row from the public doors; it does NOT revoke the storage URL (`media`/`videos` are
    public buckets, so `/object/public/…` bypasses RLS). Off-site ≠ private. Nothing
    sensitive is stored there today — every object is a hero clip — and the one bucket
    meant for content that must not leak, `audio`, is already private and served through
    a door + a service-role signer (`signAudioUrl`). See TODO.md before changing this.

## Site editor (ADR 0006, ADR 0008)

- **Manifest** — a site's declaration of its editable regions (`src/lib/site-editor/`):
  **fields** (declared text/image), **slots** (a section holding library items), and
  **style regions**. The one editor reads it; a site (template or custom) is editable
  iff it ships a manifest, marks its DOM (`data-lse-*`), and includes the bridge.
- **Style region** — a named part of a site whose CSS classes a manager can edit
  (`data-lse-style`, ADR 0008). Section-level (`hero_wordmark`) or per-item
  (`<slot>:<itemId>`, e.g. `videos:<uuid>`). Each declares a **base** class string;
  a saved override **REPLACES** the base, and clearing the override restores it.
  Stored per artist in `site_styles`, published like any other content.
- **Custom site** — an artist whose public site is hosted elsewhere
  (`artists.site_kind='custom'` + `custom_site_url`; skeen on Vercel). Its `/[slug]`
  redirects to that URL, and the editor embeds `custom_site_url/edit` instead of the
  built-in frame. These are **config, not content** — never in `ARTIST_SNAPSHOT`,
  never in `get_public_site`.
- **Edit-list** — a custom site's own manifest, posted to the editor at runtime in the
  `ready` message rather than being declared in this repo (ADR 0008 / D-D). The editor
  never hardcodes a custom site's regions.
- **Wire shape (`PublicSitePayload`)** — exactly what `get_public_site` returns, media
  carried as raw `path`. This is what the editor posts to a custom frame over
  `init-data`, NOT `SiteData` (which has already resolved media to lone-star-built
  URLs). A custom site resolves paths against its own Supabase URL.
- **Edit mode** — the site rendered in an authenticated embedded frame with draft
  data + the `data-lse-*` markers + the postMessage bridge. Never on public `/[slug]`.
- **Library vs editor** — the Assets pages are the content **library** (asset details,
  saved as draft); the **editor** controls what's on the site + placement + site
  text/images. One password-gated **review-and-approve** publish for everything.

## Analytics

- **On-site event** — a fan interaction recorded from the PUBLIC site only (never the
  dashboard): a `view` on load, or a `play` / `link_click` / `ticket_click` /
  `buy_click` / `video_click`. Declared through `trackAttrs` (`src/lib/events.ts`) —
  the one typed seam, so an emitter can't forget an attribute or use an off-allowlist
  type — and ingested today by the `record_event` public door (anon, type-allowlisted); the `/event`
  Edge Function (step 3, deployed) calls `record_site_event` instead and takes over at the
  step-5 cut-over, when the bridge posts to it and `record_event` is dropped.
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
- **Context** (2026-09-11, ADR 0012) — what a `view` carries besides the artist: `path`,
  `referrer_host` + a **source** bucket (instagram / tiktok / … / `ai` / direct / other;
  `utm_source` wins), the UTM triple, `country` / `region` / `city` (from the IP, best
  effort), `device` / `browser`, a **visitor hash** and **is_bot**. Written only by
  `record_site_event` (service_role, called by the `/event` Edge Function).
- **Visitor hash** — `sha256(salt + UTC date + ip + user-agent)`: one visitor per person
  per day, nothing stored on the device, no banner. "Visitors" over a window = the sum of
  daily distinct hashes. Returning visitors across days are NOT a thing here, by design.
- **Bot** — a flagged row (`is_bot`), kept for audit and counted on `daily_total.bots`,
  never counted as a view or a visitor by any reader.
- **Tally / rolled day** — one row per (artist, day, dimension value) in schema
  `analytics` (`daily_total`, `daily_source`, `daily_place`, …), written by
  `roll_up_analytics(day)`. A day in `analytics.rolled_days` is authoritative: readers use
  its tallies and ignore its raw rows. The last two complete days are re-rolled nightly;
  a pruned day (`pruned_at`) is never re-rolled.
- **Raw window** — 90 days of raw `analytics_events` rows; `prune_analytics` deletes
  older rows only for rolled days, in whole UTC days. The schema is not exposed through
  PostgREST; the six `analytics_*` readers in `public` are the only way in.
- **Reach** — a video's GLOBAL YouTube view count (`youtube_views`, cached on sync).
  Shown ALONGSIDE the on-site metric to contrast total reach vs the lift this site
  drives — never conflated, since we can't prove a YouTube view came from us.
