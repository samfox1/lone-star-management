# Artist Site Manager — Build Brief

> Working name. Hand this file to a coding agent (Cursor / Claude Code) as the
> starting spec. It is self-contained: everything needed to begin building is here.

> **Read `PLAN.md` first.** It resolves the decisions this brief left open
> (migrations tooling, admin RLS, per-tenant secrets, media storage, the
> draft→preview→publish workflow, and sync conflict policy). Where the two differ,
> **`PLAN.md` wins.**

## How to use this brief (handoff)

1. Open this folder in your Cursor or Claude Code terminal.
2. Tell the agent: **"Read README.md and start at milestone 1."**
3. This brief is written for a cold start — the agent needs no prior context.
   **This is a TDD project: every milestone is built test-first (Red→Green→Refactor).
   See the Testing section — it is the working method, not an optional phase.**
4. **Stop and verify after milestone 2 (tenant isolation).** This is a multi-tenant
   SaaS — the single most important property is that one manager can **never** see or
   edit another artist's data. Prove it with tests before building any features on top.
5. Build in the milestone order below. **Ship after milestone 5** — that's the full
   edit-a-site-and-see-it-live loop across all content types.

## What we're building

A SaaS for an agency that **builds and hosts websites for musicians**. Each artist's
**manager** logs into a dashboard to keep their artist's site current without touching
code — editing **tracks, tour dates, merch, images, bio, and links**.

Content can be **pulled automatically** from where it already lives (Spotify for the
discography, Bandsintown for tour dates, Shopify for merch) and also **edited by hand**.
The public artist website renders from this content.

Later, a **conversational layer (MCP app)** lets a manager update the site by talking to
Claude: "pull the latest tour dates and publish," "swap the hero image," "add this single."

## Multi-tenant model (the core of the product)

- **Tenant = an artist.** It is the unit of isolation. Every content row carries
  `artist_id`.
- **Users / roles:**
  - **Agency admin** (you) — creates artists, assigns managers, full access to all tenants.
  - **Manager** — belongs to one or more artists via `artist_managers`; may edit **only**
    those artists.
- **Isolation is enforced in the database with Postgres Row-Level Security (RLS), not in
  app code.** App-layer checks are a second layer of defense, never the only one.
- **The property that must hold at all times:** a manager cannot read or write any tenant
  they are not assigned to. This gets dedicated, CRITICAL tests (see the matrix) and is
  the milestone-2 gate.

## Core idea: one backend, many frontends

Build the content backend **once**. Put several front doors on it.

```
Frontends (front doors)         Shared Backend + DB              External sources
---------------------------     --------------------------       ----------------------
Public artist sites        ←    artists / tracks / dates    ←    Spotify API (catalog)
  (what fans see)               merch / links / media            Bandsintown API (events)
Manager dashboard (CMS)    ↔    Supabase Auth + RLS              Shopify API (merch)
  (build now)                   CRUD for all content
MCP app (later)            ↔    sync jobs (pull + publish)
  (edit by chat)                public read API (for sites)
```

**Honest note on MCP:** the CMS does **not** need MCP — a normal web dashboard does the
job. MCP's value here is the *manager's editing experience* (conversational updates). So
build the web dashboard first; add the MCP app as another frontend on the same backend
once the core works. **MCP is the last milestone, not the foundation.**

## Tech stack

- **Next.js (App Router) + TypeScript** — public sites + dashboard + API routes.
- **Supabase from day one** — Postgres (content), Auth (manager login), **RLS**
  (tenant isolation), Storage (images). Multi-tenant is a day-one requirement, not a
  retrofit.
- **Tailwind CSS** — styling.
- **One central client module per integration** (`spotifyClient`, `bandsintownClient`,
  `shopifyClient`). Each owns auth/token handling, rate-limit retry/backoff, pagination,
  and error shaping. Routes and sync jobs call these, never raw `fetch`.
- (Matches the stack the agency already uses.)

## Data model (Supabase / Postgres)

```
profiles            -- one per auth user
  user_id   uuid PK  -- references auth.users
  role      text     -- 'admin' | 'manager'

artists             -- the tenant
  id            uuid PK
  slug          text unique     -- public URL: /<slug>
  name          text
  bio           text
  hero_image_url text
  spotify_artist_id  text
  bandsintown_name   text
  shopify_domain     text

artist_managers     -- who manages whom (the isolation join)
  user_id   uuid  -- references auth.users
  artist_id uuid  -- references artists
  PRIMARY KEY (user_id, artist_id)

tracks      (id, artist_id, title, cover_url, spotify_id, stream_url, sort_order)
tour_dates  (id, artist_id, date, venue, city, country, ticket_url, source)
merch       (id, artist_id, title, image_url, price, url, shopify_product_id)
links       (id, artist_id, label, url)
```

**RLS policies (enable on every content table + artists + artist_managers):**
- A row is readable/writable iff
  `artist_id IN (SELECT artist_id FROM artist_managers WHERE user_id = auth.uid())`
  **OR** the caller is an admin (`role = 'admin'`).
- `artist_managers`: a manager can read only their own rows.
- Public site reads do **not** use RLS — they go through a dedicated public read path
  (see below) that exposes only public-safe fields.

## The API contract (build these)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/*` | — | Supabase Auth (manager/admin login) |
| `/api/artists` | GET/POST | List artists you can manage / (admin) create |
| `/api/artists/:id` | GET/PATCH | Read / update artist profile |
| `/api/artists/:id/tracks` | GET/POST/PATCH/DELETE | Manage tracks |
| `/api/artists/:id/tour-dates` | GET/POST/PATCH/DELETE | Manage tour dates |
| `/api/artists/:id/merch` | GET/POST/PATCH/DELETE | Manage merch |
| `/api/artists/:id/links` | GET/POST/PATCH/DELETE | Manage links |
| `/api/artists/:id/sync/spotify` | POST | Pull discography from Spotify |
| `/api/artists/:id/sync/bandsintown` | POST | Pull tour dates from Bandsintown |
| `/api/artists/:id/sync/shopify` | POST | Pull merch from Shopify |
| `/api/public/:slug` | GET | Read-only, public-safe content for the site to render |

**Every `:id` route must enforce tenant ownership** (RLS does this at the DB; the route
also checks and returns 403/404 for a tenant the caller can't access — and there's a test
for it). Sync routes write only into the artist they're scoped to.

## External integrations + auth notes

### Spotify (catalog) — easiest, do first
- **Client Credentials flow** (an app token, no user login) — you only read public
  catalog data. Handle token expiry + 429 retry in `spotifyClient`.
- `GET /v1/artists/{id}/albums` and `/v1/artists/{id}/top-tracks`; paginate albums.
- Store each artist's Spotify artist ID on the `artists` row.
- App credentials from https://developer.spotify.com/dashboard.

### Bandsintown (tour dates)
- `GET https://rest.bandsintown.com/artists/{name}/events?app_id=YOUR_APP_ID`.
- Request an `app_id` from Bandsintown.
- **Resident Advisor (RA) has no public API — do not build against it.** Use Bandsintown
  (or Songkick, which needs partner approval).

### Shopify (merch) — most setup, do last
- Most artist stores run on Shopify. Read products via the **Storefront API** (per store,
  storefront access token) or Admin API.
- This is **per-tenant**: each artist connects their own store, so store credentials live
  on the `artists` row / a related `integrations` table — and are subject to the same RLS.

## Public site read (security boundary)

The public site is unauthenticated, so it cannot use RLS. Expose it through **one**
controlled path — a `SECURITY DEFINER` Postgres function/view keyed by `slug`, or a
server route using the service role — that returns **only public-safe fields**
(profile + published content). It must never return tokens, manager identities, store
credentials, or other tenants' data. This boundary gets its own test.

## Environment variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Spotify (catalog reads)
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

# Bandsintown
BANDSINTOWN_APP_ID=

# Shopify (per-store tokens may live in the DB)
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
```

## Build order (milestones)

Each milestone is **test-first**: write the failing test, then the code (see Testing).

1. **Scaffold + schema** — `npx create-next-app@latest` (TS, App Router, Tailwind). Set up
   **Vitest**. Connect Supabase. Create all tables + RLS policies. Seed **two artists and
   two managers** (you need two tenants to test isolation).
2. **Auth + tenant isolation** — Supabase Auth login; "your artists" landing. Write the
   CRITICAL tests: manager A cannot read or write manager B's artist (via API and via a
   direct RLS check). **Gate — stop and verify isolation holds before any features.**
3. **One content type end to end** — Tracks: list/add/edit/delete in the dashboard,
   scoped to the chosen artist, rendering on a public page. Proves the full loop.
4. **Public artist site** — clean template at `/[slug]` rendering profile + tracks via the
   public read path.
5. **Remaining content** — tour dates, merch, links CRUD + on the public site. **Ship here.**
6. **Spotify sync** — `spotifyClient` + "pull discography" populates tracks for one artist.
7. **Bandsintown sync** — "pull tour dates."
8. **Shopify sync** — per-store connect + "pull merch."
9. **(Later) MCP app** — wrap the backend's read/update/sync endpoints as MCP tools so a
   manager can edit conversationally in Claude. Same tenant rules apply.

## Testing — TDD is the workflow, not a phase

**This is a test-driven project. Write the test first, always. No production code is
written without a failing test that demands it.** Tests *drive* the code; they are never
retrofitted to bless whatever was already built.

**Red → Green → Refactor, every unit of work:**
1. **Red** — write a test for the next small behavior and *run it; watch it fail*. A test
   that passes before the code exists is testing nothing — fix or delete it.
2. **Green** — write the minimum code to make it pass. Nothing more.
3. **Refactor** — clean up with the test as a safety net, keeping it green.

**Rules that keep tests honest:**
- Tenant isolation, every CRUD endpoint, each integration client, and the public read
  boundary get a failing test *before* their implementation.
- **Multi-tenant isolation is the highest-priority test surface.** Every content endpoint
  is tested from the perspective of a manager of a *different* artist — and must be denied.
- Tests assert real behavior and edge cases, not just happy-path 200s.
- A bug fix starts with a failing test that reproduces the bug.
- Mock Spotify/Bandsintown/Shopify at the client boundary so tests are fast and
  deterministic. Test RLS against a real local Postgres/Supabase, not a mock — RLS is the
  thing being verified.

Runner: **Vitest**. A milestone is "done" only when its tests were written first, failed
first, and now pass.

### v1 test coverage matrix (write these alongside the code)

```
CODE PATHS                                              STATUS / NOTE
[+] RLS / tenant isolation
  ├── manager A reads A's content → allowed             [integration]
  ├── manager A reads B's content → denied              [integration] CRITICAL
  ├── manager A writes/deletes B's content → denied     [integration] CRITICAL
  ├── admin reads any tenant → allowed                  [integration]
  └── unauthenticated CRUD → denied                     [integration] CRITICAL
[+] api/artists/:id/* (each content type)
  ├── owner CRUD happy path                             [unit]
  ├── non-owner → 403/404                               [unit] CRITICAL
  └── validation: bad payload → 4xx                     [unit]
[+] api/public/:slug
  ├── returns public-safe fields only                   [unit] CRITICAL (no tokens/PII)
  ├── unknown slug → 404                                [unit]
  └── never leaks other tenants' rows                   [unit] CRITICAL
[+] lib/spotifyClient (+ bandsintown, shopify)
  ├── client-credentials token fetch + reuse            [unit]
  ├── 429 → backoff + retry                             [unit]
  ├── paginate (1 page / N pages)                       [unit]
  └── upstream error → shaped error, no crash           [unit]
[+] sync/* endpoints
  ├── writes only into the scoped artist                [integration] CRITICAL
  ├── upsert/dedupe against existing rows               [unit]
  └── partial upstream failure → reported, not silent   [unit]

USER FLOWS                                              STATUS / NOTE
  ├── login → pick artist → edit track → see it live    [→E2E] happy path
  ├── manager with two artists switches between them     [→E2E]
  ├── manager tries to open another artist's URL → blocked [→E2E] CRITICAL
  └── sync pulls data → appears in dashboard + site      [→E2E]
```

## Failure modes (each needs a test + visible error, never silent)

- **Cross-tenant access attempt** (forged `artist_id`, guessed URL) → denied by RLS and by
  the route check. The single most important failure to cover.
- **Public read leaking private fields** → boundary test asserts the exact shape returned.
- **Upstream API down / rate-limited** (Spotify 429, Bandsintown timeout) → client retries
  with backoff; sync reports a clear partial result, never a half-written silent state.
- **Image upload too large / wrong type** → validated, clear error.
- **Shopify store not connected** → sync returns a clear "connect your store" message.

## NOT in scope (considered, deferred)

- **Drag-and-drop website builder.** It's a content dashboard over a clean template you
  control. One good template in v1; multi-theme later.
- **Resident Advisor integration.** No public API. Bandsintown handles tour dates.
- **Billing / subscriptions.** Add once the product is proven; don't block v1 on Stripe.
- **MCP app.** Last milestone — the web dashboard is the product.
- **Fan-facing accounts / newsletters / analytics.** Separate later layers.

## Getting started

```bash
cd artist-manager
npx create-next-app@latest .   # TypeScript, App Router, src/ dir, Tailwind
# create a Supabase project, run the schema + RLS, add keys to .env.local
npm run dev                    # http://localhost:3000
```

Then start at milestone 1 (schema + RLS), and treat milestone 2 (tenant isolation) as the
gate before anything else.
