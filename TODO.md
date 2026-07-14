# TODO

## Roadmap decisions — 2026-07-08 deep-dive review

Sequenced plan agreed with Sam after a full codebase/DB/plans review. Order:

1. **Finish the uploads/toasts thread** (current work) — close out the remaining
   silent `<form action>` paths below before starting anything new.
2. **Hygiene batch** (low-risk, do before the music restructure):
   - [x] Re-ran `/steaksauce full` (2026-07-08) — `steaksauce.md` re-baselined to the
         live DB: 17 tables · 2 views · 21 functions · 3 buckets. Verifier clean (no
         dead-schema tables, no broken rpc calls, all FKs resolve).
   - [x] Fix stale `.env.example` — now documents `YOUTUBE_API_KEY`,
         `TICKETMASTER_API_KEY`, and `APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY/STOREFRONT`.
         (2026-07-08)
   - [x] `rls_auto_enable` drift — RESOLVED by documenting, not by migration.
         Exact function def + the event-trigger wiring are now recorded in
         `steaksauce.md` (Functions section). Decided NOT to add a capture migration:
         the event trigger is named `ensure_rls` (fires `rls_auto_enable()`), and
         `CREATE EVENT TRIGGER` needs superuser — a `db push` could fail mid-apply
         and leave the live RLS-safety trigger DROPPED. Not worth it given this DB is
         never rebuilt from migrations. If a from-scratch rebuild is ever needed, the
         def is on hand in steaksauce.md.
   - [x] Add `visible` columns to `tracks` + `links` (migration
         `20260708150000_tracks_links_visibility.sql`, pushed + verified). Additive,
         non-breaking, default true; NOT yet gated in get_public_site.
         - [x] **RESOLVED 2026-07-14 — both wired, neither dropped.**
               `tracks.visible` was woken by `20260710170000` (Released became a
               library-only label; the site gates each song on its own flag). This
               note claiming tracks is "unused and ungated" was stale from then on.
               `links` really was inert on BOTH ends until `20260714160000`: the
               door had no filter AND nothing wrote the flag (the editor only ever
               called `setOnSiteAction` for photos + songs). Now gated, with a
               per-link toggle in the editor inspector.
               Both follow the LIVE-toggle model (not publish-reconcile), so they
               stay out of `ON_SITE_ENTITIES`.
         - [x] The flag itself was renamed `visible` → `on_site` across all 7
               tables in `20260714150000`, matching the language the UI and code
               already used. See [[music-released-unreleased]] for the sibling
               Released/Unreleased split, which is a SEPARATE axis.
3. **Thin UI test layer** — SUBSTANTIALLY DONE 2026-07-08. Harness: React Testing
   Library + jsdom, opted in per-file via `// @vitest-environment jsdom` (the
   DB-backed suite stays on the `node` env); server actions mocked as plain async
   fns so these tests touch NO database; `fireEvent` (no user-event dep); no
   Playwright/E2E (would drive prod data). See [[ui-test-harness]] memory.
   9 files / 32 tests, covering the logic-heavy client pieces:
   - [x] toast/form layer: `save-form`, `action-button`, `catalog-source-form`,
         `delete-button`, `create-modal`
   - [x] publish password gate: `publish-bar`
   - [x] on-site selection delta: `use-on-site-selection`
   - [x] tracks filter/sort/chips: `tracks-browser` (TrackCard stubbed)
   - [x] chip + sort control: `filter-bar`
   Suite now 70 files / 415 tests, all green. Remaining (optional, lower value —
   thin compositions of already-tested primitives): SyncPanel/ShopifyPanel,
   ReleasesBrowser. Do them if they churn in the restructure.
4. [x] **Music restructure** — DONE 2026-07-09 (see MUSIC_RESTRUCTURE.md for the
   full ledger). One Music surface: **Released** (platform presence, public) vs
   **Unreleased** (uploads/demos, dashboard-only), derived via `lib/music.ts` and
   mirrored by the SQL doors (`20260709120000`, pushed + zero live impact
   verified). `album_name` fallback killed; per-platform badges on track cards;
   copilot counts split released/unreleased; skeen-website uses authoritative
   `release_type`. 439 tests green, prod build + authenticated dogfood done.
5. **EPK-only fields** — build stage plot, tech rider, press quotes, and
   downloadable press assets (see "Phase 5 review follow-ups" below; scope now
   confirmed as build-it, not derived-only).
6. **Wire skeen-website content-in** — the site fetches `videos`, `site_content`,
   and `release_type` but never renders them, so publishing videos has no effect on
   the live site. Consume them in the mappers (Work tab from `videos`, use
   authoritative `release_type` instead of the cover/track-count heuristic).

Decisions that don't change the sequence:
- **Analytics landing** (redesign centerpiece): build on data we OWN now (site
  visits, catalog counts, link/ticket/buy clicks), leave a slot for real streaming
  data to drop in later. The prototype's "monthly listeners/streams" are fabricated.
- **Bandsintown gate**: stays a TODO note (not enforced in code) — see bottom section.

### New to-dos from the review
- [ ] **Get a GOOGLE_API_KEY to switch on the Drive integration** (built + tested
      2026-07-09; see the Drive section below). Google Cloud console → new/any
      project → enable "Google Drive API" → Credentials → API key → paste into
      `.env.local` as `GOOGLE_API_KEY`. Free; public-data reads only.
- [ ] **Get Ticketmaster + Apple Music credentials, then turn them on.** Both are
      code-complete + tested but have no keys, so they show in the Integrations hub
      as clickable and fail at runtime. Apple needs a MusicKit Team ID + Key ID +
      private key (Apple Developer account); Ticketmaster needs a Discovery API key.
      Once Sam provides them: add to env, wire in, verify the pulls, and add
      Ticketmaster attribution when it goes live (their terms require it).
- [ ] **DECIDE copilot write-auth before implementing write tools** (next project
      step). Today `lone-star-agent` uses the Supabase `service_role` key (full
      RLS bypass, plaintext `.env`) and ships `placeholderAuth()` on its channel —
      fine for a local, single-manager, read-only tool, NOT safely deployable. Before
      wiring any write/upload/publish tool, decide the transport: move behind the
      app's HTTP APIs (RLS + validation enforced) or an RLS-scoped per-manager client.
      Do not add write tools on the god-key transport.

## Google Drive integration — BUILT 2026-07-09 (needs GOOGLE_API_KEY to go live)

Public-folder-link model: the manager pastes a link-shared folder URL in
Integrations → Files; the dashboard browses it (names/sizes/thumbnails stream
from Drive, zero storage cost) and **copy-imports** selected files server-side
into our buckets so they behave exactly like uploads. Audio → Unreleased songs
(gated `audio` bucket), videos → uploaded/off-site rows (`videos`), images → the
Photos page's gallery block (`media`, `gallery_image`) — moved off the Site page.
Dedupe via
`drive_file_id` (partial unique, migration `20260710120000`, pushed). Caps:
audio 30 MB / images 25 MB / video 100 MB (bigger videos → the direct uploader).
- [ ] Sam: create the API key (see "New to-dos") — until then the Drive card
      shows a friendly "key not configured" error on Check/browse.
- [ ] Later: a public gallery section (gallery images are dashboard-only today);
      raise the video cap by streaming the server-side copy instead of buffering.

## Storage — taking an asset off-site does NOT revoke its URL (open, 2026-07-14)

Sam confirmed some uploads are unreleased / sensitive, so writing this down properly.
**Verified against the live project on 2026-07-14, not inferred from the policy SQL.**

What is NOT a problem (checked, don't re-litigate):
- **Enumeration is already closed.** Both buckets scope storage SELECT to the owning
  manager (`media manager read`, added by `20260708120000` step 4, which dropped the old
  blanket `media public read`; `videos` never had an anon select policy). An anon
  `.list()` on `media` and `videos` returns `[]` at the root, the artist folder, AND the
  exact subfolder holding a known object. Nobody can browse an artist's assets.
- Storage paths are `{artist_id}/…/<uuid>`, so URLs aren't guessable.
- `on_site` correctly hides the ROW from `get_public_site` — the site stops linking it.

What IS the problem:
- Both buckets are `public = true`, so `/object/public/…` **bypasses RLS entirely**.
  Verified: an anon HEAD on a real object returns **200**. So `on_site` gates *discovery*,
  never *access*. Once a URL has been public — the item was on-site, so the URL was in the
  page source, and may now be cached, shared, scraped, or CDN-held — taking it off-site
  does not take it down. The manager sees it vanish from the site and reasonably assumes
  it's gone. It isn't. (Same shape as the `get_release` bug fixed in `20260714130000`,
  one layer lower.)
- An asset that was NEVER on-site is protected only by an unguessable UUID path. That's
  "anyone with the link", not "private" — fine for a draft photo, NOT fine for unreleased
  audio/video if the URL ever escapes.

- [ ] Decide the fix. Options, cheapest first:
      1. **Split buckets** — keep `media`/`videos` public for genuinely-public assets, add
         a private `drafts` bucket, and move an asset on publish/unpublish. Cheap, no
         render change for live content, but moving objects on toggle is fiddly.
      2. **Private buckets + signed URLs** — flip `public = false`, serve via
         `createSignedUrl` with a TTL. Correct and complete, but touches how
         **skeen-website** renders every image/video (it builds public URLs directly —
         `mediaPublicUrl` in `lib/mapSite.ts`), so both repos ship together. ISR(60s)
         caching + URL expiry need thought.
      3. **Accept it** — document that off-site ≠ private, and never upload anything
         genuinely sensitive. Free, but the manager UI currently implies otherwise.
- [ ] Whichever way: the UI should stop implying "off site" means "taken down".

## Analytics — record_event rate limit — DONE (2026-07-14)
- [x] Per-artist burst cap on the anon `record_event` door (`20260714140000`): 120
      events/artist/minute, dropped SILENTLY (fire-and-forget telemetry from a fan's
      page — an exception would surface there, unlike the subscribe form).
      Deliberately NOT the subscribe door's 15/min: subscribe caps signups, which are
      rare, while this fires on every view and click, so 15/min would delete real
      analytics from any artist having a good day. 120/min = 2/sec sustained, far
      above real traffic at this scale.
- [x] `analytics_summary`: revoked the implicit PUBLIC execute grant (same migration).
      Hygiene only — it's SECURITY INVOKER, so RLS already returned anon zero rows.
- [ ] **STILL OPEN: per-IP limiting belongs at the EDGE.** A DB function cannot see the
      client IP, so the cap above bounds storage growth but does not target abuse — and
      during a flood the attacker fills the window and the artist's REAL events drop
      alongside the junk. Do this in the Next.js route (and share it with the audio play
      route) if analytics abuse ever becomes real.

## Storage GC — DONE (2026-07-08)
- [x] Video objects GC'd at PUBLISH (`gcVideoObjects` in publishEntityAction): after
      publish the working rows are the complete referenced set, so orphaned files
      (deleted/replaced videos) are removed. Bound to publish, never delete, so the
      LEFT-JOIN gate keeps serving deleted-but-still-published videos until tombstone.
- [x] Media objects GC'd at DELETE (`deleteMediaAction`): media is a live table (no
      revision deferral), so the row delete unpublishes immediately — safe to remove then.

## Action-feedback toasts — DONE (2026-07-08)
- [x] Every remaining silent `<form action>` now toasts on success AND error. The
      actions return `{ error? }` (saves/publish/assign) or `{ ok, error? }` (pulls)
      instead of throwing, and the forms went behind a client wrapper: a new
      `ActionButton` (field-less: per-section Publish, integration Pull, Shopify
      Disconnect) and `SaveForm` gained `resetOnSuccess` for the ADD forms. Covered:
      generic ADD forms (`addContentAction` in content-sections + tracks-browser),
      `setTrackReleaseAction`, `publishSectionAction` (SectionShell + SectionToolbar),
      all six integration saves (shared `saveArtistField` helper) + their pulls,
      Shopify connect/pull/disconnect, and the catalog-source switch. Typecheck + 384
      tests green.

## Upload follow-ups
- [ ] Very large video uploads use `.upload()` (no resumable/progress). Consider tus/
      resumable + a real progress bar if managers hit failures on big files.
- [ ] Public `videos` bucket = no retraction on unpublish (the URL stays fetchable if
      known, though it's never exposed for unpublished rows). Fine for now; revisit if
      "unpublish must hide the file" becomes a requirement (would need private+signed, like audio).

## Manager cross-artist tour calendar (later)
- [ ] A manager-level view that aggregates EVERY client's tour dates into one
      place — list + calendar toggle, color-coded by artist — so a manager can
      plan across the roster. New top-level surface (not the per-artist tour page,
      which stays a single-artist list). Deferred by decision 2026-07-07.

## Per-artist tour map (prep done — coords captured)
- [ ] Interactive map for the artist tour page. Coordinates are already captured +
      stored (`20260707140000_tour_coords.sql`; Bandsintown/Ticketmaster syncs).
      Remaining: geocode manual/city-only dates → lat/lng, and a client map
      (**Leaflet + monochrome CARTO/OSM tiles**, no key). Decision 2026-07-07: the
      map is **NOT always shown** — the default tour view is the centered, spacious
      date LIST; the map is an opt-in toggle (List / Map).

## Media — done
- [x] Hero videos stream from Supabase Storage (`media` bucket,
      `{artist_id}/hero-videos/`), registered in the `media` table by purpose.
- [x] Dashboard upload UI (MediaPanel): managers upload/delete hero videos and a
      profile photo, direct-to-Storage (RLS scopes writes to their folder).
- [x] profile_photo wired into the public About (falls back to hero_image_url).
- [x] gallery_image now has a home: the **Photos page** (moved off the Site page)
      holds the gallery block + uploader / Drive import. (Public gallery section is
      still a later item — gallery images are dashboard-only today.)

## Gated audio (Phase 3) — deferred follow-ups (from the security review)

Built and tested; these are accepted-by-record gaps, not blockers.
- [ ] **Rate-limit the play route** `src/app/api/audio/[slug]/[trackId]/route.ts`.
      It's anon and mints a signed URL per call → a DoS / Storage-egress vector and
      a way to harvest a rolling stream of valid 1h links. Needs a rate-limiter
      (per slug+track, or a token/Referer check). The 1h share window is inherent
      to signed URLs ("gated raises the bar, isn't DRM" — §4.2).
- [ ] **Per-IP rate-limit for the anon subscribe door** `subscribe()` /
      `subscribeAction` (`src/app/[slug]/actions.ts`). DONE so far: a honeypot +
      a per-artist burst cap (15 signups/min) inside `subscribe()`
      (`20260706150000_subscribe_rate_limit.sql`). STILL OPEN: a DB function can't
      see the client IP, so a distributed/slow-drip flood across artists isn't
      capped — add a per-IP limiter at the edge (share it with the play route).
- [ ] **Cinematic template has no per-track player** — gated audio surfaces only on
      `classic` (`artist-site.tsx`); cinematic is embed-first (`cinematic-work.tsx`).
      A manager on cinematic who uploads audio gets no player. Either wire a player
      into cinematic or annotate/disable the uploader when `template === 'cinematic'`.
- [ ] **"I own this recording" ack on upload** (`track-audio-uploader.tsx`) — §4.2
      asked for a rights ack before hosting audio; not built. Rights/DMCA posture.
- [x] **Extract a shared `useStorageUpload` hook** — DONE (2026-07-08). The hook +
      `lib/upload.ts` (validate/path/orphan-cleanup) + `FileDropField` now back all
      three uploaders (media, track audio, video). Audio keeps its inline label; media
      + video use the drop field.

## Phase 4 review follow-ups (consolidation — not bugs)

The Phase-4 security review was clean (embed-XSS gate airtight, videos allowlist
correct, Apple JWT sound). The NaN-retry bug + iframe sandbox were fixed inline.
These are consolidation/altitude items, each best done as a focused pass:
- [x] **Extract a shared HTTP helper** — DONE. `src/lib/http.ts` `httpGetJson`
      now owns the 429/NaN-guarded Retry-After loop for the 6 GET clients
      (Spotify/Bandsintown/Deezer/Ticketmaster/Apple/YouTube); quirks via
      `headers`/`onBody`. Shopify (GraphQL POST) keeps its own path. ADR-0005
      updated; tests/http.test.ts locks the NaN guard.
- [x] **Consolidate the three section lists** — DONE. `(dashboard)/sections.ts`
      `DIFF_SECTIONS` (typed against UnpublishedDiff) is the single source; the
      sidebar dirty dot is DERIVED via `dirtyBySeg(diff)`, and Overview renders
      DIFF_SECTIONS. Adding a section can't silently miss its dot now.
- [x] **Video altitude** — DONE. `GenericEntity = Exclude<CrudEntity,'video'>`
      types the generic form (FIELD_UI/ContentSection); the dead `FIELD_UI.video`
      stub is gone and `video` can't reach the generic form (compile error).
      (embed_url-via-updateContent left as-is: no UI calls it and isSafeEmbedSrc
      gates render — non-exploitable.)
- [x] **Cinematic Videos** — DONE. cinematic template now renders a themed Videos
      section (safe iframes) + a conditional #videos nav item; `videos_heading`
      added to the cinematic schema.

## Phase 5 review follow-ups

The review was clean on security (all 3 anon doors IDOR-closed, no with-check(true),
allowlisted, safeHref at render). Fixed inline: generic-update guard (release/video
can't be raw-updated — actions typed GenericEntity), analytics silent-undercount
(now an exact SQL group-by via analytics_summary), slug-collision suffixing,
event-type list deduped (lib/events). Remaining:

Deferred SCOPE the plan (§5.9) named but v1 cut (build when needed):
- [x] **Releases group tracks** — DONE. Tracks belong to a release via a real
      `release_id` FK (`20260706170000_track_release_membership.sql`); the release
      editor assigns them, the smart-link renders the tracklist (get_release, by
      release_id with an album_name fallback), and the release card shows its
      track count.
- [ ] **Pre-save** — §5.9 listed it; not built.
- [ ] **EPK-only fields + file uploads** — §5.9 listed stage-plot / tech-rider +
      "a few EPK-only fields"; v1 EPK is 100% derived from published content. Add
      EPK config fields + a (private?) asset upload for the rider/stage plot.
- [ ] **Analytics consent banner** — privacy is handled (no PII, target truncated),
      but no consent UI. Add if/when targeting jurisdictions that require it.

Hardening (low priority):
- [ ] **Atomic release-link edits** — addReleaseLinkAction/removeReleaseLinkAction
      read-modify-write the links jsonb; two concurrent edits last-write-win (drop a
      link). Single-manager today so low-prob; fix via in-SQL `links = links || $1`
      / `links - $index` (an RPC) when multi-session/roles land.

## Bandsintown — compliance before going live (BLOCKED on Bandsintown)

The Bandsintown integration (Milestone 7) is built and tested, but **do not enable
it in production until the items below are resolved.** Bandsintown's API is not
self-serve and has display/storage obligations.

**Blocking step — get an app_id + clarify use case**
- [ ] Email `support@bandsintown.com` to request an `app_id` (no signup page; an
      app_id = written acceptance of their terms).
- [ ] In that email, clarify two things their terms are strict about:
  - **Storage:** their terms permit only *session-based caching* with notice +
    update-on-change + removal when content is removed upstream. We **persist**
    events in `tour_dates` and publish snapshots into `revisions` — and, as of
    the tour-map prep (`20260707140000_tour_coords.sql`), also the venue
    **latitude/longitude**. Coords are dashboard-only (NOT in the public snapshot),
    but they are still persisted Bandsintown data, so they ride under this same
    not-live compliance gate. Confirm this "sync events to your website" use
    (now incl. coordinates) is acceptable. (Ticketmaster coords are captured too;
    their Discovery API needs attribution — track that when TM goes live.)
  - **Commercial use:** needs Bandsintown's *written approval*. If Lone Star is a
    paid service, get that approval.

**Implementation changes once cleared (for terms compliance)**
- [ ] **Attribution + CTA buttons** on the public tour-dates section
      (`src/components/artist-site.tsx`). Terms require Bandsintown branding and
      the **Track / RSVP / Notify Me** buttons + ticket link as the primary ticket
      link. Build them from the event URL + `&trigger=track` / `&trigger=rsvp_going`
      / `&trigger=notify_me` (see Bandsintown API docs). Today we render only a
      plain "Tickets →" link.
- [ ] **Preserve URL params** — already done (we store `ticket_url`/event url
      verbatim, so `app_id`/`came_from`/`utm_*` survive). Keep it that way; don't
      strip params when adding CTAs.
- [ ] **Upstream-removal cleanup** in the sync (`src/lib/sync.ts`): when a synced
      event no longer comes back from Bandsintown, remove it (their terms require
      removing cached content that's gone upstream). Current sync only
      inserts/updates and tombstones rows the *manager* deletes, not upstream
      removals.

**Refs:** Data Application Terms — https://corp.bandsintown.com/data-applications-terms ·
API docs — https://help.artists.bandsintown.com/en/articles/9186477-api-documentation

> Spotify (Milestone 6) has no such gate — it's standard client-credentials and
> already wired once `SPOTIFY_CLIENT_ID/SECRET` are in `.env.local`.
