# Music restructure — plan

Merge the separate `tracks/` and `releases/` dashboard routes into ONE **Music** tab
split into **Released** and **Unreleased**. Decided in the 2026-07-08 review; this doc
is the buildable spec. Sequenced as step 4 of the roadmap (after the UI-test layer).

## Decisions (locked 2026-07-08)

1. **Released vs Unreleased is DERIVED from provenance** — no manual toggle, no new
   status column.
2. **Unreleased can be grouped** — an unreleased "release" (e.g. a demo EP) uses the
   same release + tracklist structure the Released side does.
3. **Unreleased is dashboard-only for now** — it does NOT appear on the public artist
   site. Only Released music is public.

## Derivation rule (the one source of truth)

A new helper `src/lib/music.ts` (mirrored in the SQL doors) classifies each item:

- **Release** → **Unreleased** iff it has NO platform presence:
  `source = 'manual' AND spotify_id IS NULL AND links = '[]'::jsonb`.
  Otherwise **Released** (Spotify/Apple imports carry `spotify_id`/`source`; a manual
  release with DSP `links` is "on platforms").
- **Track with a `release_id`** → inherits its release's bucket.
- **Loose track (no `release_id`)** → **Unreleased** iff it's an upload with no platform
  linkage: `audio_path IS NOT NULL AND source = 'manual' AND spotify_id IS NULL AND
  apple_id IS NULL AND deezer_id IS NULL AND provider_url IS NULL AND stream_url IS NULL
  AND apple_url IS NULL`. Otherwise **Released**. (A bare manual track with neither audio
  nor a platform link is treated as Unreleased — it isn't public anyway.)

> **`apple_url` dependency:** that last clause comes from the parallel catalog-merge
> effort (`CATALOG_MULTIPLATFORM_HANDOFF.md`), which moves Apple links to a new `apple_url`
> column. `lib/music.ts` picks it up on resume, AFTER that migration lands. The catalog
> merge also makes tracks **union rows** (one row can carry every platform's ids) and
> **retires `catalog_source` / `switch_catalog_source`** — so the Music view must not lean
> on one-source-per-artist.

This is pure derivation; no migration needed for the classification itself. (The
`tracks.visible` / `links.visible` columns added `20260708150000` stay as-is; they're
still unwired and out of scope here.)

## ⚠ Behavior change to confirm

Today `get_public_site` publishes EVERY published track, including uploaded/manual
tracks that have gated audio (the Phase-3 player). Under decision #3 those become
**Unreleased → dashboard-only**, so **they come off the public site.** Net effect:

- The public artist site (and skeen-website) will show only Released music going forward.
- Uploaded-only demo tracks a manager had made public will stop appearing until we add
  a public Unreleased surface later.
- Gated audio itself is NOT removed — a *Released* track that has an uploaded master
  still plays via the gated player. Only *Unreleased* items (no platform presence) drop
  off the public site.

If any live artist (e.g. Skeen) currently shows uploaded-only tracks publicly, confirm
that's acceptable before we ship the door filter.

## Surface-by-surface changes

**1. DB doors (SQL, the canary — change carefully, one migration).**
- `get_public_site`: gate the `tracks` branch (and drop loose Unreleased tracks) to
  Released-only, mirroring `lib/music.ts`. Content still comes from the published
  snapshot; this only narrows exposure.
- `get_release` / `get_public_releases`: exclude Unreleased releases. Also **kill the
  `album_name` string-match fallback** — rely solely on `tracks.release_id`.
- Add a regression test proving an Unreleased release + a loose uploaded track are
  absent from all three doors, and a Released release still renders with its tracklist.

**2. Dashboard routes / UI.**
- Collapse `music/tracks-*` + `music/releases-*` into one Music view with **Released**
  and **Unreleased** sections (reuse `SectionToolbar`, `FilterBar`, `CardGrid`,
  `OriginSection`). `/tracks` and `/releases` redirect into `/music`.
- Released section: today's ReleasesBrowser (groups + tracklists + PublishBar).
- Unreleased section: uploaded groups + loose uploads; upload flow (`track-audio-uploader`)
  lives here; NO PublishBar (not public) — or a disabled/hidden publish affordance.
- `_data.ts` / `sections.ts`: derive each item's bucket via `lib/music.ts`.

**3. Public templates.** `artist-template` / `artist-site` / `cinematic*`: no player
changes needed now (Unreleased is dashboard-only), but verify nothing assumes the old
"all tracks" shape once the door narrows.

**4. Copilot (`lone-star-agent`).** `artist_snapshot` counts: split "music" into
released vs unreleased counts (or at least stop conflating). Update `instructions.md`
wording (Deezer/catalog note already drifts — fix while here).

**5. skeen-website.** Its `mapMusic` already infers album/EP/single by heuristic; once
the door returns only Released items with authoritative `release_type`, switch the mapper
to the real field and drop the heuristic. Confirm the site still renders with the
narrowed payload (fallback path already guards emptiness).

**6. Tests.** Extend the UI layer (TracksBrowser→the new Music view, the Unreleased
section), the door regression test above, and update any fixtures that assumed uploaded
tracks were public.

## Execution (multi-agent fan-out, after sign-off)

**Status:** RESUMED 2026-07-09 (catalog-merge data layer landed: union migration
`20260708160000` pushed, `apple.ts`→iTunes, `sync.ts` merge).
- step 1 DONE — `src/lib/music.ts` + tests (now incl. `apple_url`).
- apple_url public-site threading DONE (the catalog terminal's audit finding): content.ts
  snapshot + site.ts type/mapping + artist-site.tsx link chain. tsc clean, 434 tests green.
- catalog retirement LANDED (2026-07-09, post-crash recovery): `CatalogSourceForm` /
  `lib/catalog.ts` / `setCatalogSourceAction` deleted, mutual-exclusivity out of
  `integrations.ts`, and migration `20260708161000_drop_switch_catalog_source` **pushed
  to the live DB** (function verified gone). The catalog-merge effort is complete;
  no more file-ownership split — one terminal owns everything now.
- **ALL STAGES DONE (2026-07-09).** Shipped:
  - Snapshot provenance: `source` + platform ids on the track snapshot,
    `source`/`spotify_id` on the release snapshot (`PUBLISHABLE`).
  - Door migration `20260709120000_public_music_released_only` — pushed + verified:
    `music_release_is_released` / `music_track_on_platform` helpers (the SQL mirror of
    `lib/music.ts`), Released-only `get_public_site` tracks (release-bucket inheritance
    via lateral join), `get_release` excludes Unreleased + **album_name fallback
    killed**, `get_public_releases` excludes Unreleased. Missing provenance keys (old
    snapshots) classify Released, so nothing already public vanished — confirmed
    empirically: every artist's door payload byte-identical before/after the push.
  - `getWorkingSite` (manager preview) applies the same Released-only filter, so
    preview still mirrors live (preview-parity guardrail green).
  - Dashboard Music tab: Released (ReleasesBrowser + loose platform tracks +
    "Publish tracks") / Unreleased (UnreleasedBrowser: grouped + loose uploads, add +
    upload flow, NO publish affordance). Per-platform badges (`trackPlatforms` in
    `lib/music.ts`) replace the single source badge on TrackCard.
    `tracks-browser`/`tracks-section`/`releases-section` deleted (absorbed).
  - Copilot: snapshot splits released/unreleased track counts; `catalog_source`
    read removed; instructions drift fixed.
  - skeen-website: `mapMusic` groups by `release_id` with authoritative
    `release_type` (get_public_releases); cover heuristic kept as fallback.
  - Verified: 438 tests green (+26 in skeen-website), tsc clean (both projects),
    lint 0 errors, prod build, authenticated dogfood of the Music tab (buckets +
    badges + empty states, live DB).

~~Known v1 gaps~~ — **both closed later on 2026-07-09** (manual-music follow-up):
- "Add release" (CreateModal → the existing `addReleaseAction`) creates a manual
  release; it starts Unreleased by derivation and its card (type / DSP links /
  delete) renders in the Unreleased half — adding a DSP link promotes it.
- TrackCard gained a "Listen" link field (`stream_url`): setting one promotes an
  upload to Released, clearing demotes.
