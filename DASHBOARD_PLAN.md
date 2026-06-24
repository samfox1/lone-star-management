# Admin Dashboard — Build Plan

A thorough, issue-anticipating plan for restructuring the artist dashboard from
one mega-page into a multi-page "artist operating system." Decisions captured in
a grill session (2026-06-24). Read alongside `PLAN.md` (data/security model) and
`TODO.md` (Bandsintown/media follow-ups).

> **Scope guardrail:** one manager per artist for now. NO multi-user roles yet
> (see `positioning-artist-os` memory). Don't build permission tiers.

---

## 1. Principles

- **Artist OS, not a website builder.** The dashboard is the product; the site is
  one output. Position features as operations tooling.
- **Data-driven templates.** Templates render from `SiteData`; we never hand-edit
  template markup per artist. (Already true: `classic` + `cinematic`.)
- **Draft → publish** stays the safety model, but see the **publish-versioning
  decision (§4.1)** — today it's only half-implemented.
- **RLS is the boundary.** Every new table is scoped by `is_manager_of(artist_id)`.
  Storage by `{artist_id}/…` path. No exceptions.
- **TDD.** Each new lib/table/endpoint gets a failing test first, against the real
  DB (Node 22, sequential — see `testing-hits-hosted-db` memory).

---

## 2. Current state (what we're building on)

| Area | Status |
|---|---|
| Content model | `tracks/tour_dates/merch/links` working rows + `revisions` published snapshots; `source` field + reconcile-on-publish tombstones (`src/lib/content.ts`, `ENTITIES` registry). |
| Artist profile | `artists` row (name, bio, hero_image_url, template, spotify_artist_id, bandsintown_name, shopify_domain). **Read LIVE by `get_public_site`** — i.e. profile edits are instant, NOT draft. |
| Media | `media` table (purpose: hero_video/profile_photo/gallery_image) + public `media` Storage bucket, per-artist/by-use folders, path-RLS. **Live.** |
| Integrations | Spotify (built), Bandsintown (built, compliance-blocked), Shopify (built, per-store token in Vault via `integrations`). |
| Templates | `classic` + `cinematic`, dispatched by `artist.template` (`src/components/artist-template.tsx`). |
| Public site | `/[slug]` via `get_public_site` (SECURITY DEFINER); manager `/artists/[id]/preview` via working rows. |
| Dashboard | **Single page** `/artists/[id]` — header (template/preview/view/publish) + Spotify/Bandsintown/Shopify/Media panels + Tracks/Tour/Merch/Links sections. `publishAll` = one button. |
| Auth | admin + single manager via `artist_managers`; `is_admin()`/`is_manager_of()`. |

---

## 3. Target architecture

**Shell:** per-artist **left sidebar**; each section a route under
`/artists/[id]/…` sharing a layout (`src/app/artists/[id]/layout.tsx`) that loads
the artist once + renders the sidebar and the persistent action bar
(Preview · View · **per-section Publish**).

Routes:
```
/artists/[id]            → Overview
/artists/[id]/tracks
/artists/[id]/videos
/artists/[id]/tour
/artists/[id]/merch
/artists/[id]/links
/artists/[id]/site       → structured site editor
/artists/[id]/media      → (may fold into /site)
/artists/[id]/settings
/artists/[id]/preview    → (exists) full-site preview
```

**Risk — layout data loading:** the shared layout and each page both need the
artist + section data. Don't double-fetch. Load artist + "unpublished" summary in
the layout; each page fetches only its own rows. Watch Next 16 layout/page
caching (segments cache independently).

---

## 4. Cross-cutting decisions & risks (resolve BEFORE coding)

### 4.1 Publish-versioning consistency — THE foundational decision
You chose **per-section publish**. But today **only content is draft→publish;
profile + media are live**. So "Publish site edits" currently has nothing to
publish. Two ways out:

- **(A) Version everything** — snapshot artist profile (`entity_type='artist'`)
  and media (`entity_type='media'`) into `revisions`; `get_public_site` reads the
  *published* profile/media, not the live row. Pro: one consistent model, real
  draft state on the Site page. Con: refactor `get_public_site` + `getWorkingSite`
  + publish; preview/live divergence semantics for profile.
- **(B) Two lanes** — **Content** (tracks/tour/merch/links + bio/photos/site text)
  = draft→publish; **Settings/config** (domain, visibility, SEO, template) =
  instant. The Site editor's text/images become content (need versioning); only
  config stays live. Pro: config *should* be instant anyway. Con: must still
  version profile text/media (so same refactor as A for the content half).

**Recommendation: (B).** Draw the line at *fan-visible content vs operator
config*. Version profile text + media into `revisions` so the Site page has a
real draft/publish; keep Settings instant. **This refactor is the gate for the
whole restructure** — do it first (§6, phase 0).

**Risk:** `get_public_site` becomes the single most-edited function; every change
needs the public-read isolation tests re-run. Template field-set must map to
versioned entities.

### 4.2 Audio hosting + player (Tracks) — DECIDED: GATED (no download)
**Decision (user): gated audio.** Uploaded audio must not be freely downloadable
(protects unreleased exclusives). Architecture:
- **Private bucket** `audio` (NOT public) — separate from the public `media`
  bucket. Path `{artist_id}/audio/<file>`, path-RLS for writes (same pattern).
- **Signed, short-lived URLs:** the public site/player fetches a **signed URL**
  (e.g. 60–300s TTL) per play via a tiny endpoint or a SECURITY DEFINER /
  service-role server route keyed by slug+track. The raw object is never publicly
  reachable. **Risk:** signed URLs still permit a determined user to grab the file
  during the TTL — "gated" raises the bar, isn't DRM. Acceptable; note it.
- **Formats:** mp3/m4a only (no serverless transcoding). Validate type/size.
- **Player:** one client component; **only one track plays at a time**; it
  refreshes the signed URL on play. Seeking on expiring URLs needs care.
- **Cost/rights:** egress scales with plays; "I own this recording" ack on upload;
  DMCA/takedown path later.
- **Phasing:** higher complexity than public files → its own phase (after the
  restructure + site control land).

### 4.3 Multi-source import (DECIDED: one catalog source per artist)
**Decision (user):** an artist picks **ONE** track-catalog source — Spotify *or*
Apple *or* Deezer — never a combination. So there is **no cross-service merging
and no ISRC/dedup problem.** Each import dedups within its own source by the
source's track id (the existing `syncExternal` model already does this).
- **Tracks page:** a "catalog source" selector (pick one of Spotify/Apple/Deezer,
  or Manual). Switching source is allowed but replaces the imported set for that
  source (manual tracks untouched, per the existing don't-clobber rule).
- **Per-source clients:** Spotify [built] → **Deezer** (public API, easiest) →
  **Apple Music** (signed ES256 JWT, server-generated/refreshed — more work).
  Keys are *global* (we read public catalogs), in env like Spotify.
- **Separate content types (no conflict with the catalog):** **YouTube** →
  Videos page (API key, quota); **SoundCloud** → embed/link only (API closed).
- **Schema:** `tracks` keeps a per-source id (`spotify_id`, add `apple_id`,
  `deezer_id`) — NOT ISRC. Only one is populated per artist.
- **Rate limits:** YouTube has a daily quota; cache + backoff (pattern exists).
  Apple token rotation must not block a sync.

### 4.4 Custom domains — DEFERRED (not relevant yet)
**Decision (user): not now.** Sites stay on `/[slug]` paths. No subdomain/custom-
domain routing, no `domains` table, no DNS/TLS work in scope — this removes the
single highest-risk infra item. **Hosting will be Vercel**, so when this returns:
subdomains via wildcard (`*.<base>`) are easy, custom domains via the Vercel
Domains API (host-routing in `proxy.ts` mapping `Host`→slug, verification, auto-
TLS). Park it.

### 4.5 Site editor — lifting hardcoded strings
Taglines ("DJ & Producer"), section headings ("SHOWS/WORK/ABOUT"), "Bookings",
booking email, section visibility/order are **hardcoded in templates today**.
- Introduce per-artist **`site_content`** (a JSON blob on `artists`, or a small
  key/value table) for template-overridable strings + a `sections` config
  (on/off, order). Template reads override-or-default.
- **Template-aware schema:** each template declares its editable field set; the
  Site editor renders fields from that schema. Adding a template = adding a schema.
- Preview must reuse the same template against working data (already the pattern).

### 4.6 SEO / OG (Settings)  ·  Visibility DEFERRED
- **SEO [in scope]:** extend `generateMetadata` in `/[slug]` with description +
  OG image. OG image: start from an uploaded/derived image (`media` purpose
  `og_image` or reuse profile/hero); dynamic `@vercel/og` generation later.
- **Visibility — DEFERRED (user: "just Live for now"):** every site is public/
  live. No coming-soon/private/password states yet, so no per-site password auth
  to build. (Revisit when artists need pre-launch privacy.)

### 4.7 New tables → RLS
`releases`, `domains`, `analytics_events`, audio rows, and any `site_content`
table each need `enable row level security` + a `*_rw` policy
(`is_admin() OR is_manager_of(artist_id)`), plus isolation tests. The public read
path stays the only anon door.

---

## 5. Per-page specs

### 5.1 Overview `[NEW]`
At-a-glance: next show (min future `tour_dates`), latest release, **unpublished
diff** (working vs latest published per entity — see risk), site status
(live/template/url), quick actions (+Track/+Show/Publish all).
- **Risk:** the unpublished diff needs a working-vs-published comparison per type;
  build a `diffUnpublished(artistId)` helper once, reuse on Overview + Publish.

### 5.2 Tracks
List + reorder. **Manual:** upload audio (mp3/m4a) + title + cover (Media-backed).
**Import:** Spotify [built], Deezer, Apple. Hosted → inline player; linked →
embed/"Listen on." Per-section Publish.
- Schema: `tracks` += `isrc`, `audio_path` (Storage), `provider_url` per source.

### 5.3 Videos `[NEW]`
YouTube import + SoundCloud embeds → feeds cinematic "Work → Videos/Sets." New
`videos` content type (id, artist_id, title, provider, embed_url, source, isrc n/a).
- **Decision:** is "Videos" its own published entity (yes — `entity_type='video'`)?

### 5.4 Tour dates
Manual [built] + Bandsintown [built, blocked] + Ticketmaster. Per-section Publish.

### 5.5 Merch
Display + link-out. Shopify pull [built] or hand-enter; Buy → their store.

### 5.6 Links
Social/links [built]. (Footer/socials source for cinematic.)

### 5.7 Site editor `[NEW]`
Structured fields (template-aware): hero media, profile photo, bio, taglines,
section headings, section toggles, booking email. Writes `site_content` + media.
Visual inline editor = explicit v2.

### 5.8 Settings `[NEW]`
**In scope:** SEO & OG, integrations hub (all connect/disconnect in one place),
account (login/notifications). **Deferred:** custom domain (§4.4), visibility
(§4.6) — both parked per the decisions above.

### 5.9 Roadmap (later phases)
- **EPK:** generated press page (bio/photos/releases/stage-plot/tech-rider/
  contact) at a shareable URL; a few EPK-only fields + file uploads.
- **Release pages / smart links:** a `releases` entity grouping tracks + DSP links
  + pre-save; auto-landing page.
- **Analytics:** event capture (views, link/ticket/buy clicks) → table + view;
  privacy/consent considerations.

---

## 6. Build sequence (dependency-ordered)

**Phase 0 — Foundation (do first; unblocks everything):**
1. Publish-versioning refactor (§4.1 option B): version profile text + media into
   `revisions`; split content-vs-config. Re-run public-read isolation tests.
2. Dashboard shell: `layout.tsx` + sidebar; split the mega-page into routes
   (move existing panels/sections, no new features). Per-section Publish buttons
   (replace `publishAll`). `diffUnpublished` helper.

**Phase 1 — Site control:** Site editor (lift strings → `site_content`) +
Settings (SEO/OG, integrations hub, account). Overview + `diffUnpublished`.

**Phase 2 — Tracks depth:** per-artist catalog source (Spotify/Apple/Deezer);
Deezer importer.

**Phase 3 — Gated audio:** private `audio` bucket + signed-URL play endpoint +
inline player (§4.2).

**Phase 4 — More importers:** Apple Music, Ticketmaster, YouTube (+ Videos page).

**Phase 5 — Roadmap:** EPK → release pages/smart links → analytics.

*(Custom domains + visibility/password parked until needed.)*

> Ship gate after Phase 1: the restructured dashboard + site control is a
> coherent, demoable product on its own.

---

## 7. Decisions log (all resolved)

1. **Publish model** — content (incl. bio/photos/site text/media) = draft→publish;
   config (SEO etc.) = instant. Profile text + media get versioned. *Build first.*
2. **Catalog source** — ONE per artist (Spotify *or* Apple *or* Deezer); no
   cross-source merge, no ISRC.
3. **Audio** — gated (private bucket + signed URLs); mp3/m4a; ownership ack;
   later phase.
4. **Visibility** — Live only for now (no coming-soon/private/password yet).
5. **Custom domains** — deferred; stay on `/[slug]`. Hosting = **Vercel** (for
   later).
6. **Base domain** — not relevant yet.

---

## 8. TDD test order (write these FIRST, in this sequence)

The project rule holds: **write the failing test, watch it fail (Red), implement
the minimum to pass (Green).** Tests are derived from the §7 decisions and follow
the §6 dependency chain — a phase's tests are written before its code, and each
phase's tests must stay green as the next is built. All integration tests hit the
real hosted DB, run sequentially (`fileParallelism:false`), under Node 22.

For every new table/bucket: an **isolation test is mandatory and comes first**
(manager A can never read/write/upload B's). That's the non-negotiable gate.

### Phase 0 — Foundation (these gate everything)
*Publish-versioning (currently profile + media are LIVE — these start RED):*
- `tests/publish-profile.test.ts` — editing bio/hero/template writes a DRAFT:
  the public site (`get_public_site`) is unchanged until publish; `getWorkingSite`
  (preview) shows the edit; after publish the public site shows it. (Red today.)
- `tests/publish-media.test.ts` — same contract for media (upload → not public
  until publish → preview shows it → publish → live).
- `tests/publish-sections.test.ts` — per-section publish: publishing `tracks`
  does not publish unpublished `merch`; `diffUnpublished(artistId)` reports a bio
  edit and a new track as pending, nothing when clean.
- (App) sub-route protection: anon/non-owner hitting `/artists/[id]/tracks` etc.
  is redirected/404'd (the proxy already guards `/artists/*` — assert it holds
  for the new routes).

### Phase 1 — Site control
- `tests/site-content.test.ts` — **isolation first** (A can't read/write B's
  `site_content`), then override behavior (template renders the override string
  when set, the default otherwise) and that site-text edits are draft→publish.
- `tests/seo.test.ts` — `generateMetadata` returns the artist's title/description/
  OG image; falls back sensibly when unset.
- `tests/settings.test.ts` — SEO/account fields save and apply instantly (config
  lane, not draft).

### Phase 2 — Catalog source
- `tests/catalog-source.test.ts` — an artist has exactly one source; switching
  source replaces that source's imported tracks and **never clobbers manual**
  (extends the existing sync conflict tests).
- `tests/deezer.test.ts` — client (mocked fetch): mapping, pagination, error
  shaping, 429 — mirrors `spotify.test.ts`.
- `tests/sync.deezer.test.ts` — insert/update/skip-manual + **cross-tenant
  denial** against the real DB.

### Phase 3 — Gated audio
- `tests/audio-storage.test.ts` — **isolation first**: A uploads to A's audio
  folder; CRITICAL A cannot upload to B's; **CRITICAL the raw audio object is NOT
  publicly reachable** (anon fetch of the path is denied).
- `tests/audio-signed-url.test.ts` — the play endpoint returns a working signed
  URL for a published track; it expires; CRITICAL it won't sign another artist's
  audio / unpublished audio.

### Phase 4 — More importers
- Per importer (Apple, Ticketmaster, YouTube): a client test (mocked fetch) + a
  sync/isolation test, same shape as Spotify/Bandsintown/Shopify.
- `tests/videos.test.ts` — Videos content type: isolation + publish + public-read.

### Phase 5 — Roadmap
- EPK / release pages / analytics: isolation + behavior tests authored alongside
  each design (not specced until reached).

**Regression guard:** the current suite (121 tests) must stay green through every
phase; the public-read isolation tests are the canary for any `get_public_site`
change (Phase 0 + 1 touch it heavily).
