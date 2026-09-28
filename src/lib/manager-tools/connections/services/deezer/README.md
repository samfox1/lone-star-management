# Deezer

Connecting Deezer links the artist's Deezer profile on the site and pulls their songs
(metadata + a link-out, no audio) into the dashboard, grouped into the albums, EPs and
singles they came from.

## Connection type

Link + sync. Deezer has no handle, only an artist link, and the artist id the
catalog pull needs sits inside that link — one paste links the profile and (if Sync
is on) pulls the songs (`src/lib/connections.ts`).

## What the manager enters

The manager pastes their Deezer artist link (`https://deezer.com/artist/...`).
There is no separate id field in the Connect flow.

Accepted shapes: with or without a `www.` prefix, and with or without a two-letter
locale segment (`deezer.com/en/artist/5723457`) — `idFromProfileUrl` in
`src/lib/connections.ts` pulls the trailing numeric id either way.

Errors, quoted from `src/lib/connections.ts`:
- Empty field: "Paste the Deezer link."
- Just the bare site address: "Add the rest of the link — that's just the site's
  address."
- A link to a different known platform: "That's a TikTok link, not Deezer." (the
  wrong platform's name fills in)

A "Sync music" checkbox is on by default; unchecking it links the profile without
pulling anything.

Once connected, the row's modal also exposes a raw **ID** field
(`saveSourceIdAction`) for editing the stored Deezer artist id directly.

## How it is stored

- A `links` row: `label: 'Deezer'`, `url` = the artist link, `on_site: false` (off
  the site until the manager makes it a button in the site editor's Socials panel —
  Connections never flips that on).
- `artists.deezer_artist_id` — the numeric artist id extracted from the link (or
  typed into the ID field).

## Sync / integration

**API**: Deezer's public catalog API, `https://api.deezer.com`
(`src/lib/deezer.ts`, `createDeezerClient`). It is read-only public data — no
authentication of any kind.

**Auth / env vars**: none. `.env.example` lists no Deezer variable, matching the
code comment "Deezer's public catalog API needs none."

**What is pulled** (since 2026-09-28): the artist's discography, walked the way
Spotify's pull walks it — `GET /artist/{id}/albums?limit=100`, then
`GET /album/{albumId}/tracks?limit=100` for each release, every list following `next`
cursors up to a hard cap of 50 pages (`maxPages`, so a self-referential or looping
cursor can't spin forever). Compilations (`record_type: 'compile'`) are skipped before
their tracks are requested, mirroring Spotify's `album,single` groups. One row per
release: a single that is also an album track comes through twice (Deezer gives each
copy its own id); only a literal repeat of one track id is dropped.

It used to read `GET /artist/{id}/top`. Measured against the live API on 2026-09-28,
`top` returned ONE track for an artist with six releases and ZERO for artists with
eight and nineteen — it ranks popularity, and small artists barely register — so it
could not feed releases.

**Where it lands**: `syncDeezerTracks` (`src/lib/sync.ts`) writes/merges the songs
into `tracks`, then groups them into `releases`. Song fields: `deezer_id`, `title`,
`cover_url` (the album's `cover_big`, 500x500, else `cover_medium`), `album_name`,
`duration_ms`, and the deezer.com link-out in `provider_url`. New rows land
`on_site: false`. Deezer has no `stream_url` — its ToS bars exposing audio, per the
file header comment, so it is a metadata + link-out source only (same as Apple Music).

A song already pulled from another platform is matched by normalized title +
duration and gets Deezer's id stamped onto that same row instead of duplicating it
(`src/lib/sync-match.ts`, `matchTrackCandidate`); on a merge Deezer's link is
deliberately left out of the fill (`mergeFill: {}` in `syncDeezerTracks`) because it
rebuilds from `deezer_id` rather than needing to be stored twice. When a single and
its album both carry the song (two rows, same title and length), the copy on the same
album wins the tie, so each copy lands on its own row.

**Releases** (`syncReleases` in `src/lib/sync.ts`, the one release sync all three
catalog platforms share):
- *Type*: Deezer's `record_type` names albums, EPs and singles explicitly and is
  taken as given (a 4-track `single` stays a single). Only a missing/unknown
  `record_type` falls back to Spotify's rule: 4+ tracks is an EP, else a single
  (`classifyRelease` in `src/lib/sync-match.ts`). `compile` is not the artist's
  release and is never walked.
- *Fields*: title, cover (`cover_big`), date (`release_date`; Deezer's `0000-00-00`
  becomes null), and one seed link `{ label: 'Deezer', url }` to the album page. New
  releases land `on_site: false`, `source: 'deezer'`, with a unique slug.
- *Finding an existing release* (so Spotify, Apple and Deezer never make two):
  `releases` has no Deezer id column, so a Deezer release is known by its songs. In
  order: the release Deezer's songs already sit in (most of them); else an imported
  release with the same normalized title, when exactly one is open (reported as
  "merged by title" in the Sync dialog); else a new release. A hand-made release is
  only ever joined through its songs.
- *What a pull may write*: on a release Deezer created, title, cover/date (never null
  over a value) and the type unless the manager locked it. On a release another
  platform or the manager made: only an empty cover or date. Never `on_site`, slug,
  `links`, `released`, `sort_order`. Songs are filed only where unassigned (a manual
  move wins) and take the release's type only while still at the default `single`.

**Proof of sync**: `TRACK_ID_COLUMN.deezer = 'deezer_id'`
(`src/lib/integrations-registry.ts`) — the connection reads "synced" when at least
one track row carries a non-null `deezer_id`, "failed" when the artist id is set but
nothing does.

**Limits and quirks (from code)**: Deezer signals quota exhaustion in the response
**body** with HTTP 200 (`{ error: { code: 4 } }`), not with an HTTP error status —
`onBody` in the shared `httpGetJson` helper detects code 4 and retries with a 1s
backoff; any other body-level error throws. Standard HTTP 429s back off using
`Retry-After` and retry up to 3 times, same as Spotify and Apple Music
(`src/lib/http.ts`). The walk costs one request per release plus the albums list (an
artist with 19 releases: 20 requests), so a quota hit is likelier mid-walk than
before; it is retried the same way, and a pull that still runs out fails whole
(nothing written) and can simply be retried.

**How a pull is triggered**: automatically on Connect (if Sync is on); the list
row's "Sync" action for a linked-but-never-pulled profile (`syncProfileAction`);
"Pull now" in the row's modal or Retry on a failed row (`pullConnectionAction`);
"Pull from Deezer" from the Music tab's Sync dialog (`syncSectionAction`).

## On the site

The bridge's `SOCIAL_PLATFORMS` lists it at slug `deezer`
(`packages/site-bridge/src/social.ts`) with a brand icon and colour (`#A238FF`) in
`social-icons.ts`. A site renders the profile link as a social button once the
manager turns it on in the site editor's Socials panel; an unrecognized site just
shows it as a plain labelled link.

## Code map

- `src/lib/manager-tools/connections/services/deezer/index.ts` — this service's own code:
  `social` (link method, the artist-id regex as `idFromUrl`) and `source` (the registry
  entry).
- `src/lib/deezer.ts` — `createDeezerClient`: the discography walk, pagination,
  `record_type` → type, the in-body quota-error handling.
- `src/lib/sync.ts` — `syncDeezerTracks`: writes/merges into `tracks`, then
  `syncReleases` groups them into `releases`.
- `src/lib/sync-match.ts` — cross-platform title/duration matching, the release-type
  law (`classifyRelease`) and `groupReleases`, shared by all three catalog services.
- `src/lib/connections.ts` — `idFromProfileUrl` (dispatches to `idFromUrl` above), row
  building.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above.
- `src/lib/integrations-registry.ts` — assembles the entry above into
  `INTEGRATION_REGISTRY` (in `INTEGRATION_KEYS` order) and
  `TRACK_ID_COLUMN.deezer`.
- `src/app/artists/[id]/(dashboard)/actions.ts` — `saveDeezerIdAction`,
  `syncDeezerAction`.
- `src/app/artists/[id]/(dashboard)/integrations.ts` — wires the save/pull actions
  to the registry entry.
- `src/app/artists/[id]/(dashboard)/sync-section-action.ts`,
  `sync-sections.ts` — the Music tab's Sync dialog.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction`, `syncProfileAction`, `pullConnectionAction`, disconnect.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `deezer` slug and
  icon.

## Tests

- `tests/unit/sync/deezer.test.ts` — the client: the albums → tracks walk, the
  release each song carries, `record_type` rules, compilations skipped, one row per
  release, `next` pagination, HTTP-429 backoff, Deezer's in-body quota error (code 4)
  backoff mid-walk.
- `tests/unit/sync/catalog-releases.test.ts` — `classifyRelease` and `groupReleases`.
- `tests/integration/sync/sync.catalog-releases.test.ts` — Deezer-only pull creates the
  releases; Spotify→Deezer and Deezer→Apple meet on one release (fetch stubbed, real
  DB).
- `tests/integration/sync/sync.deezer.test.ts` — track sync against the real
  database: insert new, refresh Deezer-owned rows, never clobber a manual edit or
  another provider's row, tenancy (throwaway artists, per `AGENTS.md` rule 6).
- `tests/unit/sync/sync-merge.test.ts` — the cross-platform merge decisions
  (Spotify/Apple/Deezer) against an in-memory stand-in.
- `tests/unit/manager-tools/connections/connections.test.ts` — `idFromProfileUrl`
  Deezer cases, `buildConnectionRows` ("one with neither a profile nor a source is
  not a row" is asserted using Deezer as the example).
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — Deezer is a
  `link`-kind method.
- `tests/unit/manager-tools/connections/integrations-registry.test.ts` —
  `provenBy` reads `deezer_id`.
- `tests/components/manager-tools/connections/connect-modal.test.tsx` — the
  Connect flow UI.

## Known gaps

- No audio: Deezer's terms bar exposing streams, so Deezer-only songs have no
  in-app playback, only a link-out.
- `/artist/{id}/albums` lists releases where the artist is the main artist, so an
  appearance on someone else's record is not pulled at all (it was, occasionally,
  when the pull read `/top`).
- A release Deezer created has its title/cover/date refreshed by every Deezer pull,
  so a manager's rename of it reverts (Spotify's releases behave the same). Only the
  type has a lock (`release_type_locked`); a title lock would need a migration.
- No Deezer release id column: joining an existing release relies on the songs having
  merged (or the title). A pull never adds its own link to a release another platform
  made — with no id column it cannot tell "never added" from "the manager removed it".
- The release smart-link snapshot: the Spotify pull publishes a release revision after
  syncing (`publishContent` in `pullSpotify`); `syncDeezerAction` does not yet.
