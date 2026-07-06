---
last_full_scan: 2026-07-06T00:00:00Z
last_full_scan_commit: d4e77d4
last_migration_seen: 20260706133000
last_incremental_update: 2026-07-06T00:00:00Z
generated_by: /steaksauce
---

# steaksauce — Live DB ↔ Codebase Map

**Generated:** 2026-07-06 · **Last full scan:** commit `a4fb3b9`
**Migrations seen:** `20260623162707` … `20260706133000` (34 files in `supabase/migrations/`)
**Live schema:** 17 tables · 2 views · 20 functions · 2 storage buckets · RLS on every base table

> Structure only — this file documents the *shape* of the database, never row data.
> Multi-tenant model: tenant = **artist**; isolation is Postgres RLS via `is_manager_of(artist_id)` / `is_admin()` (ADR-0001). Every content table carries `artist_id → artists(id) ON DELETE CASCADE`.

---

## Table of Contents

### Tables (17)
- [analytics_events](#table-analytics_events) — created by migrations only; written via `record_event()`
- [applications](#table-applications) — admin/applications page + `submit_application()`
- [artist_managers](#table-artist_managers) — the isolation join (who manages whom); no direct src refs (used inside RLS)
- [artist_requests](#table-artist_requests) — `src/app/actions.ts`, `roster/page.tsx`
- [artists](#table-artists) — the tenant; referenced across `_data.ts`, `actions.ts`, `content.ts`, `site.ts`, `roster-data.ts`
- [integrations](#table-integrations) — `_data.ts` (Shopify domain); written via `connect_shopify` / `disconnect_shopify`
- [links](#table-links) — via generic CRUD (`content.ts`, dynamic table name)
- [media](#table-media) — `media-uploader.tsx`, `site/page.tsx`, `site.ts` (table); also a storage **bucket**
- [merch](#table-merch) — via generic CRUD (`content.ts`)
- [profiles](#table-profiles) — admin/manager role; used inside `is_admin()`
- [releases](#table-releases) — `actions.ts` (release + links editor)
- [revisions](#table-revisions) — the publish log; `content.ts` (publish/diff), public doors
- [site_content](#table-site_content) — `actions.ts`, `site/page.tsx`, `site.ts`
- [subscribers](#table-subscribers) — `book/page.tsx`, `subscribers/page.tsx`; ingest via `subscribe()`
- [tour_dates](#table-tour_dates) — `layout.tsx` (on-tour badge); via generic CRUD
- [tracks](#table-tracks) — `track-audio-uploader.tsx`; via generic CRUD; Spotify featured_artists/album_name
- [videos](#table-videos) — via generic CRUD

### Views (2)
- [subscriber_counts_by_artist](#view-subscriber_counts_by_artist) — `book/page.tsx` (the Book)
- [manager_subscribers](#view-manager_subscribers) — admin cross-manager tool (no caller yet)

### Functions / RPCs (20)
Public doors (SECURITY DEFINER, anon-reachable): `get_public_site`, `get_release`, `get_public_releases`, `audio_path_for_play`, `record_event`, `subscribe`, `submit_application`.
Manager RPCs: `connect_shopify`, `disconnect_shopify`, `shopify_credentials`, `switch_catalog_source`.
Analytics: `analytics_summary`, `analytics_daily`.
Internal/RLS/publish: `is_admin`, `is_manager_of`, `latest_revisions`, `published_revisions`, `set_updated_at` (trigger), `rls_auto_enable` (event trigger).

### Storage Buckets (2)
- [media](#bucket-media) — public; `media-uploader.tsx`
- [audio](#bucket-audio) — private, gated; `track-audio-uploader.tsx`, served via `audio_path_for_play`

### Inconsistencies flagged
- **Resolved** — `20260706133000_track_features_album.sql` (`tracks.featured_artists`, `tracks.album_name`) + its code (`content.ts`, `spotify.ts`, `sync.ts`, `sync.test.ts`) committed in `d4e77d4`. Live DB and git now agree.
- **`subscribe()` has no caller in this repo's `src/`** — the anon signup ingest is likely wired from the external `skeen-website`. (verify)
- **`rls_auto_enable`** — live-DB-only event-trigger function, no codebase reference (expected utility; keep).
- Tables `links`, `merch`, `videos`, `tracks` have few/no literal `from('…')` refs because they're reached through the **generic CRUD layer** (`src/lib/content.ts`, dynamic table name from the `PUBLISHABLE` registry). Not dead schema.

---

## Tables

### Table: analytics_events {#table-analytics_events}

| Name       | Type        | Null | Default           | Notes |
| ---------- | ----------- | ---- | ----------------- | ----- |
| id         | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id  | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| type       | text        | NO   | —                 | CHECK: view/link_click/ticket_click/buy_click/play |
| target     | text        | YES  | —                 |       |
| created_at | timestamptz | NO   | now()             |       |

- **RLS:** `analytics_read` (SELECT): `is_admin() OR is_manager_of(artist_id)`. Writes only via `record_event()` (SECURITY DEFINER) — no INSERT policy.
- **Indexes:** `analytics_events_artist_idx (artist_id, created_at)`, PK on `id`.
- **Read by:** `analytics_summary()`, `analytics_daily()`. **Referenced:** migrations only in src (aggregated through the two analytics RPCs).

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
- **Indexes:** `applications_created_idx (created_at DESC)`, PK.
- **Referenced:** `src/app/admin/applications/{page.tsx,actions.ts}`; `submit_application()` ← `src/app/apply/actions.ts`.

### Table: artist_managers {#table-artist_managers}

| Name      | Type | Null | Default | Notes |
| --------- | ---- | ---- | ------- | ----- |
| user_id   | uuid | NO   | —       | PK(1); FK → auth.users(id) CASCADE |
| artist_id | uuid | NO   | —       | PK(2); FK → artists(id) CASCADE |

- **The isolation join** — `is_manager_of(target)` reads this. Composite PK `(user_id, artist_id)`; many-to-many.
- **RLS:** `artist_managers_select` (SELECT): `is_admin() OR user_id = auth.uid()`; `artist_managers_admin_write` (ALL): `is_admin()`.
- **Indexes:** PK `(user_id, artist_id)`, `artist_managers_user_idx (user_id)`.
- **Referenced:** `20260706130000_manager_book.sql` (the `manager_subscribers` view joins it). No direct src refs — used inside RLS + the Book's rollup.

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
- **Indexes:** PK, `artist_requests_requested_by_idx (requested_by, created_at DESC)`.
- **Referenced:** `src/app/actions.ts` (insert), `src/app/roster/page.tsx` (list; tolerates 42P01).

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

- **The tenant.** RLS: `artists_select`/`artists_update`: `is_admin() OR is_manager_of(id)`; insert/delete admin-only.
- **Indexes:** PK, `artists_slug_key (slug)` UNIQUE.
- **Referenced (src):** `_data.ts` (`requireArtist`), `roster-data.ts` (`ownedArtists`), `(dashboard)/actions.ts` (many: id saves, template, catalog), `lib/site.ts`, `lib/content.ts`. The integration-id columns are the backing store for the `INTEGRATIONS` registry (`isConnected`).

### Table: integrations {#table-integrations}

| Name       | Type        | Null | Default    | Notes |
| ---------- | ----------- | ---- | ---------- | ----- |
| id         | uuid        | NO   | gen_random_uuid() | PK |
| artist_id  | uuid        | NO   | —          | FK → artists(id) CASCADE; UNIQUE(artist_id, provider) |
| provider   | text        | NO   | —          | UNIQUE(artist_id, provider) |
| secret_ref | text        | YES  | —          | Vault ref (Shopify storefront token) |
| metadata   | jsonb       | NO   | '{}'       | e.g. `{store_domain}` |
| created_at | timestamptz | NO   | now()      |       |

- **RLS:** `integrations_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK, `integrations_artist_id_provider_key (artist_id, provider)` UNIQUE.
- **Touched by:** `connect_shopify` / `disconnect_shopify` / `shopify_credentials` (SECURITY DEFINER). **Referenced (src):** `(dashboard)/_data.ts` (`getShopifyDomain` reads `metadata`).

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

- **RLS:** `links_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Reached via** the generic CRUD layer (`content.ts`, `CRUD.link`) — dynamic table name, so no literal `from('links')`.

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
- **Indexes:** PK, `media_artist_idx (artist_id, purpose, sort_order)`.
- **Publishable** (`PUBLISHABLE.media`, edited via its own uploader — ADR-0003). **Referenced (src):** `media-uploader.tsx`, `site/page.tsx`, `lib/site.ts`, `(dashboard)/actions.ts`. Shares its name with the `media` storage bucket.

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

- **RLS:** `merch_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`. Reached via generic CRUD (`CRUD.merch`).

### Table: profiles {#table-profiles}

| Name       | Type        | Null | Default    | Notes |
| ---------- | ----------- | ---- | ---------- | ----- |
| user_id    | uuid        | NO   | —          | PK; FK → auth.users(id) CASCADE |
| role       | text        | NO   | 'manager'  | CHECK: admin/manager |
| created_at | timestamptz | NO   | now()      |       |

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

- **RLS:** `releases_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK, `releases_artist_id_slug_key (artist_id, slug)` UNIQUE, `releases_artist_idx (artist_id, sort_order)`.
- **Referenced (src):** `(dashboard)/actions.ts` (release + `links` jsonb editor). Public smart-link via `get_release()`, `get_public_releases()`.

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
- **Indexes:** PK, `revisions_lookup_idx (artist_id, entity_type, entity_id, published_at DESC)`.
- **Read by:** `latest_revisions()`, `published_revisions()` (the seam every public door projects over). **Referenced (src):** `lib/content.ts` (publish/diff).

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
- **Indexes:** PK, `site_content_artist_id_key_key (artist_id, key)` UNIQUE, `site_content_artist_idx (artist_id, key)`.
- **Referenced (src):** `(dashboard)/actions.ts`, `site/page.tsx`, `lib/site.ts`.

### Table: subscribers {#table-subscribers}

| Name       | Type        | Null | Default           | Notes |
| ---------- | ----------- | ---- | ----------------- | ----- |
| id         | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id  | uuid        | NO   | —                 | FK → artists(id) CASCADE; UNIQUE(artist_id, lower(email)) |
| email      | text        | NO   | —                 | CHECK len 3–320 |
| created_at | timestamptz | NO   | now()             |       |

- **RLS:** `subscribers_read` (SELECT): `is_admin() OR is_manager_of(artist_id)`. No write policy — ingest only via `subscribe()` (SECURITY DEFINER, anon).
- **Indexes:** PK, `subscribers_artist_email_idx (artist_id, lower(email))` UNIQUE, `subscribers_artist_created_idx (artist_id, created_at DESC)`.
- **Referenced (src):** `book/page.tsx` (rollup + recent feed), `(dashboard)/subscribers/page.tsx` (per-artist list). ⚠ `subscribe()` itself has no `rpc()` caller in this repo — see Inconsistencies.

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

- **RLS:** `tour_dates_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Referenced (src):** `(dashboard)/layout.tsx` (on-tour badge counts upcoming). Editor via generic CRUD (`CRUD.tour_date`, required = `['date']`).

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
| deezer_id        | text        | YES  | —                 |       |
| provider_url     | text        | YES  | —                 |       |
| audio_path       | text        | YES  | —                 | path in the `audio` bucket (gated) |
| apple_id         | text        | YES  | —                 |       |
| featured_artists | text[]      | NO   | '{}'              | Spotify collaborators (primary excluded) |
| album_name       | text        | YES  | —                 | Spotify album/EP/single title |

- **RLS:** `tracks_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Referenced (src):** `track-audio-uploader.tsx` (audio_path); editor via generic CRUD (`CRUD.track`). `featured_artists`/`album_name` are populated by `lib/spotify.ts` + `lib/sync.ts` and published via the track snapshot (`content.ts`).

### Table: videos {#table-videos}

| Name       | Type        | Null | Default           | Notes |
| ---------- | ----------- | ---- | ----------------- | ----- |
| id         | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id  | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| title      | text        | NO   | —                 |       |
| provider   | text        | NO   | —                 | CHECK: youtube/soundcloud |
| embed_url  | text        | NO   | —                 |       |
| youtube_id | text        | YES  | —                 |       |
| source     | text        | NO   | 'manual'          | CHECK: manual/youtube |
| sort_order | int         | NO   | 0                 |       |
| created_at | timestamptz | NO   | now()             |       |
| updated_at | timestamptz | NO   | now()             | trigger set_updated_at |

- **RLS:** `videos_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK, `videos_artist_idx (artist_id, sort_order)`.
- Adds run through `embedInfo` (bespoke, not generic CRUD); the generic path only touches title/sort_order.

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

- Admin cross-manager reporting tool. **No caller yet** — ships ahead of its admin UI. `artist_managers` RLS (`user_id = auth.uid()`) prevents cross-manager identity leakage.

---

## Functions / RPCs

Grouped; all in `public`. `sd` = SECURITY DEFINER.

**Public doors (sd, anon-reachable):**
- `get_public_site(p_slug text) → jsonb` — full published site. ← `lib/site.ts`.
- `get_release(p_artist_slug, p_release_slug) → jsonb` — one release smart-link. ← `[slug]/r/[release]/page.tsx`.
- `get_public_releases(p_slug) → jsonb` — release list for the EPK. ← `[slug]/epk/page.tsx`.
- `audio_path_for_play(p_slug, p_track_id) → text` — gated audio path. ← `lib/audio.ts`.
- `record_event(p_slug, p_type, p_target) → void` — analytics ingest. ← `components/site-analytics.tsx`.
- `subscribe(p_slug, p_email) → void` — subscriber ingest, dedup on `(artist_id, lower(email))`. ⚠ no `rpc()` caller in this repo.
- `submit_application(p_name, p_email, p_artist_name?, p_link?, p_notes?) → void` — public /apply. ← `apply/actions.ts`.

**Manager RPCs (sd):**
- `connect_shopify(p_artist_id, p_domain, p_token) → void` — token → Vault. ← `(dashboard)/actions.ts`.
- `disconnect_shopify(p_artist_id) → void`. ← `(dashboard)/actions.ts`.
- `shopify_credentials(p_artist_id) → TABLE(store_domain, token)` — read-back for sync. ← `(dashboard)/actions.ts`.
- `switch_catalog_source(p_artist_id, p_next) → void` — clears the old source's imported tracks. ← `lib/catalog.ts`.

**Analytics (stable):**
- `analytics_summary(p_artist_id, p_since) → TABLE(type, count)` — exact group-by. ← `roster-data.ts`, `(dashboard)/page.tsx`.
- `analytics_daily(p_since, p_artist_id?) → TABLE(artist_id, day, views)` — daily series for sparklines. ← `roster-data.ts`.

**Internal / RLS / publish:**
- `is_admin() → boolean` — trusts the JWT `app_metadata.role` claim.
- `is_manager_of(target_artist_id) → boolean` (sd) — reads `artist_managers`. The isolation primitive; used inside nearly every RLS policy.
- `latest_revisions(p_artist_id) → TABLE(...)` — newest revision per entity incl tombstones. ← `lib/content.ts`.
- `published_revisions(p_artist_id, p_entity_type?) → TABLE(...)` (sd) — live view (tombstones removed); the seam public doors project over.
- `set_updated_at() → trigger` — BEFORE UPDATE on 8 tables (see Triggers).
- `rls_auto_enable() → event_trigger` (sd) — auto-enables RLS on new tables. ⚠ live-DB-only, no codebase reference.

**Triggers (all BEFORE UPDATE → `set_updated_at()`):** `artist_requests`, `links`, `merch`, `releases`, `site_content`, `tour_dates`, `tracks`, `videos`.

---

## Storage Buckets

### Bucket: media {#bucket-media}

- **Config:** public, no size limit, no MIME allowlist.
- **Policies (storage.objects):** `media public read` (SELECT: `bucket_id='media'`); manager insert/update/delete gated `is_admin() OR is_manager_of(foldername[1]::uuid)` — path is `{artist_id}/…`.
- **Used in:** `media-uploader.tsx` (upload/remove). Backs the `media` table's `storage_path`.

### Bucket: audio {#bucket-audio}

- **Config:** private, 30 MB limit (`31457280`), MIME allowlist `audio/mpeg`, `audio/mp4`.
- **Policies (storage.objects):** manager read/insert/update/delete gated `is_admin() OR is_manager_of(foldername[1]::uuid)`. No public read — anon playback goes through `audio_path_for_play()` (signed URL).
- **Used in:** `track-audio-uploader.tsx` (upload/remove); served via `audio_path_for_play`.

---

## Inconsistencies (verifier output)

1. **Resolved — track features/album.** Live `tracks` has `featured_artists text[] NOT NULL DEFAULT '{}'` and `album_name text` (applied on the remote); the migration `20260706133000_track_features_album.sql` and its code (`content.ts`, `spotify.ts`, `sync.ts`, `sync.test.ts`) were committed in `d4e77d4`. Live DB and git now agree. (Was: uncommitted; caught up during this run.)
2. **`subscribe()` has no `rpc('subscribe')` caller in `src/`.** The anon subscriber-ingest door exists and is granted to anon/authenticated, but the calling signup form appears to live in the external `skeen-website` project (content-in/analytics-out wiring), not this repo. Verify the popup is wired before relying on `/book` filling up.
3. **`rls_auto_enable`** — live-DB-only event-trigger function with no reference in `src/` or `supabase/migrations/` in this scan. Expected utility (auto-enables RLS on new public tables); keep, no action.
4. **No dead schema.** `links`, `merch`, `videos`, and the generic parts of `tracks`/`tour_dates` show few literal `from('…')` refs because they are reached through the generic CRUD layer (`src/lib/content.ts`, table name resolved from the `PUBLISHABLE`/`CRUD` registries). All 17 tables are live-referenced. All 14 `artist_id` FKs resolve to `artists(id)`.
