# Artist Site Manager — Implementation Plan

This plan extends the build brief in `README.md` with the decisions resolved during
the design grill. Where this plan and the README differ, **this plan wins** — it
records choices the brief left open.

## Product, in one paragraph

An agency builds and hosts websites for musicians. Each artist's content (tracks, tour
dates, merch, bio, images, links) lives in one shared database. The artist's **manager**
edits that content through a dashboard, **reviews a real preview**, then **publishes** it
live. Where possible, content is **pulled from external services** (Spotify, Bandsintown,
Shopify) to stay consistent. Later, an **MCP app** lets a manager edit by chatting with
Claude. The hard requirement throughout: a manager can only ever touch their own artist.

## Decisions locked in the grill

| # | Decision | Choice |
|---|----------|--------|
| 1 | Migrations / schema versioning | **Supabase CLI migrations** — SQL files in `supabase/migrations/`, `supabase db reset` locally (also for tests), `supabase db push` to prod. RLS lives in SQL, reviewable in git. |
| 2 | Admin role in RLS | **JWT claim** for admin (`auth.jwt() -> app_metadata -> role`), **`SECURITY DEFINER` function** `is_manager_of(artist_id)` for membership. Policy = `is_admin() OR is_manager_of(artist_id)`. No recursion, deny-by-default. |
| 3 | Per-tenant secrets (Shopify tokens) | Separate **`integrations`** table, encrypted via **Supabase Vault**, same RLS as content, never exposed to the public read path. |
| 4 | Images / media | **URL columns on rows** for v1 (no media table yet). Files in **one `media` Storage bucket**, **per-artist folders keyed by `artist_id`**. Add a `media` table later only for galleries. |
| 5 | Publish workflow | **Draft → preview → publish.** Manager self-publishes; **admin can revert/unpublish**; manager can also re-edit and re-publish. Public site reads **published snapshots only**, never working rows. |
| 6 | Sync conflict policy | **Sync never clobbers hand edits.** Each row carries a `source` (`spotify`/`bandsintown`/`shopify`/`manual`). Sync inserts new rows and updates only rows it owns; a manual edit flips that row to `manual`. **Default is to keep pulling from Spotify** so catalog stays consistent. |
| 7 | Preview | **True visual preview** — a `/preview` route, manager-only, rendering the **real public template** against working (unpublished) rows. No separate mock UI. |

## Security model (the core of the product)

- **Tenant = artist.** Every content row carries `artist_id`.
- **Isolation enforced in Postgres with RLS**, deny-by-default. App-layer checks are a
  second line only.
- **Manager membership** decided in exactly one place: `is_manager_of(artist_id)`
  (`SECURITY DEFINER`, one indexed lookup against `artist_managers`).
- **Admin** is an un-forgeable signed JWT claim; checking it costs nothing per row.
- **Service-role key bypasses RLS** — used in only two narrow places: migrations/seeding
  and the public read path. Never in a manager-facing route.
- **Public read path** = a `SECURITY DEFINER` function/view keyed by `slug` that returns
  published snapshots with public-safe fields only — never tokens, manager identity, store
  credentials, or other tenants' rows.

## Data model

Existing tables from the brief (`profiles`, `artists`, `artist_managers`, `tracks`,
`tour_dates`, `merch`, `links`) **plus** the additions below.

```
integrations            -- per-tenant external-service credentials (NEW)
  id          uuid PK
  artist_id   uuid       -- references artists, RLS-scoped
  provider    text       -- 'shopify' | (future) 'spotify_user' | ...
  secret_ref  text       -- pointer into Supabase Vault, NOT the raw token
  metadata    jsonb      -- non-secret config (store domain, etc.)

revisions               -- published history / source of truth for the live site (NEW)
  id            uuid PK
  artist_id     uuid     -- references artists, RLS-scoped
  entity_type   text     -- 'artist' | 'track' | 'tour_date' | 'merch' | 'link'
  entity_id     uuid     -- the working row this snapshot came from
  data          jsonb    -- public-safe snapshot of the row at publish time
  published_at  timestamptz
  published_by  uuid     -- references auth.users
```

Add to every content row: `source text default 'manual'` (drives sync conflict policy).

**How publish/preview/revert work with `revisions`:**
- Content tables hold the **working/draft** state the manager edits.
- **Publish** = insert a snapshot of the working row into `revisions`.
- **Public site** reads the **latest revision per entity** for the artist (via the public
  read function keyed by `slug`).
- **Preview** = render the public template against the **working rows** instead of
  revisions, behind a manager-only route.
- **Admin revert/unpublish** = re-insert an older revision as the new current, or insert a
  tombstone to pull an entity off the live site. Full history comes for free.

## Storage layout

```
bucket "media"
  media/{artist_id}/hero.jpg
  media/{artist_id}/tracks/{track_id}.jpg
  media/{artist_id}/merch/{product_id}.jpg
```
Rows store the path/URL; access is scoped by `artist_id` like everything else.

## Milestones (test-first; README's TDD workflow applies throughout)

1. **Scaffold + schema** — Next.js (TS, App Router, Tailwind) + Vitest + Supabase CLI.
   Migrations for all tables incl. `integrations`, `revisions`, `source` columns. Seed
   **two artists + two managers**. `supabase db reset` rebuilds clean.
2. **Auth + tenant isolation (GATE)** — login, "your artists" landing,
   `is_admin()` / `is_manager_of()`, RLS on every table. CRITICAL tests: manager A denied
   on B's data via API **and** raw DB connection. **Stop and verify before any feature.**
3. **One content type end to end (Tracks)** — CRUD in dashboard scoped to an artist,
   with the **draft → preview → publish** flow and `revisions` snapshots. Proves the
   whole loop including the publish model.
4. **Public artist site** — `/[slug]` renders profile + tracks from the **public read
   path (latest revisions)**. Plus the manager-only `/preview` route on working rows.
5. **Remaining content** — tour dates, merch, links: CRUD + publish + on the public site.
   **Ship here** (no external syncs required to launch).
6. **Spotify sync** — `spotifyClient` (client-credentials, 429 backoff, pagination);
   "pull discography" inserts/updates `source='spotify'` tracks as drafts; never clobbers
   `manual` rows.
7. **Bandsintown sync** — "pull tour dates," same source rules.
8. **Shopify sync** — per-store connect via `integrations` + Vault; "pull merch."
9. **(Later) MCP app** — wrap the existing read/update/sync endpoints as MCP tools. Same
   tenant rules, same publish model.

## Test priorities (extends the README matrix)

- **Tenant isolation** is the top surface — every content endpoint tested from a
  different artist's manager and denied (API + raw RLS).
- **Public read** returns only published snapshots, public-safe fields, no cross-tenant
  leakage, no secrets.
- **Publish/preview/revert**: preview shows working rows; public shows only published;
  admin revert restores prior revision; manager re-publish updates live.
- **Sync**: writes only into the scoped artist; never overwrites `manual` rows;
  upsert/dedupe; partial upstream failure reported, never silent.
- **Integrations**: secrets never reachable through any manager-readable path or the
  public read path.

## Open / deferred (decide when reached)

- **Manager onboarding** — likely Supabase invite email from the admin; confirm at
  milestone 2.
- **Revision granularity** — per-entity snapshots (above) vs whole-page; per-entity
  chosen for v1.
- **Dedicated `media` table** — only when galleries/reordering are needed.
- Out of scope per brief: drag-and-drop builder, Resident Advisor, billing, fan accounts.
