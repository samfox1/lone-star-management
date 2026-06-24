# TODO

## Media — done; next steps
- [x] Hero videos now stream from Supabase Storage (`media` bucket,
      `{artist_id}/hero-videos/`), registered in the `media` table by purpose.
      The `HERO_CLIPS` local-file bridge is gone.
- [ ] **Dashboard upload UI** — managers can't upload media from the dashboard
      yet (done via `scripts/upload-skeen-media.ts`). Add an uploader per use
      (hero videos, profile photo) that writes to `{artist_id}/{use}/` and a
      `media` row. Storage RLS already restricts writes to the artist's folder.
- [ ] Wire `profile_photo` media into the dashboard + use it for the About photo
      (currently falls back to `hero_image_url`).

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
