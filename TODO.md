# TODO

## Media — done
- [x] Hero videos stream from Supabase Storage (`media` bucket,
      `{artist_id}/hero-videos/`), registered in the `media` table by purpose.
- [x] Dashboard upload UI (MediaPanel): managers upload/delete hero videos and a
      profile photo, direct-to-Storage (RLS scopes writes to their folder).
- [x] profile_photo wired into the public About (falls back to hero_image_url).
- [ ] (Later) gallery_image purpose is in the schema but unused; add a gallery
      section + uploader when a template needs it.

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
- [ ] **Extract a shared `useStorageUpload` hook** — `track-audio-uploader.tsx` and
      `media-uploader.tsx` are ~75% the same (busy/error state, orphan-cleanup,
      refresh). Two callers is borderline; consolidate at the third uploader.

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
    events in `tour_dates` and publish snapshots into `revisions`. Confirm this
    intended "sync events to your website" use is acceptable.
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
