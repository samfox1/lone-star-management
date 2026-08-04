---
last_full_scan: 2026-07-08T00:00:00Z
last_full_scan_commit: 9f6728b
last_migration_seen: 20260804270000
last_incremental_update: 2026-08-04T00:00:00Z
generated_by: /steaksauce
---

# steaksauce — Live DB ↔ Codebase Map

**Generated:** 2026-08-04 (INCREMENTAL) · **Last full scan:** commit `9f6728b` (2026-07-08)
**Migrations seen:** `20260623162707` … `20260804270000` (101 files in `supabase/migrations/`; local = remote, verified)
**Live schema:** 23 tables · 2 views · 30 functions · 5 storage buckets · RLS on every base table

> Structure only — this file documents the *shape* of the database, never row data.
> Multi-tenant model: tenant = **artist**; isolation is Postgres RLS via `is_manager_of(artist_id)` / `is_admin()` (ADR-0001). Every content table carries `artist_id → artists(id) ON DELETE CASCADE`.

---

## Table of Contents

### Tables (23)
- [analytics_events](#table-analytics_events) — written via `record_event()`; read via the analytics RPCs
- [applications](#table-applications) — admin/applications page + `submit_application()`
- [artist_mail_settings](#table-artist_mail_settings) — **NEW** `20260722120000`; per-artist mail overrides; read ONLY inside `resolve_booking_recipient` SQL
- [artist_managers](#table-artist_managers) — the isolation join (who manages whom); read inside `is_manager_of()`
- [artist_requests](#table-artist_requests) — `src/app/actions.ts`, `roster/page.tsx`
- [artists](#table-artists) — the tenant; `_data.ts`, `actions.ts`, `content.ts`, `site.ts`, `roster-data.ts`
- [contact_attempts](#table-contact_attempts) — **NEW** `20260722120000`; rate-limit ledger; written ONLY via `submit_enquiry`/`log_contact_attempt`
- [enquiries](#table-enquiries) — **NEW** `20260722120000`; contact-form messages; `enquiries/page.tsx`, `artists/page.tsx`, the contact Edge Function
- [enquiry_attachments](#table-enquiry_attachments) — **NEW** `20260804190000`; demo audio metadata; `enquiries/actions.ts`, `enquiry-inbox-server.ts`, Edge Function
- [integrations](#table-integrations) — `_data.ts` (Shopify domain); written via `connect_shopify` / `disconnect_shopify`
- [links](#table-links) — generic CRUD (`content.ts`); `on_site` gated + editor toggle since `20260714160000`; `role` (booking) since `20260721120000`
- [mail_settings](#table-mail_settings) — **NEW** `20260722120000`; singleton mail config (boolean PK); admin-only; read inside `resolve_booking_recipient`
- [media](#table-media) — `media-uploader.tsx`, `site/page.tsx`, `site.ts`, `brand.ts`; also a storage **bucket**
- [merch](#table-merch) — via generic CRUD (`content.ts`) + `reconcileOnSite`
- [profiles](#table-profiles) — admin/manager role; used inside `is_admin()`
- [releases](#table-releases) — `actions.ts` (release + links + type editor), `sync.ts`
- [revisions](#table-revisions) — the publish log; `content.ts` (publish/diff), `storage-gc.ts`, public doors
- [site_content](#table-site_content) — `actions.ts`, `site/page.tsx`, `seo/page.tsx`, `site.ts`
- [site_styles](#table-site_styles) — **NEW** `20260714120000`; per-region class names; `site.ts`, editor
- [subscribers](#table-subscribers) — `book/page.tsx`, `subscribers/page.tsx`; ingest via `subscribe()`
- [tour_dates](#table-tour_dates) — `layout.tsx` (on-tour badge); generic CRUD + `reconcileOnSite`
- [tracks](#table-tracks) — `track-audio-uploader.tsx`; generic CRUD; `on_site` gated (live toggle)
- [videos](#table-videos) — generic CRUD (bespoke add) + `reconcileOnSite`; uploaded + embedded

> **`visible` → `on_site`** (`20260714150000`): the flag was renamed on all 7 tables that carry it
> (`releases`, `videos`, `merch`, `tour_dates`, `tracks`, `links`, `media`) to match the language the
> UI and code already used. Pure rename — defaults/nullability/values unchanged. **No table has a
> `visible` column any more.**

### Views (2)
- [subscriber_counts_by_artist](#view-subscriber_counts_by_artist) — `book/page.tsx` (the Book)
- [manager_subscribers](#view-manager_subscribers) — admin cross-manager tool (no caller yet)

### Functions / RPCs (30)
Public doors (SECURITY DEFINER, anon-reachable): `get_public_site`, `get_release`, `get_public_releases`, `audio_path_for_play`, `record_event`, `subscribe`, `submit_application`, `public_custom_site` (**NEW** `20260714170000`).
Contact door (service_role-only, called by the `contact` Edge Function — the ONE public entry that is not a SECURITY DEFINER anon grant, see ADR 0010): `submit_enquiry`, `log_contact_attempt`, `mark_enquiry_sent` (**NEW** `20260722130000`). Recipient ladder (sd): `resolve_booking_recipient` (internal), `booking_recipient_preview` (manager banner).
Manager RPCs: `connect_shopify`, `disconnect_shopify`, `shopify_credentials`, `reorder_rows` (amended for `releases` + `tour_dates` — `20260723120000`/`20260725120000`), `set_release_link` (**NEW** `20260727190000`). (`switch_catalog_source` was DROPPED — `20260708161000`; verified absent from the live DB and from `src/` on 2026-07-14.)
Analytics: `analytics_summary`, `analytics_daily`, `analytics_by_entity`, `analytics_entity_daily`.
Internal / RLS / publish: `is_admin`, `is_manager_of`, `latest_revisions`, `published_revisions`, `set_updated_at` (trigger fn), `rls_auto_enable` (event-trigger fn, fired by event trigger `ensure_rls`).
Music classification (IMMUTABLE, internal — not client-callable; SQL mirror of `lib/music.ts`): `music_release_is_released(jsonb)`, `music_track_on_platform(jsonb)` — added `20260709120000`, amended `20260710130000`/`140000` to include the stored `released` flag.

### Storage Buckets (5)
- [media](#bucket-media) — public bucket; 500 MB cap + MIME allowlist; `media-uploader.tsx`, `brand/*`, `song-add.tsx`
- [audio](#bucket-audio) — private, gated; `track-audio-uploader.tsx`, served via `audio_path_for_play`
- [videos](#bucket-videos) — public bucket; 500 MB cap + MIME allowlist; `video-add.tsx`, `storage-gc.ts`
- [documents](#bucket-documents) — **NEW** `20260804140000`; private, PDF-only, 10 MB; press documents (stage plot + rider)
- [enquiry-attachments](#bucket-enquiry-attachments) — **NEW** `20260804190000`; private, audio-only, 25 MB; demo files via one-shot signed tickets

### Inconsistencies flagged
- **Incremental update 2026-08-04** — folded in 37 migrations `20260714170000` … `20260804270000` (contact enquiries + attachments, EPK/press kit, brand/favicon, tour-date fields, media/video site roles, links role, per-song music model). Zero adjudication-worthy drift — every change traced to an applied migration; see the Drift report. Headline: the per-artist flood cap was silently lost in a `submit_enquiry` rewrite and restored `20260804270000`.
- **Incremental update 2026-07-14** — folded in migrations `20260710170000` … `20260714160000` (tracks decoupled from Released, `reorder_rows`, gallery selection, `site_styles` + custom-site columns, the `get_release` on-site gate, analytics door hardening, the `visible`→`on_site` rename, the links gate). All 7 drift items resolved DB-is-truth; see the Drift report.
- **`rls_auto_enable` / `ensure_rls`** — live-only, in no migration; the codebase index finds **zero** references in `src/` or `supabase/migrations/`. Deliberate: `TODO.md` records the 2026-07-08 decision NOT to capture it, because `CREATE EVENT TRIGGER` needs superuser and a failed `db push` could leave the live RLS safety net dropped. Exact def is captured under Functions if a from-scratch rebuild is ever needed. **Not a bug — don't "fix" it.**
- **Redundant indexes on the two key/value tables** — `site_styles_artist_idx` is btree `(artist_id, region_key)`, identical to the index its `unique (artist_id, region_key)` constraint already creates (`site_styles_artist_id_region_key_key`). `site_content` has the same duplication (`site_content_artist_idx` vs `site_content_artist_id_key_key`) — `site_styles` was modeled on `site_content` and inherited it, so this is a copied pattern, not a one-off. Harmless but pure write overhead on every insert/update; drop both explicit indexes when convenient (`20260714120000:25`, `20260624180000`).
- **Off-site ≠ private (storage).** `media` and `videos` are `public = true`, so `/object/public/…` bypasses RLS: verified 2026-07-14 that an anon HEAD on a real object returns **200** regardless of `on_site`. The flag gates *discovery* (the row leaves `get_public_site`), never *access* — taking an asset off the site does not revoke its URL. Enumeration IS closed (both buckets scope storage SELECT to the owning manager; anon `.list()` returns `[]` at every level). Sam confirmed some uploads are unreleased/sensitive → tracked in `TODO.md` with three costed options.
- **`subscribe()` has no `rpc()` caller in this repo** — invoked from the external `skeen-website` (confirmed). `src/app/[slug]/actions.ts` calls it for the on-site popup.
- **Verifier: clean otherwise.** All 18 tables have ≥1 codebase reference (no dead schema); every function reached by `rpc()` from `src/` exists in the live DB (no broken calls); all FKs resolve.

**Resolved since the last run** (kept briefly for continuity, delete next full scan):
- ~~`tracks.visible` / `links.visible` dormant~~ — `tracks` was wired `20260710170000`; `links` wired `20260714160000` (door gate + editor toggle). Both renamed to `on_site`.
- ~~`analytics_summary` anon-executable via the PUBLIC default~~ — revoked `20260714140000`.
- ~~`switch_catalog_source` listed as a live function~~ — this file contradicted itself (the ToC said DROPPED, the Functions section listed it with a `lib/catalog.ts` caller). It is gone from the DB, `src/lib/catalog.ts` does not exist, and `src/` has zero references. Entry removed.
- **Tracklist membership** is `tracks.release_id` FK ONLY — the `album_name` string-match fallback was removed (`20260709120000`). `album_name` survives as legacy display-only, read by skeen-website as a title fallback; now annotated as such in `content.ts`.

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

### Table: artist_mail_settings {#table-artist_mail_settings}

| Name               | Type        | Null | Default | Notes |
| ------------------ | ----------- | ---- | ------- | ----- |
| artist_id          | uuid        | NO   | —       | PK; FK → artists(id) CASCADE |
| from_name          | text        | YES  | —       | CHECK: 1-100 chars, no CR/LF (SMTP header injection) |
| sending_domain     | text        | YES  | —       | CHECK: domain shape |
| from_local_part    | text        | YES  | —       | CHECK: `^[a-z0-9._-]{1,64}$` |
| resend_domain_id   | text        | YES  | —       | future per-artist Resend domain |
| domain_verified_at | timestamptz | YES  | —       |       |
| booking_email      | text        | YES  | —       | CHECK: email shape; rung 1 (ops override) of the recipient ladder |
| created_at         | timestamptz | NO   | now()   |       |
| updated_at         | timestamptz | NO   | now()   |       |

- **RLS:** `ams_read` (SELECT): `is_admin() OR is_manager_of(artist_id)`; `ams_admin_write` (ALL): `is_admin()`.
- **Referenced (src): ZERO.** Read exclusively inside `resolve_booking_recipient`'s ladder and `submit_enquiry`'s sender-identity join, in SQL. Deliberate — the recipient must resolve server-side so the contact endpoint never learns or echoes it. A future admin mail-settings UI will be its first code caller.
- **Migrations:** `20260722120000_contact_enquiries.sql` (created).

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
| drive_folder_id            | text        | YES  | —                 | link-shared Google Drive folder id for copy-import — added `20260710120000` |
| site_kind                  | text        | NO   | 'template'        | CHECK: template/custom — added `20260714120000` |
| custom_site_url            | text        | YES  | —                 | redirect target when site_kind='custom' — added `20260714120000` |
| soundcloud_url             | text        | YES  | —                 | artist-level SoundCloud link — added `20260728120000` |
| press_pitch                | text        | YES  | —                 | one-line EPK positioning — added `20260804120000` |
| press_quotes               | jsonb       | NO   | '[]'              | CHECK: jsonb array; `{quote, source?, url?}[]` — added `20260804120000` |
| tech_rider_path            | text        | YES  | —                 | path in the private `documents` bucket — added `20260804140000` |
| stage_plot_path            | text        | YES  | —                 | path in the private `documents` bucket — added `20260804140000` |
| favicon_zoom               | real        | YES  | —                 | CHECK: 1..6; NULL = never adjusted — added `20260804160000` |
| favicon_offset_y           | real        | YES  | —                 | CHECK: -1..1 — added `20260804160000` |

- **The tenant.** RLS: `artists_select` / `artists_update`: `is_admin() OR is_manager_of(id)`; insert/delete admin-only.
- **`site_kind` / `custom_site_url`** (`20260714120000`, SITE_STYLING_PLAN.md D-F): an artist's public site is either a built-in template or a fully custom site hosted elsewhere (e.g. the Vercel skeen-website), in which case `/[slug]` redirects to `custom_site_url`. These are CONFIG, not draft/publish content, so they are deliberately **not** in `ARTIST_SNAPSHOT`.
- **Press-kit fields** (`20260804120000`/`140000`): `press_pitch` + `press_quotes` are in `ARTIST_SNAPSHOT` (publish-gated, parsed defensively by `parsePressQuotes` — `url` is https-validated on write AND nulled on read). The two `*_path` document columns are LIVE config, deliberately NOT snapshotted: the PDF is built fresh on click and the documents never leave the private bucket except merged into it.
- **Brand/favicon** (`20260804160000`): `favicon_zoom`/`favicon_offset_y` frame the derived tab icon; the logos themselves are `media` rows (purposes `logo_primary`/`logo_secondary`/`favicon`). DB CHECKs mirror the clamps in `lib/brand.ts` for writers that bypass it.
- **Indexes:** PK; `artists_slug_key (slug)` UNIQUE.
- **Referenced (src):** `_data.ts` (`requireArtist`), `roster-data.ts` (`ownedArtists`), `(dashboard)/actions.ts` (id saves, template, catalog, `saveDriveFolderAction` — the `saveArtistField` helper updates one id column), `lib/site.ts`, `lib/content.ts`, `lib/drive.ts`, `lib/epk.ts` (`savePressKit`, `setPressDocument`), `lib/brand.ts` (`saveFraming`/`loadFraming`), `epk/download/route.ts`. The integration-id columns back the `INTEGRATIONS` registry (`isConnected`).

### Table: contact_attempts {#table-contact_attempts}

| Name       | Type        | Null | Default | Notes |
| ---------- | ----------- | ---- | ------- | ----- |
| id         | bigint      | NO   | identity | PK   |
| slug       | text        | YES  | —       | as submitted (kept even for unknown artists) |
| artist_id  | uuid        | YES  | —       | FK → artists(id) SET NULL |
| purpose    | text        | YES  | —       |       |
| ip_hash    | text        | NO   | —       | CHECK: 8-64 chars; salted hash, never the raw IP |
| outcome    | text        | NO   | —       | CHECK: accepted/honeypot/invalid/rate_limited/unknown_artist/no_recipient/send_failed/attachment |
| created_at | timestamptz | NO   | now()   |       |

- **The rate-limit ledger.** EVERY outcome is recorded — rejections included, so probing burns budget. Limits enforced in `submit_enquiry`: 5/hour + 20/day per `ip_hash`, and 30/hour per ARTIST over `enquiries` (the botnet line — dropped by the `20260804230000` rewrite, unnoticed until 2026-08-04 because untested, restored `20260804270000` with a door test). Rejections RETURN, never RAISE — a raise would roll back the ledger insert and blind the limiter.
- **RLS:** `contact_attempts_admin_read` (SELECT): `is_admin()`. No session writes.
- **Referenced (src): none directly, by design** — writes go exclusively through `submit_enquiry` / `log_contact_attempt` from the contact Edge Function. Pruned opportunistically (~1 req in 100) inside the door.
- **Indexes:** PK; `contact_attempts_ip_created_idx (ip_hash, created_at DESC)`; `contact_attempts_created_idx (created_at)`.
- **Migrations:** `20260722120000` (created), `20260804200000` (added `attachment` outcome).

### Table: enquiries {#table-enquiries}

| Name                | Type        | Null | Default           | Notes |
| ------------------- | ----------- | ---- | ----------------- | ----- |
| id                  | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id           | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| purpose             | text        | NO   | 'other'           | CHECK: booking/demo/other |
| name                | text        | NO   | —                 | CHECK: 1-200 chars |
| email               | text        | NO   | —                 | visitor's address; CHECK: 3-320 chars |
| message             | text        | NO   | —                 | CHECK: ≤5000 chars; EMPTY ALLOWED since `20260804250000` (a demo can be link + audio only) |
| to_email            | text        | YES  | —                 | resolved recipient (frozen at submit time) |
| recipient_source    | text        | YES  | —                 | CHECK: mail_settings/link/site_content/default — which ladder rung won |
| status              | text        | NO   | 'queued'          | CHECK: queued/sent/failed/unroutable |
| send_error          | text        | YES  | —                 |       |
| provider_message_id | text        | YES  | —                 | Resend id |
| sent_at             | timestamptz | YES  | —                 |       |
| read_at             | timestamptz | YES  | —                 | manager read marker |
| created_at          | timestamptz | NO   | now()             |       |
| demo_url            | text        | YES  | —                 | CHECK: `^https://` + ≤2048 — added `20260804190000` |

- **Stored BEFORE sending, always** — including `status='unroutable'` when no recipient/sender resolves (`20260804230000`): while mail is unconfigured this row is the only copy of the message. The dashboard surfaces the not-emailed states rather than implying delivery.
- **RLS:** `enquiries_read` (SELECT) + `enquiries_mark_read` (UPDATE): `is_admin() OR is_manager_of(artist_id)`. UPDATE is column-granted to `read_at` ONLY (a manager can mark read, not rewrite a message). No session INSERT/DELETE — the door writes as service_role.
- **Referenced (src):** `enquiries/page.tsx` + `artists/page.tsx` (the table UI), `enquiries/actions.ts` (`setEnquiryReadAction`), `enquiry-inbox-server.ts`; Edge Function PATCHes `demo_url` post-insert.
- **Indexes:** PK; `enquiries_artist_created_idx (artist_id, created_at DESC)`; `enquiries_unsent_idx (created_at) WHERE status <> 'sent'`.
- **Migrations:** `20260722120000` (created), `20260804190000` (demo_url), `20260804230000` (unroutable), `20260804250000` (empty message).

### Table: enquiry_attachments {#table-enquiry_attachments}

| Name         | Type        | Null | Default           | Notes |
| ------------ | ----------- | ---- | ----------------- | ----- |
| id           | uuid        | NO   | gen_random_uuid() | PK    |
| enquiry_id   | uuid        | NO   | —                 | FK → enquiries(id) CASCADE |
| artist_id    | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| storage_path | text        | YES  | —                 | NULL after expiry (tombstone) or if never written |
| filename     | text        | NO   | —                 | visitor's raw name (≤200), display only |
| mime_type    | text        | NO   | —                 |       |
| bytes        | bigint      | NO   | 0                 | visitor-DECLARED, advisory only — the dashboard reads the real size from storage |
| created_at   | timestamptz | NO   | now()             |       |
| expired_at   | timestamptz | YES  | —                 | stamped by the 90-day sweep — added `20260804210000` |

- **Metadata row written when the upload TICKET is minted**, before any bytes exist — an abandoned upload leaves a row with no object, rendered the same as an expired one. Objects live 90 days, then the sweep deletes the file and TOMBSTONES the row (path nulled, `expired_at` stamped) so "expired" and "never had audio" stay distinguishable.
- **RLS:** `enquiry_attachments owner read` (SELECT): `is_admin() OR is_manager_of(artist_id)`. **No session write policies at all** — the Edge Function writes as service_role; pinned by `tests/enquiry-attachments.isolation.test.ts` precisely because a later migration could silently add one.
- **Referenced (src):** `enquiries/actions.ts` (signed playback URLs), `enquiry-inbox-server.ts` (badge counts); Edge Function inserts rows, sweeps, tombstones.
- **Indexes:** PK; `enquiry_attachments_enquiry_idx (enquiry_id)`; `enquiry_attachments_created_idx (created_at)`; `enquiry_attachments_sweep_idx (created_at) WHERE storage_path IS NOT NULL`.
- **Migrations:** `20260804190000` (created), `20260804210000` (tombstone).

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
| on_site    | boolean     | NO   | true              | live on-site gate (`20260714160000`); renamed from `visible` `20260714150000` |
| role       | text        | YES  | —                 | added `20260721120000`; `role='booking'` is rung 2 of the enquiry recipient ladder (a `mailto:` booking link becomes the to-address) |

- **RLS:** `links_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Reached via** the generic CRUD layer (`content.ts`, `CRUD.link`) — dynamic table name, so no literal `from('links')`. `on_site` IS gated in `get_public_site` (`20260714160000`) and written by the editor's per-link toggle (`setOnSiteAction('link', …)`). Follows the TRACKS model — a LIVE toggle, so `link` is deliberately NOT in `ON_SITE_ENTITIES`/`reconcileOnSite`. Defaults **true**: a link is on the site unless taken off.

### Table: mail_settings {#table-mail_settings}

| Name             | Type        | Null | Default   | Notes |
| ---------------- | ----------- | ---- | --------- | ----- |
| id               | boolean     | NO   | true      | PK + CHECK (id) — the singleton pattern: only one row can ever exist |
| default_to_email | text        | NO   | —         | CHECK: email shape; rung 4 (final fallback) of the recipient ladder |
| sending_domain   | text        | NO   | —         | CHECK: domain shape; must be Resend-verified before mail works |
| from_local_part  | text        | NO   | 'noreply' | CHECK: `^[a-z0-9._-]{1,64}$` |
| updated_at       | timestamptz | NO   | now()     |       |

- **The mail singleton.** No row ⇒ every enquiry is `unroutable` (stored, not sent) — the current state until Sam verifies a Resend domain. `tests/enquiry-door.test.ts` takes ownership of this row during its run and restores it.
- **RLS:** `mail_settings_admin_all` (ALL): `is_admin()`.
- **Referenced (src):** one UI label in `enquiries/page.tsx`; otherwise read only inside `resolve_booking_recipient` / `submit_enquiry` SQL.
- **Migrations:** `20260722120000_contact_enquiries.sql` (created).

### Table: media {#table-media}

| Name         | Type        | Null | Default           | Notes |
| ------------ | ----------- | ---- | ----------------- | ----- |
| id           | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id    | uuid        | NO   | —                 | FK → artists(id) CASCADE |
| purpose      | text        | NO   | —                 | CHECK: hero_video/profile_photo/gallery_image/bio_video (`20260716180000`) /logo_primary/logo_secondary/favicon (`20260804160000`) |
| storage_path | text        | NO   | —                 | path in the `media` bucket |
| sort_order   | int         | NO   | 0                 |       |
| created_at   | timestamptz | NO   | now()             |       |
| drive_file_id | text       | YES  | —                 | Google Drive source id for a copy-import — added `20260710120000` |
| on_site      | boolean     | NO   | false             | gallery selection — added `20260713160000` (as `visible`), renamed `20260714150000` |
| orientation  | text        | YES  | —                 | CHECK: horizontal/vertical — added `20260720120000` (hero-video fit) |
| site_role    | text        | YES  | —                 | CHECK: `^[a-z0-9_]{1,64}$` — added `20260724120000`; which template slot an asset fills |

- **RLS:** `media_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `media_artist_idx (artist_id, purpose, sort_order)`; `media_drive_file_uniq (artist_id, drive_file_id) WHERE drive_file_id IS NOT NULL` (partial unique).
- **Publishable** (`PUBLISHABLE.media`, bespoke uploader — ADR-0003). No `updated_at` (live table; delete unpublishes immediately). **Referenced (src):** `media-uploader.tsx`, `site/page.tsx`, `lib/site.ts`, `(dashboard)/actions.ts` (`deleteMediaAction`/`setOnSiteAction`), `editor/page.tsx`. Shares its name with the `media` storage bucket. `gallery_image` purpose now backs the **Photos page** gallery block (moved off the Site page).
- **`on_site` is UNIQUE among the gated types: it rides the SNAPSHOT**, not a live join (`PUBLISHABLE.media.snapshot`), so `get_public_site` gates gallery photos on their PUBLISHED selection. Defaults **false** (a new upload is off the site until selected) — the opposite of `links`. Revisions are immutable, so snapshots written before the rename still hold a `visible` key and the door coalesces both: `coalesce((data->>'on_site')::boolean, (data->>'visible')::boolean, true)`. Audited 2026-07-14: 18 media revisions live, **0** of them `gallery_image`, so the legacy arm currently carries no rows and can be dropped once every artist has published once. Pinned by `tests/media-gallery-gate.test.ts`.

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
| on_site            | boolean     | NO   | true              | live on-site gate (20260707120000; renamed `20260714150000`) |

- **RLS:** `merch_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`. Reached via generic CRUD (`CRUD.merch`) + `reconcileOnSite`. `get_public_site` gates merch on `on_site`.

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
| release_type | text        | NO   | 'single'          | CHECK: album/single/ep/featured/remix (`remix` added `20260726120000`) |
| on_site      | boolean     | NO   | true              | live on-site gate (20260706180000; renamed `20260714150000`) |
| spotify_id   | text        | YES  | —                 | UNIQUE(artist_id, spotify_id) WHERE not null |
| released     | boolean     | NO   | false             | manual "is released" flag — added `20260710140000` (Released iff platform presence OR this; songs inherit widen-only) |
| release_type_locked | boolean | NO | false             | added `20260727180000`; a manually-set type survives Sync overwrites |

- **RLS:** `releases_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `releases_artist_id_slug_key (artist_id, slug)` UNIQUE; `releases_artist_idx (artist_id, sort_order)`; `releases_artist_spotify_idx (artist_id, spotify_id)` UNIQUE partial (`WHERE spotify_id IS NOT NULL`).
- **Referenced (src):** `(dashboard)/actions.ts` (release + `links` jsonb + `release_type` editor), `lib/sync.ts` (Spotify import), `lib/music.ts` (`releaseBucket`). Public smart-link via `get_release()` / `get_public_releases()` (Released **and** `on_site` — both gates must pass). ⚠ `get_release` LOST its gate in `20260709120000` and served off-site releases until `20260714130000` restored it; `tests/music-doors.test.ts` now asserts it.

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
- **Indexes:** PK; `site_content_artist_id_key_key (artist_id, key)` UNIQUE; `site_content_artist_idx (artist_id, key)` — ⚠ redundant, identical to the UNIQUE constraint's index (see Inconsistencies).
- **Referenced (src):** `(dashboard)/actions.ts` (site text + SEO), `site/page.tsx`, `tools/seo/page.tsx`, `lib/site.ts`, `lib/site-editor/save.ts`.

### Table: site_styles {#table-site_styles}

| Name        | Type        | Null | Default           | Notes |
| ----------- | ----------- | ---- | ----------------- | ----- |
| id          | uuid        | NO   | gen_random_uuid() | PK    |
| artist_id   | uuid        | NO   | —                 | FK → artists(id) CASCADE; UNIQUE(artist_id, region_key) |
| region_key  | text        | NO   | —                 | UNIQUE(artist_id, region_key) |
| class_names | text        | YES  | —                 | raw class string; null/'' → region uses base classes only |
| created_at  | timestamptz | NO   | now()             |       |
| updated_at  | timestamptz | NO   | now()             | trigger set_updated_at |

- **NEW `20260714120000_site_styles.sql`** (SITE_STYLING_PLAN.md S0). Per-region editable class names, so a site's layout/format is data-driven instead of locked to a hardcoded template.
- **RLS:** `site_styles_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`. Owner-only read/write — the value becomes public only once published, via `get_public_site`.
- **Indexes:** PK; `site_styles_artist_id_region_key_key (artist_id, region_key)` UNIQUE; `site_styles_artist_idx (artist_id, region_key)` — ⚠ redundant (see Inconsistencies).
- **Publishable** (`PUBLISHABLE.site_styles`): modeled on `site_content` — reconciled into `revisions` by row id, snapshot `{id, region_key, class_names}`. `get_public_site` folds published rows into a `styles` `{region_key: class_names}` object, skipping blank `class_names`. Also added `'site_styles'` to the `revisions_entity_type_check` CHECK.
- **`region_key` shape:** a manifest style-region key (e.g. `hero_wordmark`), or a per-item key `'<slot>:<itemId>'` (e.g. `videos:<uuid>`) reusing the `data-lse-item` UUID convention — the first `:` is the separator.
- **Referenced (src):** `lib/site.ts` (working-site read). Editor-side plumbing (markers/manifest/bridge + `saveEditorStyle`) is S1, in progress on `feat/site-styles-editor` at the time of this scan.

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
| date            | date        | YES  | —                 | NULLABLE since `20260716120000` (a "TBA" show can exist) |
| venue           | text        | YES  | —                 |       |
| city            | text        | YES  | —                 |       |
| country         | text        | YES  | —                 |       |
| ticket_url      | text        | YES  | —                 |       |
| source          | text        | NO   | 'manual'          | CHECK: manual/spotify/bandsintown/shopify/ticketmaster |
| created_at      | timestamptz | NO   | now()             |       |
| updated_at      | timestamptz | NO   | now()             | trigger set_updated_at |
| bandsintown_id  | text        | YES  | —                 |       |
| ticketmaster_id | text        | YES  | —                 |       |
| on_site         | boolean     | NO   | true              | live on-site gate (20260707120000; renamed `20260714150000`) |
| latitude        | float8      | YES  | —                 | tour-map prep; dashboard-only (not in public snapshot) |
| longitude       | float8      | YES  | —                 | tour-map prep; dashboard-only |
| support         | text[]      | NO   | '{}'              | support acts — added `20260715120000` |
| state           | text        | YES  | —                 | CHECK: `^[A-Z]{2}$` (US state; mirrored in `lib/us-states.ts`) — added `20260716140000` |
| is_past         | boolean     | NO   | false             | manual past-show flag — added `20260716160000` |
| support_urls    | jsonb       | NO   | '{}'              | support-act name → URL — added `20260717140000` |
| sort_order      | int         | YES  | —                 | manual ordering (NULL = date order) — added `20260723120000`; reorderable via `reorder_rows` |

- **RLS:** `tour_dates_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Referenced (src):** `(dashboard)/layout.tsx` (on-tour badge). Editor via generic CRUD (`CRUD.tour_date`, required = `['date']`) + `reconcileOnSite`. `get_public_site` gates tour_dates on `on_site`. Coords (`20260707140000_tour_coords.sql`) feed the not-yet-built map and ride under the Bandsintown compliance gate.

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
| album_name       | text        | YES  | —                 | Spotify album/EP/single title (legacy display; no longer a tracklist fallback) |
| duration_ms      | int         | YES  | —                 | added `20260708160000` — cross-platform merge match key + display |
| release_id       | uuid        | YES  | —                 | FK → releases(id) SET NULL (authoritative tracklist membership) |
| on_site          | boolean     | NO   | true              | live on-site gate (`20260710170000`); renamed from `visible` `20260714150000` |
| released         | boolean     | NO   | false             | manual "is released" flag — added `20260710130000` (public iff platform presence OR this) |
| soundcloud_url   | text        | YES  | —                 | SoundCloud link — added `20260710130000` (no id col to rebuild from) |
| drive_file_id    | text        | YES  | —                 | Google Drive source id for a copy-import — added `20260710120000` |
| release_type     | text        | NO   | 'single'          | CHECK: album/single/ep/featured/remix — added `20260726120000` (per-SONG type) |
| deezer_url       | text        | YES  | —                 | explicit Deezer link — added `20260727150000` (frees `provider_url` from double duty) |
| release_date     | date        | YES  | —                 | per-song date — added `20260727160000` |
| parent_release_id | uuid       | YES  | —                 | FK → releases(id) SET NULL — added `20260727170000`; "also appears on" (a single can live on a project too) |

- **RLS:** `tracks_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `tracks_release_idx (release_id)`; `tracks_drive_file_uniq (artist_id, drive_file_id) WHERE drive_file_id IS NOT NULL` (partial unique — dedupes Drive imports).
- **Referenced (src):** `track-audio-uploader.tsx` (audio_path), `(dashboard)/actions.ts` (`setTrackReleaseAction`), `lib/sync.ts`, `lib/tracks.ts`; editor via generic CRUD (`CRUD.track`). `release_id` (`20260706170000`) is the authoritative and ONLY membership (the `album_name` fallback in `get_release()` was removed `20260709120000`). `released` (`20260710130000`) is the manual public flag. `on_site` is LIVE-gated (`20260710170000` woke it): the site shows a song iff its own `on_site` is true — Released is a library-only label, a SEPARATE axis. Toggled live via `setOnSiteAction('track', …)`, so `track` is NOT in `ON_SITE_ENTITIES`.
- **Union / multi-platform merge (`20260708160000`, `lib/sync.ts syncTracks`):** a track is a UNION row — one song carries every platform's id/link, and "which platforms is it on" is derived from which of `spotify_id`/`apple_id`/`deezer_id` is set. A pull refreshes the row bearing that platform's id, or STAMPS the platform onto the same song imported from another platform (matched by `normalizeTitle` + `duration_ms` ±3s), or inserts new — never duplicating or switching sources. Links: Spotify → `stream_url`, Apple → `apple_url`, Deezer → `provider_url` (or rebuilt from id). `apple_url` is threaded to the public site (snapshot + `SiteTrack` + the `artist-site.tsx` link chain, 2026-07-09). The public doors expose RELEASED music only (`20260709120000`: `music_release_is_released` / `music_track_on_platform` mirror `lib/music.ts`; `get_release`'s album_name fallback removed). **Amended 2026-07-09/10:** classification is now platform presence OR the stored `released` flag (`20260710130000`/`140000`); `audio_path_for_play` + the `get_public_site` tracks branch were briefly gated Released **and** on the release's flag (`20260710150000`), then **`20260710170000` decoupled them entirely** — both now gate on the track's own `on_site` and ignore Released, which is a library-only label. Release membership is **widen-only** (`20260710160000` — a linked song stays public even inside an Unreleased release). The old MusicKit-token Apple client is gone — catalog reads use the free iTunes Search API (no credentials).

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
| on_site          | boolean     | NO   | true              | live on-site gate (20260707120000; renamed `20260714150000`) |
| is_short         | boolean     | NO   | false             | YouTube Short classification |
| youtube_views    | bigint      | YES  | —                 | cached global view count |
| youtube_views_at | timestamptz | YES  | —                 | when the count was cached |
| storage_path     | text        | YES  | —                 | path in the `videos` bucket (provider='uploaded') |
| drive_file_id    | text        | YES  | —                 | Google Drive source id for a copy-import — added `20260710120000` |
| site_role        | text        | YES  | —                 | CHECK: hero_landscape/hero_portrait/bio_background — added `20260716200000`, bio `20260717120000` |

- **RLS:** `videos_rw` (ALL): `is_admin() OR is_manager_of(artist_id)`.
- **Indexes:** PK; `videos_artist_idx (artist_id, sort_order)`; `videos_drive_file_uniq (artist_id, drive_file_id) WHERE drive_file_id IS NOT NULL` (partial unique).
- **CHECK `videos_embed_or_storage`:** at least one of `embed_url` / `storage_path` is set. Uploaded videos carry `storage_path` + `provider='uploaded'`; embedded carry `embed_url`. Adds run through `embedInfo` / the upload flow (bespoke, not generic CRUD) + `reconcileOnSite`. **Referenced (src):** `video-add.tsx`, `(dashboard)/actions.ts` (rename/delete), `lib/storage-gc.ts` (orphan cleanup). `get_public_site` gates videos on `on_site`. Migrations `20260625180000_videos.sql`, `20260708120000_video_upload.sql`.

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
- `get_public_site(p_slug text) → jsonb` — full published site. Live def `20260714160000_links_on_site_gate.sql`. Gates **tracks, tour_dates, merch, links, videos** on the live row's `on_site` (`LEFT JOIN + coalesce(x.on_site, true)` — the published snapshot stays authoritative until a publish tombstones it, so deleting a working row never yanks live content early). **media/gallery_image** is the exception: gated on the flag inside its own snapshot, with the pre-rename `visible` key coalesced. Tracks are NO LONGER Released-gated here (`20260710170000` decoupled the axes). Also returns `styles` (`20260714120000`) and `site_content`. ← `lib/site.ts`.
- `get_release(p_artist_slug, p_release_slug) → jsonb` — one release smart-link + tracklist (membership by `release_id` ONLY; album_name fallback removed). Gated on Released **AND** `on_site` — both must pass; either failing → null. ← `[slug]/r/[release]/page.tsx`. Live def `20260714150000`. ⚠ **Regression history:** `20260709120000` rewrote this fn and silently dropped the `visible` join, so an off-site release kept serving its page (while correctly vanishing from `get_public_releases`) until `20260714130000` restored it as `LEFT JOIN + coalesce(r.on_site, true)`. Asserted by `tests/music-doors.test.ts`.
- `get_public_releases(p_slug) → jsonb` — Released + `on_site` release list for the EPK. ← `[slug]/epk/page.tsx`. Live def `20260714150000`. Note: uses an INNER JOIN to `releases` (unlike every other door's LEFT JOIN + coalesce), so a published release whose working row is deleted drops immediately rather than at its tombstone. Fail-closed, so left alone.
- `audio_path_for_play(p_slug, p_track_id) → text` — published audio path → signed URL, gated on the track's own `on_site` (`coalesce(trk.on_site, true)`); else null. ← `lib/audio.ts`. Live def `20260714150000`. **Released no longer gates this** — `20260710170000` decoupled the two axes, so the door follows the same per-track flag as the `get_public_site` tracks branch.
- `record_event(p_slug, p_type, p_target, p_entity_id, p_entity_type) → void` (v) — analytics ingest; `type`/`entity_type` allowlisted. ← `components/site-analytics.tsx`. Live def `20260714140000`. **Burst cap: 120 events/artist/minute, dropped SILENTLY** (fire-and-forget telemetry — an exception would surface on the fan's page). Deliberately not subscribe's 15/min: this fires on every view/click. Bounds storage growth only; per-IP limiting needs the edge (a DB fn can't see the IP) and stays open in TODO.md.
- `subscribe(p_slug, p_email) → void` (v) — subscriber ingest, dedup on `(artist_id, lower(email))`, 15/min/artist. ← `[slug]/actions.ts` + skeen-website.
- `submit_application(p_name, p_email, p_artist_name?, p_link?, p_notes?) → void` (v) — public /apply. ← `apply/actions.ts`.
- `public_custom_site(p_slug) → text` (sd) — the custom-site redirect target for `site_kind='custom'` artists (`20260714170000`). ← `lib/custom-site.ts`.

**Contact door (service_role-only — NOT anon-granted; the Edge Function is the public face, ADR 0010):**
- `submit_enquiry(p_slug, p_purpose, p_name, p_email, p_message, p_ip_hash) → TABLE(status, enquiry_id, to_email, from_name, from_email, artist_name, recipient_source)` — validates, rate-limits (5/h + 20/day per IP, 30/h per artist — restored `20260804270000`), resolves the recipient ladder, STORES the enquiry (even unroutable, `20260804230000`), logs the attempt. Never raises — a raise would roll back its own ledger insert. Rewritten four times on 2026-08-04; each rewrite replaces the whole body, which is why every rule needs a door test (`tests/enquiry-door.test.ts`). ← contact Edge Function only.
- `log_contact_attempt(p_slug, p_purpose, p_ip_hash, p_outcome) → void` — ledger writes for paths that never reach `submit_enquiry` (honeypot, 400s, attachment tickets, send failures). ← contact Edge Function (5 call sites).
- `mark_enquiry_sent(p_id, p_ok, p_provider_id?, p_error?) → void` — flips queued→sent/failed after the Resend call. ← contact Edge Function.
- `resolve_booking_recipient(p_artist_id) → TABLE(to_email, recipient_source)` (sd) — the 4-rung ladder: `artist_mail_settings.booking_email` → `links.role='booking'` mailto → `site_content.booking_email` → `mail_settings.default_to_email`. No code caller; invoked inside `submit_enquiry` and `booking_recipient_preview`.
- `booking_recipient_preview(p_artist_id) → TABLE(to_email, recipient_source)` (sd) — same ladder for the dashboard banner. ← `enquiries/page.tsx`.

**Manager RPCs (sd, volatile):**
- `connect_shopify(p_artist_id, p_domain, p_token) → void` — token → Vault. ← `(dashboard)/actions.ts`.
- `disconnect_shopify(p_artist_id) → void`. ← `(dashboard)/actions.ts`.
- `shopify_credentials(p_artist_id) → TABLE(store_domain, token)` — read-back for sync. ← `(dashboard)/actions.ts`.
- `reorder_rows(p_table text, p_artist uuid, p_ids uuid[]) → void` — atomic `sort_order` reorder for a whole list in one statement (`20260713120000`); table allowlist widened for `tour_dates` (`20260723120000`) and `releases` (`20260725120000`). ← `(dashboard)/actions.ts` (`reorderContentAction`), `lib/site-editor/gallery.ts`.
- `set_release_link(p_release_id, p_label, p_url) → void` — atomic read-modify-write on the `releases.links` jsonb, so two saves can't clobber each other (`20260727190000`). ← `(dashboard)/actions.ts`.

**Analytics (stable, SECURITY INVOKER):**
- `analytics_summary(p_artist_id, p_since) → TABLE(...)` — exact group-by. ← `roster-data.ts`, `(dashboard)/page.tsx`. The implicit PUBLIC execute grant was revoked `20260714140000`; `authenticated` retains it. (Was always safe — INVOKER ⟹ RLS gives anon no rows — this just makes the intent explicit.)
- `analytics_daily(p_since, p_artist_id?) → TABLE(...)` — daily series for roster sparklines. ← `roster-data.ts`.
- `analytics_by_entity(p_artist_id, p_since) → TABLE(...)` — per-item engagement. ← `lib/analytics.ts` (`20260707160000_analytics_entity.sql`).
- `analytics_entity_daily(p_artist_id, p_entity_ids, p_since) → TABLE(...)` — per-entity daily series. ← `entity-sparkline.tsx` (`20260707180000_analytics_entity_daily.sql`).

**Internal / RLS / publish:**
- `is_admin() → boolean` — trusts the JWT `app_metadata.role` claim.
- `is_manager_of(target_artist_id) → boolean` (sd) — reads `artist_managers`. The isolation primitive; used inside nearly every RLS policy.
- `latest_revisions(p_artist_id) → TABLE(...)` — newest revision per entity incl tombstones. ← `lib/content.ts` (diffUnpublished).
- `published_revisions(p_artist_id, p_entity_type?) → TABLE(...)` (sd) — live view (tombstones removed); the seam public doors project over (`20260626120000_published_revisions_seam.sql`).
- `set_updated_at() → trigger` — BEFORE UPDATE on 9 tables (see Triggers).
- `rls_auto_enable() → event_trigger` (sd, `search_path=pg_catalog`) — auto-enables RLS on new `public` tables. Fired by event trigger **`ensure_rls`** (`ddl_command_end`, tags: CREATE TABLE / CREATE TABLE AS / SELECT INTO). ⚠ **live-only, in no migration** — and DELIBERATELY so: `CREATE EVENT TRIGGER` needs superuser, which `db push` lacks, so a capture migration would fail and could leave the live safety net dropped (decided 2026-07-08, see TODO.md; re-confirmed 2026-07-14). Belt-and-suspenders anyway — every table also calls `enable row level security` itself, and all 18 are confirmed RLS-on. The other 6 event triggers (`pgrst_ddl_watch`, `issue_*`, `issue_graphql_placeholder`) are Supabase platform-managed — do not capture.

**Triggers (all BEFORE UPDATE → `set_updated_at()`):** `artist_requests`, `links`, `merch`, `releases`, `site_content`, `site_styles`, `tour_dates`, `tracks`, `videos`. (`media`, `subscribers`, `analytics_events`, `applications`, `profiles`, `artists`, `revisions` have no `updated_at`.)

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

### Bucket: documents {#bucket-documents}

- **Config:** `public = false`; 10 MB limit (`10485760`); MIME allowlist `application/pdf` ONLY — the bucket refuses non-PDF even from the service role (pinned by `tests/documents.isolation.test.ts`).
- **Policies (storage.objects):** manager read/insert/update/delete gated `is_admin() OR is_manager_of(foldername[1]::uuid)` on path `{artist_id}/documents/*`.
- **Used in:** `epk/document-upload.tsx` (upload), `epk/download/route.ts` (service-role `.download` — bytes go straight into the merged PDF, never out as a URL). Constant `DOCUMENTS_BUCKET` in `lib/epk.ts`. Bucket + policies in `20260804140000_press_documents.sql` (upserts over the hand-created bucket).
- ⚠ **Supabase CDN caches past authorisation:** tightening a storage policy does NOT purge already-served objects (found 2026-08-04, recorded in TODO.md).

### Bucket: enquiry-attachments {#bucket-enquiry-attachments}

- **Config:** `public = false`; 25 MB limit (`26214400`); MIME allowlist: 8 audio types (mpeg/mp4/x-m4a/wav/x-wav/aac/ogg/flac) — mirrored in `validate.ts AUDIO_MIME_TYPES` so no ticket is minted for a file the bucket would refuse.
- **Policies (storage.objects):** manager SELECT + DELETE only, gated `is_admin() OR is_manager_of(foldername[1]::uuid)`. **NO INSERT/UPDATE policy at all — deliberate:** visitors write via one-shot service-role signed tickets (`POST /storage/v1/object/upload/sign/...`, path `{artist_id}/{enquiry_id}/{uuid}-{name}`), and no session may ever write. Pinned by `tests/enquiry-attachments.isolation.test.ts` because a later migration could silently add the policy back.
- **Used in:** `lib/enquiry-attachments.ts` (signed playback URLs, real-size list), contact Edge Function (sign, sweep, tombstone). Objects expire after 90 days (opportunistic sweep, ~1 req/100); rows survive as tombstones.

---

## Inconsistencies (verifier output)

**Verifier arithmetic (2026-08-04, INCREMENTAL):** live DB = 23 tables · 2 views · 30 functions · 5 buckets. The scoped codebase index covered all 11 affected tables, 10 functions, 3 buckets — every RPC called from code exists live, all FKs resolve. Two tables have zero code references (`artist_mail_settings`, `mail_settings`) — **deliberate, not dead schema**: both are read exclusively inside `resolve_booking_recipient`/`submit_enquiry` SQL so the recipient never reaches the client (see their sections).

Open:

0. **`supabase/functions/contact/index.ts` is outside every net** — excluded from tsconfig, eslint, and vitest (it is Deno; the rest of the repo is Node). Its two deployment-only bugs (2026-08-04) happened exactly there. Mitigated 2026-08-04: the decision logic (`composeExtras`, `decideDoor`) was extracted into `validate.ts`, which IS vitest-covered; what remains in index.ts is fetch plumbing verified by post-deploy probes. Keep it that way — logic added to index.ts is logic nobody can test.

1. **`rls_auto_enable` / `ensure_rls`** — live-only object, in no migration, zero code references. **Deliberate, do not "fix":** `CREATE EVENT TRIGGER` requires superuser, which `db push` does not have, so a capture migration would fail — and since the trigger must be dropped before recreation, a partial apply could leave the live RLS safety net GONE. Decided 2026-07-08 (TODO.md), re-confirmed 2026-07-14. It is belt-and-suspenders regardless: every table also runs `enable row level security` explicitly. Exact def is captured under Functions for a from-scratch rebuild.
2. **Off-site ≠ private (storage).** `media` and `videos` are `public = true`, so `/object/public/…` bypasses RLS. **Verified 2026-07-14:** anon HEAD on a real object → **200**, irrespective of `on_site`. Enumeration IS closed (manager-scoped storage SELECT on both buckets; anon `.list()` → `[]` at root, artist dir, and the exact subdir). So the gate controls *discovery*, not *access*: taking an asset off the site does not revoke its URL, and an asset that was never on-site rests on an unguessable UUID path ("anyone with the link", not "private"). Sam confirmed some uploads are unreleased/sensitive → three costed options in TODO.md.
3. **Redundant indexes on both key/value tables.** `site_content_artist_idx (artist_id, key)` duplicates `site_content_artist_id_key_key`; `site_styles_artist_idx (artist_id, region_key)` duplicates `site_styles_artist_id_region_key_key`. `site_styles` inherited the pattern by being modeled on `site_content`. Pure write overhead; drop both when convenient.
4. **`subscribe()` has no in-repo `rpc()` caller** for the external path — invoked from `skeen-website`. `src/app/[slug]/actions.ts` calls it for the on-site popup. Not a bug; noted so a future "unused function" sweep doesn't delete it.

Closed this run:

5. ~~**Dual tracklist membership**~~ — the `album_name` fallback was removed from `get_release()` in `20260709120000`; `release_id` is the only membership. `album_name` is now annotated legacy display-only in `content.ts` (skeen-website reads it as a title fallback).
6. ~~**`analytics_summary` anon-executable**~~ — PUBLIC execute revoked `20260714140000`.
7. ~~**`gallery_image` purpose unwired**~~ — now backs the Photos page + the editor gallery, gated per-photo by the published `on_site` flag (`20260713160000`), covered by `tests/media-gallery-gate.test.ts`.
8. ~~**`get_release` served off-site releases**~~ — the `visible` join was silently lost in the `20260709120000` rewrite; restored `20260714130000` and now asserted. See the Functions entry.

---

## Drift report — INCREMENTAL, 2026-08-04

Scope: 37 migrations past `20260714160000` (`20260714170000` … `20260804270000`) + the July/August feature work (tour-date fields, media/video site roles, links role, music model, contact enquiries, EPK, brand, attachments).

**Zero adjudication-worthy drift.** Every difference between this file and the live DB traced to a committed, applied migration (local and remote migration histories verified identical, 101 = 101). The two structure changes made outside migrations are already codified: the `documents` bucket (hand-created, then upserted by `20260804140000`) and the `media` bucket's 500 MB cap (dashboard change on the Pro plan, matching the doc). So the whole delta was applied DB-is-truth without per-item questions — nothing had two competing claims to arbitrate.

Notable in this delta:

| Item | What happened |
| ---- | ------------- |
| 5 new tables (enquiries, contact_attempts, enquiry_attachments, mail_settings, artist_mail_settings) | Added, with the contact-door architecture notes |
| 7 new functions (contact door ×5, `public_custom_site`, `set_release_link`) | Added |
| 2 new private buckets (documents, enquiry-attachments) | Added, incl. the deliberate no-INSERT-policy design |
| `enquiry_counts_by_artist` view | Created `20260804180000`, dropped `20260804220000` (the table UI reads rows, not counts) — net zero, never documented |
| Per-artist flood cap (30/h) | DROPPED silently by the `20260804230000` rewrite, caught by this review cycle, RESTORED `20260804270000` + door-tested |
| `releases.release_type` | Gained `remix` (`20260726120000`) — this file previously said album/single/ep/featured |
| artists +9 columns, tracks +4, tour_dates +5, media +2, videos +1, links +1, releases +1 | Column tables updated |

No item required a DB change; this skill never writes to the database.

---

## Drift report — INCREMENTAL, 2026-07-14

Scope: 8 migrations past `20260710160000` (`20260710170000` … `20260714160000`) + 99 changed files in `src/`/`supabase/` since `9f6728b`.

7 drift items found; Sam resolved all as **DB is truth** (batched — 6 were changes made and verified in the same session, the 7th was a self-contradiction inside this file):

| # | Item | Resolution |
| - | ---- | ---------- |
| 1 | `site_styles` table absent from doc | Added (new, `20260714120000`) |
| 2 | `artists.site_kind` / `custom_site_url` absent | Added (new, `20260714120000`) |
| 3 | `reorder_rows` absent | Added (new, `20260713120000`) |
| 4 | Doc said `visible`; DB says `on_site` | Renamed throughout (`20260714150000`) |
| 5 | `media.on_site` column absent | Added (`20260713160000`, renamed `20260714150000`) |
| 6 | `get_release` / `record_event` / `analytics_summary` bodies changed | Descriptions updated |
| 7 | `switch_catalog_source` listed as live w/ a `lib/catalog.ts` caller | **Removed** — the file contradicted itself (ToC already said DROPPED). Verified: absent from the DB (`count 0`), `src/lib/catalog.ts` does not exist, zero refs in `src/`. |

No item required a DB change; this skill never writes to the database.
