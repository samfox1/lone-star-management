---
last_full_scan: 2026-07-08T00:00:00Z
last_full_scan_commit: 9f6728b
last_migration_seen: 20260708160000
last_incremental_update: 2026-07-09T00:00:00Z
generated_by: /steaksauce
---

# steaksauce — Live DB ↔ Codebase Map

**Generated:** 2026-07-08 · **Last full scan:** commit `9f6728b` (FULL_REVIEW / re-baseline)
**Migrations seen:** `20260623162707` … `20260708160000` (49 files in `supabase/migrations/`)
**Live schema:** 17 tables · 2 views · 21 functions · 3 storage buckets · RLS on every base table

> Structure only — this file documents the *shape* of the database, never row data.
> Multi-tenant model: tenant = **artist**; isolation is Postgres RLS via `is_manager_of(artist_id)` / `is_admin()` (ADR-0001). Every content table carries `artist_id → artists(id) ON DELETE CASCADE`.

---

## Table of Contents

### Tables (17)
- [analytics_events](#table-analytics_events) — written via `record_event()`; read via the analytics RPCs
- [applications](#table-applications) — admin/applications page + `submit_application()`
- [artist_managers](#table-artist_managers) — the isolation join (who manages whom); read inside `is_manager_of()`
- [artist_requests](#table-artist_requests) — `src/app/actions.ts`, `roster/page.tsx`
- [artists](#table-artists) — the tenant; `_data.ts`, `actions.ts`, `content.ts`, `site.ts`, `roster-data.ts`
- [integrations](#table-integrations) — `_data.ts` (Shopify domain); written via `connect_shopify` / `disconnect_shopify`
- [links](#table-links) — via generic CRUD (`content.ts`, dynamic table name); `visible` prepped, not yet gated
- [media](#table-media) — `media-uploader.tsx`, `site/page.tsx`, `site.ts`; also a storage **bucket**
- [merch](#table-merch) — via generic CRUD (`content.ts`) + `reconcileVisibility`
- [profiles](#table-profiles) — admin/manager role; used inside `is_admin()`
- [releases](#table-releases) — `actions.ts` (release + links + type editor), `sync.ts`
- [revisions](#table-revisions) — the publish log; `content.ts` (publish/diff), `storage-gc.ts`, public doors
- [site_content](#table-site_content) — `actions.ts`, `site/page.tsx`, `seo/page.tsx`, `site.ts`
- [subscribers](#table-subscribers) — `book/page.tsx`, `subscribers/page.tsx`; ingest via `subscribe()`
- [tour_dates](#table-tour_dates) — `layout.tsx` (on-tour badge); generic CRUD + `reconcileVisibility`
- [tracks](#table-tracks) — `track-audio-uploader.tsx`; generic CRUD; `visible` prepped, not yet gated
- [videos](#table-videos) — generic CRUD (bespoke add) + `reconcileVisibility`; uploaded + embedded

### Views (2)
- [subscriber_counts_by_artist](#view-subscriber_counts_by_artist) — `book/page.tsx` (the Book)
- [manager_subscribers](#view-manager_subscribers) — admin cross-manager tool (no caller yet)

### Functions / RPCs (21)
Public doors (SECURITY DEFINER, anon-reachable): `get_public_site`, `get_release`, `get_public_releases`, `audio_path_for_play`, `record_event`, `subscribe`, `submit_application`.
Manager RPCs: `connect_shopify`, `disconnect_shopify`, `shopify_credentials`, `switch_catalog_source`.
Analytics: `analytics_summary`, `analytics_daily`, `analytics_by_entity`, `analytics_entity_daily`.
Internal / RLS / publish: `is_admin`, `is_manager_of`, `latest_revisions`, `published_revisions`, `set_updated_at` (trigger fn), `rls_auto_enable` (event-trigger fn, fired by event trigger `ensure_rls`).

### Storage Buckets (3)
- [media](#bucket-media) — public bucket; 500 MB cap + MIME allowlist; `media-uploader.tsx`
- [audio](#bucket-audio) — private, gated; `track-audio-uploader.tsx`, served via `audio_path_for_play`
- [videos](#bucket-videos) — public bucket; 500 MB cap + MIME allowlist; `video-add.tsx`, `storage-gc.ts`

### Inconsistencies flagged
- **Re-baselined this run.** The prior file stopped at `20260706133000`; 14 later migrations, the `videos` bucket, 2 analytics RPCs, and the `visible` / `entity_*` / release / video columns are now folded in.
- **`rls_auto_enable` / `ensure_rls`** — live-only (no migration). Exact def now captured (see Functions); a faithful migration can be added when desired.
- **`tracks.visible` / `links.visible`** — added `20260708150000` but NOT yet gated in `get_public_site` or wired to UI. Prepared ahead of the Music restructure (same pattern as `tour_coords`).
- **Dual tracklist membership** — `tracks.release_id` FK (authoritative) + `album_name` fallback still in `get_release()`.
- **`analytics_summary` anon-executable** via the PUBLIC default (never revoked); it is SECURITY INVOKER so anon sees no rows under RLS. Consider an explicit `revoke ... from public`.
- **`subscribe()` has no `rpc()` caller in this repo** — invoked from the external `skeen-website` (confirmed). `src/app/[slug]/actions.ts` calls it for the on-site popup.

---

## Tables

### Table: analytics_events {#table-analytics_events}

| Name        | Type        | Null | Default           | Notes |
| ----------- | ----------- | ---- | ----------------- | ----- |
| id          | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id   | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| type        | text        | NO   | —                 | CHECK: view/link_click/ticket_click/buy_click/play/video_click |
| target      | text        | YES  | —                 |       |
| created_at  | timestamptz | NO   | now()             |       |
| entity_type | text        | YES  | —                 | attribution (e.g. track/release/video) |
| entity_id   | uuid        | YES  | —                 | attributed entity id |

- **RLS:** `analytics_read` (SELECT): `is_admin() OR is_manager_of(artist_id)`. Writes only via `record_event()` (SECURITY DEFINER) — no INSERT policy.
- **Indexes:** PK; `analytics_events_artist_idx (artist_id, created_at)`; `analytics_events_entity_idx (artist_id, entity_type, entity_id, created_at)`.
- **Read by:** `analytics_summary()`, `analytics_daily()`, `analytics_by_entity()`, `analytics_entity_daily()`. **Created/altered:** `20260625200000_analytics.sql`, `20260707160000_analytics_entity.sql` (entity attribution + video_click).

### Table: applications {#table-applications}

| Name        | Type        | Null | Default           | Notes |
| ----------- | ----------- | ---- | ----------------- | ----- |
| id          | uuid        | NO   | gen_random_uuid() | PK    |
| name        | text        | NO   | —                 | CHECK len 1–200 |
| email       | text        | NO   | —                 | CHECK len 3–320 |
| artist_name | text        | YES  | —                 | CHECK len ≤200 |
| link        | text        | YES  | —                 | CHECK len ≤500 |
| notes       | text        | YES  | —                 | CHECK len ≤4000 |
| status      | text        | NO   | 'new'             | CHECK: new/contacted/approved/declined |
| created_at  | timestamptz | NO   | now()             |       |

- **RLS:** `applications_admin_all` (ALL): `is_admin()`. Public writes only via `submit_application()`.
- **Indexes:** PK; `applications_created_idx (created_at DESC)`.
- **Referenced:** `admin/applications/{page.tsx,actions.ts}`; `submit_application()` ← `apply/actions.ts`. Migration `20260701130000_applications.sql`.

### Table: artist_managers {#table-artist_managers}

| Name      | Type | Null | Default | Notes |
| --------- | ---- | ---- | ------- | ----- |
| user_id   | uuid | NO   | —       | PK(1); FK → auth.users(id) CASCADE |
| artist_id | uuid | NO   | —       | PK(2); FK → artists(id) CASCADE |

- **The isolation join** — `is_manager_of(target)` reads this. Composite PK `(user_id, artist_id)`; many-to-many.
- **RLS:** `artist_managers_select` (SELECT): `is_admin() OR user_id = auth.uid()`; `artist_managers_admin_write` (ALL): `is_admin()`.
- **Indexes:** PK `(user_id, artist_id)`; `artist_managers_user_idx (user_id)`.
- **Referenced:** initial schema; joined in the `manager_subscribers` view (`20260706130000_manager_book.sql`). No direct src refs — used inside RLS + the Book's rollup.

### Table: artist_requests {#table-artist_requests}

| Name         | Type        | Null | Default           | Notes |
| ------------ | ----------- | ---- | ----------------- | ----- |
| id           | uuid        | NO   | gen_random_uuid() | PK    |
| requested_by | uuid        | YES  | —                 | FK → auth.users(id) |
| name         | text        | NO   | —                 | CHECK len ≤200 |
| handle       | text        | YES  | —                 | CHECK len ≤120 |
| link         | text        | YES  | —                 | CHECK len ≤500 |
| email        | text        | YES  | —                 | CHECK len ≤320 |
| notes        | text        | YES  | —                 | CHECK len ≤4000 |
| status       | text        | NO   | 'requested'       | CHECK: requested/in_build/live/declined |
| created_at   | timestamptz | NO   | now()             |       |
| updated_at   | timestamptz | NO   | now()             | trigger set_updated_at |
| artist_id    | uuid        | YES  | —                 | FK → artists(id) SET NULL |

- **RLS:** `artist_requests_insert` (INSERT): `requested_by = auth.uid() AND status = 'requested'`; `artist_requests_select`: `is_admin() OR requested_by = auth.uid()`; `artist_requests_admin_write` (ALL): `is_admin()`.
- **Indexes:** PK; `artist_requests_requested_by_idx (requested_by, created_at DESC)`.
- **Referenced:** `src/app/actions.ts` (insert), `src/app/roster/page.tsx` (list). Migrations `20260629120000`, `20260629130000_artist_requests_hardening.sql`.

### Table: artists {#table-artists}

| Name                       | Type        | Null | Default           | Notes |
| -------------------------- | ----------- | ---- | ----------------- | ----- |
| id                         | uuid        | NO   | gen_random_uuid() | PK    |
| slug                       | text        | NO   | —                 | UNIQUE |
| name                       | text        | NO   | —                 |       |
| bio                        | text        | YES  | —                 |       |
| hero_image_url             | text        | YES  | —                 |       |
| spotify_artist_id          | text        | YES  | —                 | catalog import id |
| bandsintown_name           | text        | YES  | —                 | tour sync id |
| shopify_domain             | text        | YES  | —                 | (Shopify state lives in `integrations`) |
| created_at                 | timestamptz | NO   | now()             |       |
| template                   | text        | NO   | 'classic'         | CHECK: classic/cinematic |
| catalog_source             | text        | NO   | 'manual'          | CHECK: manual/spotify/apple/deezer |
| deezer_artist_id           | text        | YES  | —                 |       |
| ticketmaster_attraction_id | text        | YES  | —                 |       |
| apple_artist_id            | text        | YES  | —                 |       |
| youtube_channel_id         | text        | YES  | —                 |       |

- **The tenant.** RLS: `artists_select` / `artists_update`: `is_admin() OR is_manager_of(id)`; insert/delete admin-only.
- **Indexes:** PK; `artists_slug_key (slug)` UNIQUE.
- **Referenced (src):** `_data.ts` (`requireArtist`), `roster-data.ts` (`ownedArtists`), `(dashboard)/actions.ts` (id saves, template, catalog — the `saveArtistField` helper updates one id column), `lib/site.ts`, `lib/content.ts`. The integration-id columns back the `INTEGRATIONS` registry (`isConnected`).

### Table: integrations {#table-integrations}

| Name       | Type        | Null | Default           | Notes |
| ---------- | ----------- | ---- | ----------------- | ----- |
| id         | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id  | uuid        | NO   | —                 | FK → artists(id) CASCADE; UNIQUE(artist_id, provider) |
| provider   | text        | NO   | —                 | UNIQUE(artist_id, provider) |
| secret_ref | text        | YES  | —                 | Vault ref (Shopify storefront token) |
| metadata   | jsonb       | NO   | '{}'              | e.g. `{store_domain}` |
| created_at | timestamptz | NO   | now()             |       |

- **RLS:** `integrations_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `integrations_artist_id_provider_key (artist_id, provider)` UNIQUE.
- **Touched by:** `connect_shopify` / `disconnect_shopify` / `shopify_credentials` (SECURITY DEFINER, token → Vault). **Referenced (src):** `(dashboard)/_data.ts` (`getShopifyDomain` reads `metadata`).

### Table: links {#table-links}

| Name       | Type        | Null | Default           | Notes |
| ---------- | ----------- | ---- | ----------------- | ----- |
| id         | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id  | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| label      | text        | NO   | —                 |       |
| url        | text        | NO   | —                 |       |
| sort_order | int         | NO   | 0                 |       |
| source     | text        | NO   | 'manual'          | CHECK: manual/spotify/bandsintown/shopify |
| created_at | timestamptz | NO   | now()             |       |
| updated_at | timestamptz | NO   | now()             | trigger set_updated_at |
| visible    | boolean     | NO   | true              | ⚠ prepped `20260708150000`, NOT yet gated / wired |

- **RLS:** `links_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Reached via** the generic CRUD layer (`content.ts`, `CRUD.link`) — dynamic table name, so no literal `from('links')`. `visible` is not yet in `VISIBLE_ENTITIES` or gated in `get_public_site`.

### Table: media {#table-media}

| Name         | Type        | Null | Default           | Notes |
| ------------ | ----------- | ---- | ----------------- | ----- |
| id           | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id    | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| purpose      | text        | NO   | —                 | CHECK: hero_video/profile_photo/gallery_image |
| storage_path | text        | NO   | —                 | path in the `media` bucket |
| sort_order   | int         | NO   | 0                 |       |
| created_at   | timestamptz | NO   | now()             |       |

- **RLS:** `media_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `media_artist_idx (artist_id, purpose, sort_order)`.
- **Publishable** (`PUBLISHABLE.media`, bespoke uploader — ADR-0003). No `updated_at` (live table; delete unpublishes immediately). **Referenced (src):** `media-uploader.tsx`, `site/page.tsx`, `lib/site.ts`, `(dashboard)/actions.ts` (`deleteMediaAction`). Shares its name with the `media` storage bucket. `gallery_image` purpose is defined but unused (no UI).

### Table: merch {#table-merch}

| Name               | Type        | Null | Default           | Notes |
| ------------------ | ----------- | ---- | ----------------- | ----- |
| id                 | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id          | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| title              | text        | NO   | —                 |       |
| image_url          | text        | YES  | —                 |       |
| price              | numeric     | YES  | —                 | returned as string by PostgREST |
| url                | text        | YES  | —                 |       |
| shopify_product_id | text        | YES  | —                 |       |
| source             | text        | NO   | 'manual'          | CHECK: manual/spotify/bandsintown/shopify |
| created_at         | timestamptz | NO   | now()             |       |
| updated_at         | timestamptz | NO   | now()             | trigger set_updated_at |
| visible            | boolean     | NO   | true              | live on-site gate (20260707120000) |

- **RLS:** `merch_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`. Reached via generic CRUD (`CRUD.merch`) + `reconcileVisibility`. `get_public_site` gates merch on `visible`.

### Table: profiles {#table-profiles}

| Name       | Type        | Null | Default   | Notes |
| ---------- | ----------- | ---- | --------- | ----- |
| user_id    | uuid        | NO   | —         | PK; FK → auth.users(id) CASCADE |
| role       | text        | NO   | 'manager' | CHECK: admin/manager |
| created_at | timestamptz | NO   | now()     |       |

- One profile per auth user. `admin` is ALSO a signed JWT claim, which is what `is_admin()` trusts.
- **RLS:** `profiles_select`: `is_admin() OR user_id = auth.uid()`; `profiles_admin_write` (ALL): `is_admin()`.

### Table: releases {#table-releases}

| Name         | Type        | Null | Default           | Notes |
| ------------ | ----------- | ---- | ----------------- | ----- |
| id           | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id    | uuid        | NO   | —                 | FK → artists(id) CASCADE; UNIQUE(artist_id, slug) |
| title        | text        | NO   | —                 |       |
| slug         | text        | NO   | —                 | UNIQUE(artist_id, slug) |
| cover_url    | text        | YES  | —                 |       |
| release_date | date        | YES  | —                 |       |
| links        | jsonb       | NO   | '[]'              | DSP smart-link buttons |
| source       | text        | NO   | 'manual'          |       |
| sort_order   | int         | NO   | 0                 |       |
| created_at   | timestamptz | NO   | now()             |       |
| updated_at   | timestamptz | NO   | now()             | trigger set_updated_at |
| release_type | text        | NO   | 'single'          | CHECK: album/single/ep/featured |
| visible      | boolean     | NO   | true              | live on-site gate (20260706180000) |
| spotify_id   | text        | YES  | —                 | UNIQUE(artist_id, spotify_id) WHERE not null |

- **RLS:** `releases_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `releases_artist_id_slug_key (artist_id, slug)` UNIQUE; `releases_artist_idx (artist_id, sort_order)`; `releases_artist_spotify_idx (artist_id, spotify_id)` UNIQUE partial (`WHERE spotify_id IS NOT NULL`).
- **Referenced (src):** `(dashboard)/actions.ts` (release + `links` jsonb + `release_type` editor), `lib/sync.ts` (Spotify import). Public smart-link via `get_release()` / `get_public_releases()`.

### Table: revisions {#table-revisions}

| Name         | Type        | Null | Default           | Notes |
| ------------ | ----------- | ---- | ----------------- | ----- |
| id           | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id    | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| entity_type  | text        | NO   | —                 | CHECK: artist/track/tour_date/merch/link/media/site_content/video/release |
| entity_id    | uuid        | YES  | —                 | null for the artist singleton |
| data         | jsonb       | NO   | —                 | public-safe snapshot; `{"_deleted":true}` = tombstone |
| published_at | timestamptz | NO   | now()             |       |
| published_by | uuid        | YES  | —                 | FK → auth.users(id) |

- **The publish log** (ADR-0002). Every publish appends an immutable snapshot; deletes append a tombstone.
- **RLS:** `revisions_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `revisions_lookup_idx (artist_id, entity_type, entity_id, published_at DESC)`.
- **Read by:** `latest_revisions()`, `published_revisions()` (the seam every public door projects over). **Referenced (src):** `lib/content.ts` (publish/diff), `lib/storage-gc.ts` (orphan collection).

### Table: site_content {#table-site_content}

| Name       | Type        | Null | Default           | Notes |
| ---------- | ----------- | ---- | ----------------- | ----- |
| id         | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id  | uuid        | NO   | —                 | FK → artists(id) CASCADE; UNIQUE(artist_id, key) |
| key        | text        | NO   | —                 | UNIQUE(artist_id, key) |
| value      | text        | NO   | —                 |       |
| created_at | timestamptz | NO   | now()             |       |
| updated_at | timestamptz | NO   | now()             | trigger set_updated_at |

- **RLS:** `site_content_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `site_content_artist_id_key_key (artist_id, key)` UNIQUE; `site_content_artist_idx (artist_id, key)`.
- **Referenced (src):** `(dashboard)/actions.ts` (site text + SEO), `site/page.tsx`, `tools/seo/page.tsx`, `lib/site.ts`.

### Table: subscribers {#table-subscribers}

| Name       | Type        | Null | Default           | Notes |
| ---------- | ----------- | ---- | ----------------- | ----- |
| id         | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id  | uuid        | NO   | —                 | FK → artists(id) CASCADE; UNIQUE(artist_id, lower(email)) |
| email      | text        | NO   | —                 | CHECK len 3–320 |
| created_at | timestamptz | NO   | now()             |       |

- **RLS:** `subscribers_read` (SELECT): `is_admin() OR is_manager_of(artist_id)`. No write policy — ingest only via `subscribe()` (SECURITY DEFINER, anon, rate-limited 15/min/artist).
- **Indexes:** PK; `subscribers_artist_email_idx (artist_id, lower(email))` UNIQUE; `subscribers_artist_created_idx (artist_id, created_at DESC)`.
- **Referenced (src):** `book/page.tsx` (rollup + recent feed), `(dashboard)/subscribers/page.tsx` (per-artist list). `subscribe()` is called from `src/app/[slug]/actions.ts` (on-site popup) AND the external `skeen-website`.

### Table: tour_dates {#table-tour_dates}

| Name            | Type        | Null | Default           | Notes |
| --------------- | ----------- | ---- | ----------------- | ----- |
| id              | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id       | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| date            | date        | NO   | —                 | required (NOT NULL) |
| venue           | text        | YES  | —                 |       |
| city            | text        | YES  | —                 |       |
| country         | text        | YES  | —                 |       |
| ticket_url      | text        | YES  | —                 |       |
| source          | text        | NO   | 'manual'          | CHECK: manual/spotify/bandsintown/shopify/ticketmaster |
| created_at      | timestamptz | NO   | now()             |       |
| updated_at      | timestamptz | NO   | now()             | trigger set_updated_at |
| bandsintown_id  | text        | YES  | —                 |       |
| ticketmaster_id | text        | YES  | —                 |       |
| visible         | boolean     | NO   | true              | live on-site gate (20260707120000) |
| latitude        | float8      | YES  | —                 | tour-map prep; dashboard-only (not in public snapshot) |
| longitude       | float8      | YES  | —                 | tour-map prep; dashboard-only |

- **RLS:** `tour_dates_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Referenced (src):** `(dashboard)/layout.tsx` (on-tour badge). Editor via generic CRUD (`CRUD.tour_date`, required = `['date']`) + `reconcileVisibility`. `get_public_site` gates tour_dates on `visible`. Coords (`20260707140000_tour_coords.sql`) feed the not-yet-built map and ride under the Bandsintown compliance gate.

### Table: tracks {#table-tracks}

| Name             | Type        | Null | Default           | Notes |
| ---------------- | ----------- | ---- | ----------------- | ----- |
| id               | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id        | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| title            | text        | NO   | —                 |       |
| cover_url        | text        | YES  | —                 |       |
| spotify_id       | text        | YES  | —                 |       |
| stream_url       | text        | YES  | —                 |       |
| sort_order       | int         | NO   | 0                 |       |
| source           | text        | NO   | 'manual'          | CHECK: manual/spotify/bandsintown/shopify/apple/deezer |
| created_at       | timestamptz | NO   | now()             |       |
| updated_at       | timestamptz | NO   | now()             | trigger set_updated_at |
| deezer_id        | text        | YES  | —                 | link-out rebuilds from id; deezer link in `provider_url` |
| provider_url     | text        | YES  | —                 | legacy link col — now Deezer only (Apple moved to `apple_url`) |
| audio_path       | text        | YES  | —                 | path in the `audio` bucket (gated) |
| apple_id         | text        | YES  | —                 |       |
| apple_url        | text        | YES  | —                 | Apple/iTunes store link — added `20260708160000` (can't rebuild from id) |
| featured_artists | text[]      | NO   | '{}'              | Spotify collaborators (primary excluded) |
| album_name       | text        | YES  | —                 | Spotify album/EP/single title (legacy tracklist fallback) |
| duration_ms      | int         | YES  | —                 | added `20260708160000` — cross-platform merge match key + display |
| release_id       | uuid        | YES  | —                 | FK → releases(id) SET NULL (authoritative tracklist membership) |
| visible          | boolean     | NO   | true              | ⚠ prepped `20260708150000`, NOT yet gated / wired |

- **RLS:** `tracks_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `tracks_release_idx (release_id)`.
- **Referenced (src):** `track-audio-uploader.tsx` (audio_path), `(dashboard)/actions.ts` (`setTrackReleaseAction`), `lib/sync.ts`, `lib/tracks.ts`; editor via generic CRUD (`CRUD.track`). `release_id` (`20260706170000`) is the authoritative membership; `album_name` remains a fallback in `get_release()`. `visible` is prepped for the **Music restructure** (released/unreleased), not yet in `VISIBLE_ENTITIES` or the public door.
- **Union / multi-platform merge (`20260708160000`, `lib/sync.ts syncTracks`):** a track is a UNION row — one song carries every platform's id/link, and "which platforms is it on" is derived from which of `spotify_id`/`apple_id`/`deezer_id` is set. A pull refreshes the row bearing that platform's id, or STAMPS the platform onto the same song imported from another platform (matched by `normalizeTitle` + `duration_ms` ±3s), or inserts new — never duplicating or switching sources. Links: Spotify → `stream_url`, Apple → `apple_url`, Deezer → `provider_url` (or rebuilt from id). ⚠ `apple_url` is NOT yet in the `get_public_site` door / `content.ts` snapshot / `artist-site.tsx` render, so public Apple links won't show until threaded through (see CATALOG_MULTIPLATFORM_HANDOFF.md). The old MusicKit-token Apple client is gone — catalog reads use the free iTunes Search API (no credentials).

### Table: videos {#table-videos}

| Name             | Type        | Null | Default           | Notes |
| ---------------- | ----------- | ---- | ----------------- | ----- |
| id               | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id        | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| title            | text        | NO   | —                 |       |
| provider         | text        | NO   | —                 | CHECK: youtube/soundcloud/uploaded |
| embed_url        | text        | YES  | —                 | nullable now; CHECK (embed_url OR storage_path not null) |
| youtube_id       | text        | YES  | —                 |       |
| source           | text        | NO   | 'manual'          | CHECK: manual/youtube |
| sort_order       | int         | NO   | 0                 |       |
| created_at       | timestamptz | NO   | now()             |       |
| updated_at       | timestamptz | NO   | now()             | trigger set_updated_at |
| visible          | boolean     | NO   | true              | live on-site gate (20260707120000) |
| is_short         | boolean     | NO   | false             | YouTube Short classification |
| youtube_views    | bigint      | YES  | —                 | cached global view count |
| youtube_views_at | timestamptz | YES  | —                 | when the count was cached |
| storage_path     | text        | YES  | —                 | path in the `videos` bucket (provider='uploaded') |

- **RLS:** `videos_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `videos_artist_idx (artist_id, sort_order)`.
- **CHECK `videos_embed_or_storage`:** at least one of `embed_url` / `storage_path` is set. Uploaded videos carry `storage_path` + `provider='uploaded'`; embedded carry `embed_url`. Adds run through `embedInfo` / the upload flow (bespoke, not generic CRUD) + `reconcileVisibility`. **Referenced (src):** `video-add.tsx`, `(dashboard)/actions.ts` (rename/delete), `lib/storage-gc.ts` (orphan cleanup). `get_public_site` gates videos on `visible`. Migrations `20260625180000_videos.sql`, `20260708120000_video_upload.sql`.

---

## Views

### View: subscriber_counts_by_artist {#view-subscriber_counts_by_artist}

**Definition:** `security_invoker` view — `select artist_id, count(*) as subscriber_count, max(created_at) as latest_at from subscribers group by artist_id`.

| Name             | Type        | Null | Notes |
| ---------------- | ----------- | ---- | ----- |
| artist_id        | uuid        | YES  |       |
| subscriber_count | bigint      | YES  | JS: `Number(...)` |
| latest_at        | timestamptz | YES  |       |

- RLS from `subscribers` flows through (`security_invoker`): a manager sees only their roster. **Referenced (src):** `book/page.tsx`.

### View: manager_subscribers {#view-manager_subscribers}

**Definition:** `security_invoker` view — `subscribers ⋈ artists ⋈ artist_managers`, keyed by `manager_id (= artist_managers.user_id)`.

| Name        | Type        | Null | Notes |
| ----------- | ----------- | ---- | ----- |
| manager_id  | uuid        | YES  | filter by this for one manager's book |
| artist_id   | uuid        | YES  |       |
| artist_name | text        | YES  |       |
| artist_slug | text        | YES  |       |
| email       | text        | YES  | fan email |
| created_at  | timestamptz | YES  |       |

- Admin cross-manager reporting tool. **No caller yet** — ships ahead of its admin UI (`20260706130000_manager_book.sql`). `artist_managers` RLS (`user_id = auth.uid()`) prevents cross-manager identity leakage.

---

## Functions / RPCs

Grouped; all in `public`. `sd` = SECURITY DEFINER. All 8 anon doors below are executable by `anon`, `authenticated`, and `service_role`.

**Public doors (sd, anon-reachable):**
- `get_public_site(p_slug text) → jsonb` — full published site (gates videos/merch/tour_dates on live `visible`). ← `lib/site.ts`. ~11 create-or-replace across migrations; live def in `20260707200000_analytics_review_hardening.sql`.
- `get_release(p_artist_slug, p_release_slug) → jsonb` — one release smart-link + tracklist (by `release_id`, `album_name` fallback). ← `[slug]/r/[release]/page.tsx`.
- `get_public_releases(p_slug) → jsonb` — release list for the EPK. ← `[slug]/epk/page.tsx`.
- `audio_path_for_play(p_slug, p_track_id) → text` — gated audio path → signed URL. ← `lib/audio.ts`.
- `record_event(p_slug, p_type, p_target, p_entity_id, p_entity_type) → void` (v) — analytics ingest; `type`/`entity_type` allowlisted. ← `components/site-analytics.tsx`. ⚠ no per-IP/slug rate limit (TODO).
- `subscribe(p_slug, p_email) → void` (v) — subscriber ingest, dedup on `(artist_id, lower(email))`, 15/min/artist. ← `[slug]/actions.ts` + skeen-website.
- `submit_application(p_name, p_email, p_artist_name?, p_link?, p_notes?) → void` (v) — public /apply. ← `apply/actions.ts`.

**Manager RPCs (sd, volatile):**
- `connect_shopify(p_artist_id, p_domain, p_token) → void` — token → Vault. ← `(dashboard)/actions.ts`.
- `disconnect_shopify(p_artist_id) → void`. ← `(dashboard)/actions.ts`.
- `shopify_credentials(p_artist_id) → TABLE(store_domain, token)` — read-back for sync. ← `(dashboard)/actions.ts`.
- `switch_catalog_source(p_artist_id, p_next) → void` — clears the old source's imported tracks. ← `lib/catalog.ts`.

**Analytics (stable, SECURITY INVOKER):**
- `analytics_summary(p_artist_id, p_since) → TABLE(...)` — exact group-by. ← `roster-data.ts`, `(dashboard)/page.tsx`. ⚠ anon-executable via the PUBLIC default (INVOKER ⟹ no rows for anon); consider `revoke ... from public`.
- `analytics_daily(p_since, p_artist_id?) → TABLE(...)` — daily series for roster sparklines. ← `roster-data.ts`.
- `analytics_by_entity(p_artist_id, p_since) → TABLE(...)` — per-item engagement. ← `lib/analytics.ts` (`20260707160000_analytics_entity.sql`).
- `analytics_entity_daily(p_artist_id, p_entity_ids, p_since) → TABLE(...)` — per-entity daily series. ← `entity-sparkline.tsx` (`20260707180000_analytics_entity_daily.sql`).

**Internal / RLS / publish:**
- `is_admin() → boolean` — trusts the JWT `app_metadata.role` claim.
- `is_manager_of(target_artist_id) → boolean` (sd) — reads `artist_managers`. The isolation primitive; used inside nearly every RLS policy.
- `latest_revisions(p_artist_id) → TABLE(...)` — newest revision per entity incl tombstones. ← `lib/content.ts` (diffUnpublished).
- `published_revisions(p_artist_id, p_entity_type?) → TABLE(...)` (sd) — live view (tombstones removed); the seam public doors project over (`20260626120000_published_revisions_seam.sql`).
- `set_updated_at() → trigger` — BEFORE UPDATE on 8 tables (see Triggers).
- `rls_auto_enable() → event_trigger` (sd, `search_path=pg_catalog`) — auto-enables RLS on new `public` tables. Fired by event trigger **`ensure_rls`** (`ddl_command_end`, tags: CREATE TABLE / CREATE TABLE AS / SELECT INTO). ⚠ **live-only, in no migration** (exact def captured this run; can be added as a `create or replace function` + `drop/create event trigger` migration). The other 6 event triggers (`pgrst_ddl_watch`, `issue_*`, `issue_graphql_placeholder`) are Supabase platform-managed — do not capture.

**Triggers (all BEFORE UPDATE → `set_updated_at()`):** `artist_requests`, `links`, `merch`, `releases`, `site_content`, `tour_dates`, `tracks`, `videos`. (`media`, `subscribers`, `analytics_events`, `applications`, `profiles`, `artists`, `revisions` have no `updated_at`.)

---

## Storage Buckets

### Bucket: media {#bucket-media}

- **Config:** `public = true`; 500 MB limit (`524288000`); MIME allowlist `image/jpeg,png,webp,gif` + `video/mp4,webm,quicktime` (`20260708140000_media_bucket_caps.sql`).
- **Policies (storage.objects):** manager read/insert/update/delete gated `is_admin() OR is_manager_of(foldername[1]::uuid)` — path is `{artist_id}/…`. The old anon `media public read` policy was **removed** (`20260708120000`) — that only stopped `.list()` enumeration; because the bucket is `public=true`, objects remain fetchable by direct `/object/public/media/...` URL (draft/unpublished media included).
- **Used in:** `media-uploader.tsx` (upload/remove), `(dashboard)/actions.ts` (`deleteMediaAction`). Backs the `media` table's `storage_path`.

### Bucket: audio {#bucket-audio}

- **Config:** `public = false`; 30 MB limit (`31457280`); MIME allowlist `audio/mpeg`, `audio/mp4`.
- **Policies (storage.objects):** manager read/insert/update/delete gated `is_admin() OR is_manager_of(foldername[1]::uuid)`. No public read — anon playback goes through `audio_path_for_play()` (signed URL, 1h).
- **Used in:** `track-audio-uploader.tsx` (upload/remove); served via `lib/audio.ts` → `audio_path_for_play`.

### Bucket: videos {#bucket-videos}

- **Config:** `public = true`; 500 MB limit (`524288000`); MIME allowlist `video/mp4,webm,quicktime` (`20260708120000_video_upload.sql`).
- **Policies (storage.objects):** manager read/insert/update/delete gated `is_admin() OR is_manager_of(foldername[1]::uuid)` on path `{artist_id}/videos/*`. **No anon SELECT** (blocks `.list()` enumeration); public playback via `/object/public/videos/...` since the bucket is public.
- **Used in:** `videos/video-add.tsx` (upload), `lib/storage-gc.ts` (list/remove orphans on publish). Backs `videos.storage_path` for `provider='uploaded'`. Shares its name with the `videos` table.

---

## Inconsistencies (verifier output)

1. **Re-baselined (FULL_REVIEW).** Live DB is truth; the prior file (last_migration_seen `20260706133000`) missed 14 migrations. Now aligned: 17 tables · 2 views · 21 functions · 3 buckets. Every table is referenced in code (no dead-schema table); every `rpc()`-called function exists live (no broken calls); all 15 FKs resolve (14 → `artists`, 1 `tracks.release_id → releases`).
2. **`rls_auto_enable` / `ensure_rls`** — live-only object, in no migration. Exact def captured this run. Note the event trigger is named `ensure_rls` (not `rls_auto_enable`); a capture migration must `create or replace function` then `drop event trigger if exists ensure_rls; create event trigger ensure_rls ...` (event triggers can't be `create or replace`d).
3. **`tracks.visible` / `links.visible` prepped but unwired** (`20260708150000`). Columns exist, default true, but are NOT in `VISIBLE_ENTITIES`/`reconcileVisibility` nor gated in `get_public_site`. Deliberate — they land with the Music restructure (released/unreleased). Until then they are effectively inert (same posture `tour_coords` had before the map).
4. **Dual tracklist membership.** `tracks.release_id` (FK, authoritative) coexists with the `album_name` string-match fallback still used by `get_release()`. Kill the fallback during the Music restructure.
5. **`analytics_summary` anon-executable** via the PUBLIC default execute (the migration granted `authenticated` but never `revoke ... from public`). It is SECURITY INVOKER, so anon gets no rows under RLS — cosmetic, but tighten with an explicit revoke.
6. **`gallery_image` media purpose** is defined in the CHECK but has no UI (unused). Not dead schema, but unwired.
7. **`media` bucket is `public=true`.** Removing the anon read policy stopped enumeration only; any object is still reachable by direct public URL if the path is known. Acceptable by design (matches the pre-existing posture), not "private."
