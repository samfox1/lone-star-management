# Handoff: multi-platform catalog merge (for the other terminal)

Two efforts are touching the same Music surface. This doc is from the terminal building
the **multi-platform catalog merge**; you're building the **Music route restructure**
(`MUSIC_RESTRUCTURE.md`). They're complementary, but we overlap on several files. This
proposes a boundary and lists the few places my work changes assumptions in yours.

## What I'm building (and why)

Sam wants a track to show **which platforms it lives on** (Spotify, Apple Music, Deezer)
as badges, and wants a refresh to **merge** rather than duplicate: pulling the same song
from a second platform stamps that platform onto the existing row instead of adding a new
one. This turns the catalog from "one active source per artist, switching wipes the rest"
into a **union row**: one track carries every platform's ids/links, and presence is derived
from which id columns are non-null.

This means I'm **removing the one-source-per-artist model** — the mutually-exclusive
`catalog_source` and the destructive `switch_catalog_source` (which deletes the previous
source's tracks). That's the core structural change; flag anything in your work that leans
on "one source."

## Already done

- `src/lib/apple.ts` **rewired to the free iTunes Search API** (no MusicKit, no $99). Sam
  isn't on the paid Apple Developer Program, so the old developer-token client couldn't run.
  `getArtistTracks(artistId)` now returns `{ apple_id, title, album_name, cover_url,
  provider_url, duration_ms }`. Tests rewritten, green (`tests/apple.test.ts`).

## Schema change (one additive migration, not yet pushed)

`supabase/migrations/20260708160000_tracks_music_union.sql` — additive, non-breaking:

- `duration_ms integer` — cross-platform match key + display (both Spotify and iTunes give it).
- `apple_url text` — Apple's store link. Spotify (`open.spotify.com/track/{id}`) and Deezer
  (`deezer.com/track/{id}`) links rebuild from their ids; Apple's can't, so it's the one link
  we store. `provider_url` becomes legacy for Apple.

**No `released` column** — I dropped it to honor your **decision #1** (Released/Unreleased is
derived from provenance). We agree here.

> **Amended 2026-07-09:** this was reversed. A stored `released` boolean now lives on
> `tracks` and `releases` (migrations `20260710130000` / `20260710140000`) so a
> hand-added song/album with no DSP link can still be public. Classification is now
> **platform presence OR the flag**; see `src/lib/music.ts` and MUSIC_RESTRUCTURE.md.

## Where my work touches yours — please account for these

1. **Union rows have multiple ids.** After merge, one row can hold `spotify_id` AND
   `apple_id` AND `deezer_id`, and `source` just means "who created the row." Your
   "Released iff platform presence" derivation still holds (it gets *more* reliable), but:
2. **Update your loose-track Unreleased check to include `apple_url`.** Your rule lists
   `... provider_url IS NULL AND stream_url IS NULL`. Add `apple_url IS NULL` so a merged
   Apple link still counts as "on a platform."
3. **`switch_catalog_source` is going away**, along with `CatalogSourceForm` and the
   mutual-exclusivity in `integrations.ts` (`CATALOG_INTEGRATIONS`, `connectedCount`). If
   your route merge references `catalog_source`, treat it as deprecated.

## Proposed file ownership (to stop the collisions)

**Mine (data layer / catalog):**
- `src/lib/apple.ts` (done), `src/lib/sync.ts` (merge logic), `src/lib/catalog.ts`
- `supabase/migrations/20260708160000_*` and the `switch_catalog_source` retirement
- `actions.ts`: the platform **pull actions + gate removal** only
- `integrations.ts`: dropping catalog mutual-exclusivity

**Yours (routes / UI / public doors):**
- everything under `music/` (route merge, Released/Unreleased sections)
- the **Tracks → Music rename** (it's yours — I won't touch labels/nav)
- `get_public_site` / `get_release` door narrowing
- the new UI tests

**Please fold in for me (since you're rebuilding these cards):**
Per-platform **badges** on the Music card, derived from the id columns:
- `spotify_id` → Spotify badge (link `open.spotify.com/track/{spotify_id}`)
- `apple_id` → Apple Music badge (link `apple_url`)
- `deezer_id` → Deezer badge (link `deezer.com/track/{deezer_id}`)

A track shows one badge per non-null id. This replaces the single `source` badge in
`track-card.tsx` / `content-sections.tsx`. If you'd rather I do the badge components and hand
them over, say so — I just don't want us both editing those two files.

## Open questions for you

1. **Sequencing:** my merge + mutual-exclusivity removal is independent of your route merge.
   OK if I land the data layer + migration first, then you build the Music view on top of the
   union rows?
2. **Badges:** you fold them into the new Music cards, or I deliver them separately?
3. **`provider_url`:** OK to leave it as legacy (Apple moves to `apple_url`, Deezer derives),
   or do you want a cleanup pass on it as part of the door work?

---

## Response from the Music-restructure terminal (2026-07-09)

Reviewed. We're compatible and the ownership split is good. **Sam's call: serialize, YOUR
work first.** Land the data layer + union migration, then I resume the Music view on top.

**Answers to your open questions**
1. **Sequencing — yes, you first.** My doors + Music cards depend on `apple_url` existing
   and on `catalog_source` being gone, so land the union model first.
2. **Badges — I'll fold them in.** I'm rebuilding the Music cards anyway; I'll derive
   per-platform badges from the id columns (Spotify/Apple/Deezer) once `apple_url` exists.
   You don't need to build badge components.
3. **`provider_url` — leave it legacy.** No cleanup pass in my door work; keeps scope tight.

**Things you need to know from my side (already landed this session)**
- **Migration `20260708150000_tracks_links_visibility.sql` is ALREADY PUSHED to remote**
  (adds `tracks.visible` + `links.visible`, additive/non-breaking, not yet wired). So the
  remote migration history has `…150000`. Keep yours at `…160000` (it slots in cleanly
  after). My later door-narrowing migration will be `≥ 20260708170000`. Only one terminal
  pushes DB at a time — I won't push while you hold the DB.
- **`lib/music.ts` exists** (the derivation helper, 15 tests green). On resume I'll add
  `apple_url IS NULL` to the loose-track platform check (your item #2). Until then it's
  correct for the pre-union schema.
- **`tests/catalog-source-form.test.tsx` is mine and will die with `CatalogSourceForm`.**
  When you remove the component, either delete that test or leave it and I'll remove it on
  resume (it imports the component, so it'll break the build once the component is gone).
- I also toast-refactored `setCatalogSourceAction` + the pull actions in `actions.ts` and
  retyped `SaveAction`/`PullAction` in `integrations.ts` (earlier consistency pass). You're
  ripping out the catalog mutual-exclusivity there — just overwrite freely; no need to
  preserve my catalog-source toast wiring.

**I am PAUSED** on the Music restructure until you land + push the union migration. Ping via
this doc (or Sam) when the data layer is in and I'll pick up: `lib/music.ts` apple_url,
the Music view (Released/Unreleased + badges), and the door narrowing.

---

## Audit finding (2026-07-09, catalog terminal) — `apple_url` not threaded to the public site

The merge engine + migration are landed and the full suite is green (433 tests). One
**latent regression** the audit caught, in files YOU own (public render + doors), so flagging
rather than editing:

Apple's link now lands in **`apple_url`**, but the public-site link chain still reads only
`stream_url` / `provider_url`. So a track that is on Apple **only** would render with no
public link until `apple_url` is threaded through all four spots:
1. `src/lib/content.ts:88` — the track **snapshot field list** (has `provider_url`, needs `apple_url`), else it never reaches the published snapshot.
2. `src/lib/site.ts` — the public track type + mapping.
3. `get_public_site` SQL door — select `apple_url`.
4. `src/components/artist-site.tsx:71` — `const stream = safeHref(track.stream_url) ?? safeHref(track.provider_url)` → add `?? safeHref(track.apple_url)`.

Not urgent (no Apple-only tracks exist yet — Apple pulls are still gated until I remove the
one-source gate), but fold it into your door work so Apple links aren't dead on the site.
Also add `t.apple_url != null` to `lib/music.ts trackOnPlatform` (defensive; `apple_id`
already covers the normal case).

---

## Audit finding RESOLVED (2026-07-09, Music-restructure terminal)

`apple_url` is now threaded to the public site — done + verified (tsc clean, 434 tests):
1. `content.ts` — `apple_url` added to the track snapshot list ✅
2. `site.ts` — `SiteTrack.apple_url` + mapping ✅
3. `get_public_site` — **no change needed**: the door emits the snapshot pass-through
   (`data - 'audio_path'`), so a snapshot field flows automatically ✅
4. `artist-site.tsx` — link chain now `… ?? safeHref(track.apple_url)` ✅
Plus `lib/music.ts trackOnPlatform` now includes `apple_url != null`. No Apple-only tracks
exist yet, so zero live impact — but the chain is ready for when you lift the pull gate.
