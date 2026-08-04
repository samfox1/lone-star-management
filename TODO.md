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

## Contact enquiries — BUILT 2026-07-21 (needs Resend domain + secrets to go live)

Server-side send for artist-site contact forms, replacing skeen's `mailto:` handler
(which loses an enquiry whenever the visitor has no mail client). The public door is an
**Edge Function**, not an anon SQL door — it needs the client IP for per-IP rate
limiting and an outbound call to Resend, neither of which Postgres can do. See
**ADR 0010** and the runbook at **`docs/contact-endpoint.md`**.

Shipped: migrations `20260722120000` (tables) + `20260722130000` (functions), both
**applied**; `supabase/functions/contact/`; manager inbox at
`/artists/<id>/enquiries`; 77 tests. Recipient is resolved SERVER-SIDE only —
`artist_mail_settings.booking_email` → `links.role='booking'` →
`site_content.booking_email` → `mail_settings.default_to_email` — because accepting it
from the request body would make the endpoint an open relay on our verified domain.

**Blocked on Sam, in order — nothing sends until all four are done:**
- [ ] Sam: pick a domain **Lone Star controls** and verify it with Resend (SPF + DKIM).
      The long pole (DNS propagation). We cannot send `from:` an artist's own booking
      address unless we control that DNS — a spoofed From fails DMARC and lands in spam.
      The visitor goes in `reply_to`, which is what makes reply-to-enquirer work.
- [ ] Sam: `supabase secrets set` for `RESEND_API_KEY`, `CONTACT_IP_SALT`
      (`openssl rand -hex 32`), `CONTACT_ALLOWED_ORIGINS`, `CONTACT_DRY_RUN=true`.
      Template + rationale in `supabase/functions/.env.example`. These are Edge
      Function secrets, NEVER `.env.local` — one `NEXT_PUBLIC_` typo there ships the
      Resend key to every visitor's browser.
- [ ] Sam: seed the `mail_settings` singleton (needs the verified domain from step 1).
      Until it exists the endpoint 500s for any artist with no booking address of
      their own.
- [ ] Sam: `npm run fn:deploy`, then the curl checklist in `docs/contact-endpoint.md`
      with `CONTACT_DRY_RUN=true`. Send one to Resend's `delivered@resend.dev` sink
      before flipping dry-run off.

**Then, skeen side:**
- [ ] Add `sendContact()` to `lib/backend.ts` and swap `ContactModal`'s `mailto:`
      handler for it, with pending/sent/failed states. Keep the `mailto:` as the
      failure fallback so an enquiry is never simply lost.
- [ ] Declare `booking` as a link region in the manifest skeen posts on `ready`, so the
      manager can set the booking address from the editor (rung 2 above). `mapConfig`'s
      existing `role='booking'` resolution already matches.

**Deliberate deviation from the agreed plan, flagged for review:** we did NOT add a
`booking` link region to the built-in `classic`/`cinematic` manifests. A
`ManifestLinkRegion` is a contract with a `data-lse-link` anchor, and neither template
has a booking anchor — declaring it would show an inspector row for an element that
doesn't exist and quietly redefine link regions as "anchors, plus one that's secretly
mail routing". Instead `booking_email` was added to `TEMPLATE_FIELDS.classic`
(`cinematic` already had it), reusing the existing site-text machinery. Add the region
later if those templates grow a real booking anchor.

**Later (not blocking):**
- [ ] Per-artist sending domains. The schema already carries
      `artist_mail_settings.sending_domain` / `.resend_domain_id` /
      `.domain_verified_at`, so this is a data + Resend Domains API change, not a
      rewrite. Needs a pending/verified state in the UI since nothing sends until the
      artist's DNS is live.
- [ ] `contact_attempts` prunes opportunistically (`random() < 0.01`, 30 days) because
      there is no `pg_cron` here. Revisit if the table ever gets big enough to notice.

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

## Storage — off-site gates discovery, not access (open but NOT urgent, 2026-07-15)

**Re-measured 2026-07-15. The earlier framing of this entry was wrong** — it was written
from Sam's "some uploads can be unreleased/sensitive", which was about intent, and treated
as if such content already existed. It doesn't. What is actually stored:

| bucket | public | contents |
|---|---|---|
| `audio` | **false** | empty |
| `videos` | true | empty — all 83 videos are YouTube embeds (`storage_path` null) |
| `media` | true | 2 objects: skeen's `horizontal.mp4` / `vertical.mp4` hero clips |

So **exposure today is zero**: every stored object is a hero video, the most deliberately
public asset on the site. No track has uploaded audio.

**The most likely sensitive asset — unreleased music — is already private by design.**
The `audio` bucket is `public = false` and `signAudioUrl` (`src/lib/audio.ts`) is the
pattern: `audio_path_for_play` (a SECURITY DEFINER door) authorizes and returns the path,
then a service-role client signs THAT path — never a caller-supplied one — with a 1h TTL.
*The door is the authorization; the service role is just the signer.* Unexercised (no
audio uploaded yet) but built.

The mechanism, for the record (verified on the live project, not inferred from policy SQL):
- **Enumeration is closed.** Both public buckets scope storage SELECT to the owning
  manager (`media manager read`, `20260708120000` step 4 dropped the old blanket policy;
  `videos` never had an anon select). An anon `.list()` returns `[]` at the root, the
  artist folder, AND the exact subfolder of a known object.
- Paths are `{artist_id}/…`, so URLs aren't guessable.
- **But** `public = true` means `/object/public/…` bypasses RLS: an anon HEAD on a real
  object returns **200** regardless of `on_site`. So on-site gates *discovery* (the row
  leaves `get_public_site`) and never *access* — taking an asset off the site does not
  revoke its URL, and an asset that was never on-site rests on an unguessable path
  ("anyone with the link", not "private").

- [ ] **DEFERRED, deliberately** (decided 2026-07-15). Do NOT build private buckets +
      signed URLs for `media`/`videos` yet: it protects nothing today, it ships across two
      repos (skeen builds public URLs directly via `mediaPublicUrl` in `lib/mapSite.ts`,
      and ISR(60s) vs URL expiry needs solving), and the design would be guesswork without
      a real private asset to shape it.
      **Trigger to revisit:** the first time a display asset must not leak — a draft video,
      an unreleased cover. Copy the `audio` pattern (private bucket + a door that
      authorizes + a service-role signer); do not invent a second scheme.
- [ ] The manager UI still implies "off site" = "taken down". It doesn't mean that for the
      underlying file. Worth a word in the editor when the storage story is settled.

### Media GC — FIXED 2026-07-15
`gcMediaObjects` swept only `{artist}/gallery`, so replacing a hero video or profile photo
stranded the old object in a public bucket forever — referenced by nothing, collected by
no one. skeen had 6 strays (~17.6MB, `video1/2/3` × mp4+webm) from one hero change; they
were removed and the sweep now covers every folder in `MEDIA_FOLDERS`
(gallery / hero-videos / profile). Add a `media.purpose` → add its folder there.

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

## Editor links — support-act links — BUILT 2026-07-17 (skeen side pending)

The editor Links panel was redesigned 2026-07-17: rows collapse to just their label
and expand on click to reveal the label/URL edit + on-site toggle + remove (was an
always-open stack). Then support-act links were built on top:

- [x] **"+ support act" mentions are linkable.** `tour_dates.support_urls jsonb`
      (`20260717140000`, a name→url map) sits ALONGSIDE `support text[]` (names) so the
      two editors never clobber: the Tour page writes names, the Links panel writes the
      map. Rides `PUBLISHABLE.tour_date.snapshot` to the public door with NO
      get_public_site change (the door serves the revision `data` wholesale). Write path:
      `setSupportUrl` (lib/content) ← `setSupportUrlAction` (actions). Publish-gated.
- [x] **Links panel is grouped** (Sam's ask): "Socials" (the outbound links) and
      "Tour support" (each support act, labeled with the show it's on, its URL editable
      there). `SupportLinkTools` in editor-inspector.tsx; page.tsx flattens each date's
      `support` × `support_urls` into per-act rows.
- [ ] **skeen-website: zip names + support_urls into linked acts.** lone-star now sends
      `support: string[]` PLUS `support_urls: {name:url}`; skeen currently passes only
      `support` through (`lib/mapSite.ts`), so URLs don't render yet. Merge them in the
      tour mapper into `SupportAct[]` (`{name, url?}`) — `Shows.tsx` already renders +
      `safeHref`-gates that shape. See the handoff instructions (2026-07-17).
- [ ] One-time after deploy: existing published tour dates show as "edited" in the diff
      until republished (snapshot gained a `support_urls` key). Harmless; names render
      throughout.

## Editor gallery — orientation slots — BUILT 2026-07-20 (skeen side pending)

Skeen's photo collage (`About.tsx`) was stuck on 6 hardcoded bundled images: the backend
gallery was empty AND uploaded photos had no orientation, so skeen's aspect-based mosaic
defaulted every backend photo to landscape. Now:

- [x] **`media.orientation`** (`20260720120000`, nullable, CHECK horizontal/vertical) tags
      gallery photos. get_public_site's media branch CHERRY-PICKS fields, so it was
      redefined to emit `orientation` (unlike the pass-through branches — this one needed
      the SQL change). Rides `PUBLISHABLE.media.snapshot`.
- [x] **Editor Images panel = orientation groups with the asset picker**: `PhotoTools`
      renders two `MediaGrid`s (Horizontal / Vertical) — the SAME on-site-cards + asset
      picker + Replace/Remove UX as the video slots (Sam asked for parity, 2026-07-20).
      Add opens the picker over the WHOLE off-site asset library (any orientation — an
      untagged upload is never hidden); picking one PLACES it via `placeGalleryPhotoAction`
      (sets orientation + on_site in one write, so orientation is decided at placement, not
      upload). Remove takes it off-site (never deletes); Replace swaps. Cards are 3-up
      (`MediaGrid` gained a `cols` prop). Fix for: 6 uploaded skeen photos were invisible
      because the picker filtered candidates by a null orientation.
- [ ] **skeen-website: lay the gallery out by orientation.** get_public_site now sends
      `media[].orientation`. Update `lib/backend.ts` (add `orientation` to the media type),
      `lib/mapSite.ts` `mapGallery` (return `{url, orientation}[]` instead of `string[]`),
      and `components/About.tsx` (`aspectOf` reads orientation: horizontal 3:2, vertical
      2:3, null→3:2 — the mosaic already interleaves wide/tall). Keep the bundled
      STATIC_GALLERY fallback for an empty backend. See handoff (2026-07-20).
- [ ] One-time after deploy: existing published gallery photos read as "edited" once
      (snapshot gained `orientation`); republish clears it.

## Editor — manifest "links" panel (Phase 2) — BUILT 2026-07-20 (migration NOT applied)

Surfaces skeen's new `links` manifest category as its own inspector panel, so a URL binds
to a link-powered element BY KEY (`role`) instead of guessing from a label. Mirrors how
`styles` flows manifest → inspector.

- [x] manifest/markers/bridge: `ManifestLinkRegion` + `TemplateManifest.links`;
      `LINK_ATTR`/`linkRegion`; `SelectTarget {kind:'link'}` + `EditorMessage 'apply-link'`
      (BRIDGE_VERSION stays 2); `bridge-client` resolves `data-lse-link` (lowest
      precedence) + `applyLinkToDom`.
- [x] editor: `use-frame-bridge` stores `selectedLink` + `applyLink`; `editor-shell`
      threads `linkRegions`(manifest)/`linkValues`(DB, from page)/`selectedLink`/
      `onApplyLink`; `SiteLinkTools` panel (modeled on StyleTools), empty rows for unset
      links. Selecting the element in the frame opens it focused. Socials untouched (roled
      rows filtered out in page.tsx).
- [x] **MERGED into one Links tab** (Sam, 2026-07-20): dropped the separate `site_link`
      nav entry; `SiteLinkTools` is now the "Buttons" group inside the Links panel, beside
      Socials + Tour support. Reverses the Phase-2 brief's "two separate tabs" call.
- [x] persistence: `saveEditorLink`/`saveEditorLinkAction` (RMW, not upsert — the
      uniqueness is a PARTIAL index PostgREST can't target); `role` added to the link
      snapshot (`content.ts`).
- [ ] **APPLY THE MIGRATION** `20260721120000_links_role.sql` (`links.role` + partial
      unique index). Sam runs it. Then **un-skip** the live block in
      `tests/editor-link-save.test.ts` and republish so `role` reaches skeen.
- **Deviation from the brief (verified):** get_public_site needs NO change — its `links`
      branch serves each revision's `data` wholesale (unlike the media branch), so `role`
      rides the moment it's in the snapshot. Migration is column + index only.

## Editor Style panel — no-code controls — BUILT 2026-07-20 (skeen safelist pending)

Replaced the raw Tailwind class-string textareas (nobody could read "relative z-0 bg-white
text-black") with friendly controls. Sam's ask: select a section, get dropdowns for size,
color, boldness, font, etc.

- [x] `lib/site-editor/style-controls.ts` (pure, tested): each control OWNS a slice of the
      class string (size = text-<scale>, weight = font-<weight>, font = font-<family>,
      align, uppercase, italic, + palette colours) — read finds the current utility, apply
      swaps it and PRESERVES everything else (layout/spacing/z). Distinguishes the three
      `text-*` families (size vs colour vs align) and font weight vs family.
- [x] StyleTools rewritten as an accordion (one section open at a time; clicking the piece
      in the frame opens it). Friendly dropdowns/toggles; raw string still reachable under
      "Advanced". Same debounced save + optimistic frame repaint; store unchanged
      (site_styles.class_names). Universal controls always show; Font + Colour only when
      the site declares a palette.
- [x] Manifest gains optional `styleOptions` (fonts / textColors / bgColors) — the site's
      OWN tokens, threaded manifest → editor-shell → inspector → StyleTools.
- [ ] **skeen: (1) SAFELIST the editor vocabulary** in globals.css (Tailwind v4 only
      compiles classes it sees, so an applied class silently no-ops otherwise), and
      **(2) declare `styleOptions`** in its manifest (its flash-1/sky/momo/glitch tokens)
      so the Font/Colour dropdowns show real, labelled options. See handoff (2026-07-20).

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

## Soundcharts API — LONG-TERM (researched 2026-07-16, not building now)

Sam's interest, parked for later: use Soundcharts as the external analytics layer
for the dashboard — real streaming/social/chart data per artist, to fill the
"Analytics landing" slot that today is built only on data we own (site visits,
catalog counts, click events). This is a pursue-later item, NOT current work.

**What it gives us (per artist, one aggregated API):**
- Streaming: listener counts, popularity, retention, geo breakdown by city/country
- Social: follower counts + audience demographics across platforms, regional splits
- Charts: song + album chart positions across platforms
- Playlists: current placements + total playlist reach
- Radio: airplay spins + aggregated counts · Short video: TikTok/Reels stats
- "Soundcharts Score" (proprietary composite) · cross-platform IDs (match our
  stored Spotify/Apple identities)

**Technical fit is easy:** OAuth-style access token from client credentials in an
`Authorization` header (same shape as our Spotify client-credentials integration).
Base URL `https://customer.api.soundcharts.com`; ~5,000 calls/min; a free sandbox
(limited dataset) + 1,000 free production calls to prototype; paid plans 500k–60M
req/mo, ~$250/mo entry, mostly custom-quoted.

**⚠️ The real blocker is licensing, not integration** (same shape as the
Bandsintown gate above — see [[bandsintown-compliance-blocked]]). Their public-site
ToS (soundcharts.com/en/terms) is restrictive:
- Art. 5.1 forbids copying/modifying/distributing their data for pay without consent
  → building product features ON their data is caught, not just displaying it.
- Art. 5.3 bans exploitation where data is "incorporated into a service offer... to
  third parties" → a live dashboard feature inside a paid product is exactly this.
- Attribution alone does NOT unlock it: the credit rule lives inside a narrow
  exception for infrequent/unaltered/unpaid one-off client sharing, which a
  permanent dashboard feature fails on every count except the credit.
- Downstream platform terms still bind (e.g. YouTube data carries YouTube's rules).

So displaying/building on Soundcharts data requires a **commercial API agreement
with written display+derive rights** — the normal thing their "API for labels &
teams" customers sign, but it must be negotiated, not assumed.

**Blocking step when pursued:** email their sales (contact@soundcharts.com) with the
precise question — *"Does an API subscription grant the right to display
Soundcharts-sourced analytics to my own users inside my SaaS product, and to build
product features derived from that data?"* — and get the answer in writing before
any code.

**Refs:** Docs — https://developers.soundcharts.com/documentation/getting-started ·
Artist endpoints — https://developers.soundcharts.com/documentation/reference/artist/summary ·
Terms — https://soundcharts.com/en/terms · Pricing — https://developers.soundcharts.com/pricing

## Test coverage — wider mutation sweep (OPEN, added 2026-08-04)

On 2026-08-04 we ran 30 mutations across the EPK slice and the editor work in `c06d5f9`.
They found **one bad test and four unguarded behaviours** — all closed the same day. The
method should now be pointed at the rest of the codebase, worst-covered first.

**The method.** Break the implementation on purpose, one targeted edit at a time, and
confirm a test goes red. Scripts used: `mutate.py` / `mutate3.py` (source edits) and
`mutate_constraint.py` (a DB constraint, drop → run → normalise data → re-add, with the
restore in a `finally`). A test that has never been red is unproven; green is not
evidence.

**What the sweep already caught, as examples of what to look for:**
- A test that passed for the wrong reason — a "javascript: URL is not linked" assertion
  on the public EPK page was satisfied by the PARSE guard, so the RENDER guard could be
  deleted freely. When two layers guard one thing, a test through the outer interface
  proves the outcome, never which layer did the work.
- `BASE_CLASSES` capture-once in `bridge-client.ts` — re-capturing on every apply passed
  the whole suite, but would permanently destroy a site's original classes the moment a
  manager cleared a style box.
- `useSessionJournal` had NO direct test: both invariants could be deleted silently.

### How to read the gap list below
Measured statically (scratchpad `coverage_map.py`): a symbol counts as covered if its NAME
appears anywhere under `tests/`. That **overstates** coverage — a name can be mentioned
without being exercised, and common names collide across modules. So everything listed
here is a HARD gap, but absence from the list is only a hint, not a guarantee.

Totals: 181 modules with value exports — 74 with every export named, 26 partial, **81 with
no export ever named in any test**.

### Tier 1 — untested AND consequential (do these first)
- `src/lib/supabase/middleware.ts` — `updateSession`. Session refresh + route protection.
  Nothing under `tests/` mentions middleware at all; the auth boundary is unguarded.
- `src/app/auth-actions.ts` — `login`, `logout`.
- `src/app/admin/applications/actions.ts` — `setApplicationStatus`, an admin-only write.
- `src/app/artists/[id]/(dashboard)/use-live-on-site.ts` — `useLiveOnSite`, the hook behind
  the LIVE on-site toggle (ADR 0009). A bug here puts content on the public site with no
  publish, or silently drops a toggle.
- `src/app/artists/[id]/(dashboard)/_data.ts` — `requireArtist` (the ownership gate that
  404s a non-owner) and `dashboardDiff` (service-role, cached, runs outside the request).
- `src/lib/releases.ts`, `src/lib/format.ts`, `src/lib/storage-url.ts`, `src/lib/slug.ts`,
  `src/lib/resumable-upload.ts` — pure logic, cheap to cover, no excuse.
- `src/app/artists/[id]/(dashboard)/integrations.ts`, `src/app/roster-data.ts`.

### Tier 2 — the dashboard server actions
**All 38 exports of `src/app/artists/[id]/(dashboard)/actions.ts` are never named in any
test**: publishAction, publishSectionAction, publishSiteAction, saveSiteContentAction,
saveSeoAction, addVideoAction, resolveVideoUrlAction, scrapeMerchUrlAction,
saveYoutubeChannelAction, syncYouTubeAction, refreshYouTubeAction, publishSelectionAction,
publishEntityAction, setTrackOnSiteAction, setTrackParentReleaseAction, saveTemplateAction,
updateArtistAction, saveSpotifyIdAction, syncSpotifyAction, refreshSpotifyAction,
refreshMusicAction, saveDeezerIdAction, saveSoundcloudUrlAction, syncDeezerAction,
saveAppleIdAction, syncAppleAction, saveBandsintownNameAction, syncBandsintownAction,
saveTicketmasterIdAction, syncTicketmasterAction, connectShopifyAction,
disconnectShopifyAction, syncShopifyAction, saveDriveFolderAction, checkDriveFolderAction,
listDriveFilesAction, importDriveFileAction, and markEnquiryReadAction (that last one
from the in-flight enquiries thread — it is in the working tree, not yet committed, so
don't be surprised when it isn't there).

By design these are thin wrappers over lib functions that ARE tested, so the risk is
concentrated in the wrapper itself: the auth check, the `revalidatePath` target, and the
error mapping. Test those three things, not the logic underneath.

### Tier 3 — exports named nowhere, in modules that ARE otherwise covered
`style-apply.ts`: MANAGED_STYLE_PROPS, colorToken, colorClass, speedToken, speedClass ·
`markers.ts`: FIELD_ATTR, SLOT_ATTR, ITEM_ATTR, STYLE_ATTR, LINK_ATTR, HIGHLIGHT_ATTR,
linkRegion · `analytics.ts`: entityCounts, ON_SITE_METRIC, daysAgo · `events.ts`:
EVENT_TYPES, EVENT_TYPE_SET, ENTITY_KINDS · `site-content-schema.ts`: fieldsFor, SEO_FIELDS,
acceptsValue · `upload.ts`: IMAGE_UPLOAD_RULES, VIDEO_UPLOAD_RULES, sizeLabel · `url.ts`:
isUrlField, isContactLink · `content.ts`: publicSnapshot · `color.ts`: canonicalHex ·
`storage-gc.ts`: GC_MIN_AGE_MS, MEDIA_FOLDERS · `gallery.ts`: SLOTS_PER_ORIENTATION ·
`sync.ts`: normalizeTitle · `bridge.ts`: selectTargetKey · `bridge-client.ts`: rectOf ·
`song-links.ts`: STREAMING_SERVICES · `drive-import.ts`: DRIVE_IMPORT · `audio.ts`:
AUDIO_BUCKET, AUDIO_URL_TTL_SECONDS · `epk.ts`: QUOTE_MAX, SOURCE_MAX.

Several are constants used indirectly by covered code — check before writing a test for
its own sake. `colorToken`/`speedToken`/`canonicalHex`/`acceptsValue`/`normalizeTitle` are
real logic and worth direct tests.

### Tier 4 — presentational components (~50 files)
Card/grid/modal/browser components with one export each. Lowest value; the UI harness
([[ui-test-harness]]) exists if a specific one starts carrying logic.

## Storage CDN caches past authorisation (learned 2026-08-04)

Tightening a storage policy does **not** purge what the CDN already served. Supabase
Storage caches by object PATH and invalidates on object WRITES — a policy change is
invisible to it.

Found while mutation-checking `tests/documents.isolation.test.ts`: a temporary wide-open
SELECT policy let an anonymous fetch succeed once, and that object stayed anon-readable
at the same path after the policy was removed. The test only recovered when it started
using a fresh object path per run.

**Operational consequence, worth remembering before it matters:** if a private document
is ever exposed by a policy mistake, fixing the policy is NOT sufficient. The object has
to be re-written to a NEW path (or deleted and re-uploaded) to make the leaked URL stop
working. Rotating the path is the remediation, not fixing the rule.

Applies to `documents` (private) most sharply, but the same mechanic governs `audio`.
