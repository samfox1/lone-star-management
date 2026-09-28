# Spotify

Connecting Spotify links the artist's Spotify profile on the site and pulls their
discography (albums, EPs, singles, and songs) into the dashboard.

## Connection type

Link + sync. Spotify has no handle, only an artist link, and the artist id needed to
pull the catalog sits inside that same link — so one paste does both jobs
(`src/lib/connections.ts`).

## What the manager enters

The manager pastes their Spotify artist link (`https://open.spotify.com/artist/...`).
There is no separate id field in the Connect flow; the id is read out of the link.

Accepted shapes: a plain artist link, or one with a locale segment
(`open.spotify.com/intl-de/artist/...`) or a `?si=` share suffix — both still resolve
(`idFromProfileUrl` in `src/lib/connections.ts`). A stray leading/trailing space from a
clipboard paste is trimmed. A **playlist** link (or any non-artist Spotify link)
returns no id — the profile still saves, but nothing is pulled.

Errors, quoted from `src/lib/connections.ts`:
- Empty field: "Paste the Spotify link."
- Just the bare site address (`https://open.spotify.com/artist/`, nothing after):
  "Add the rest of the link — that's just the site's address."
- A link to a different known platform: "That's a TikTok link, not Spotify." (the
  wrong platform's name fills in)

A "Sync music" checkbox is on by default next to the field; unchecking it links the
profile without pulling anything (`wantsSync`, `ConnectInput.sync`).

Once connected, the row's modal also exposes a raw **ID** field
(`saveSourceIdAction`) for editing the stored Spotify artist id directly, separate
from the link.

## How it is stored

- A `links` row: `label: 'Spotify'`, `url` = the artist link, `on_site: false` (a
  connection lands off the site; turning it into a site button is a separate step in
  the site editor's Socials panel, not something Connections does).
- `artists.spotify_artist_id` — the artist id extracted from the link (or typed into
  the ID field). This is the column the rest of the sync machinery reads.

## Sync / integration

**API**: Spotify Web API, Client Credentials flow (an app-level token, no artist
login). Token endpoint `https://accounts.spotify.com/api/token`; catalog reads from
`https://api.spotify.com/v1` (`src/lib/spotify.ts`, `createSpotifyClient`).

**Auth / env vars**: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (see
`.env.example`). Without both set, the client throws "Spotify credentials not
configured (SPOTIFY_CLIENT_ID/SECRET)."

**What is pulled**: the artist's albums and singles (`include_groups=album,single`),
then every track on each one. This produces both a track list and a release
(album/EP/single) list from one walk.

**Where it lands**: `syncSpotifyTracks` writes/merges into the `tracks` table
(`spotify_id`, `title`, `cover_url`, `stream_url`, `album_name`, `duration_ms`,
`source: 'spotify'`, new rows `on_site: false`); `syncSpotifyReleases` writes into
`releases` (`spotify_id`, `title`, `release_type`, `cover_url`, `release_date`, a
seed Spotify link, new rows `on_site: false`), then links each release's tracks by
Spotify track id (`src/lib/sync.ts`). Spotify is the only one of the three catalog
services that produces **releases**, not just tracks.

A song already pulled from another platform (Apple Music, Deezer) is matched by
normalized title + duration and gets Spotify's id stamped onto the same row instead
of duplicating it (`src/lib/sync-match.ts`, `matchTrackCandidate`). `featured_artists`
is seeded from Spotify only when the row has none yet — a manager's edit is never
overwritten.

**Proof of sync**: `TRACK_ID_COLUMN.spotify = 'spotify_id'`
(`src/lib/integrations-registry.ts`) — a connection reads as "synced" when at least
one track row carries a non-null `spotify_id`, "failed" (couldn't connect) when the
artist id is set but no track carries it.

**Known quirks (from code + memory)**: the app is in Spotify Development mode. The
albums call sends no `limit` param — dev-mode apps get a 400 "Invalid limit" if it's
present — and instead follows `next` cursors page by page. `/artists/{id}/top-tracks`
returns 403 in dev mode but is never called (see memory `spotify-dev-mode-no-limit`).
429 responses back off using `Retry-After` and retry up to 3 times
(`src/lib/http.ts`).

**How a pull is triggered**: automatically on Connect (if Sync is on); the list row's
"Sync" action for a profile that's linked but never pulled (`syncProfileAction`,
reads the id straight out of the stored link); "Pull now" in the row's modal or Retry
on a failed row (`pullConnectionAction`); "Pull from Spotify" from the Music tab's
Sync dialog (`syncSectionAction`).

## On the site

The bridge's `SOCIAL_PLATFORMS` lists Spotify at slug `spotify`
(`packages/site-bridge/src/social.ts`) with a brand icon and colour (`#1ED760`) in
`social-icons.ts`. A site renders the profile link as a social button when the
manager turns it on in the site editor's Socials panel; a site that doesn't know the
slug still renders it as a plain labelled link.

## Code map

- `src/lib/manager-tools/connections/services/spotify/index.ts` — this service's own code:
  `social` (link method, the artist-id regex as `idFromUrl`) and `source` (the registry
  entry).
- `src/lib/spotify.ts` — `createSpotifyClient`: token fetch/reuse, pagination,
  album + track fetch, release-type classification, date normalization.
- `src/lib/sync.ts` — `syncSpotifyTracks`, `syncSpotifyReleases`: writes/merges into
  `tracks` and `releases`.
- `src/lib/sync-match.ts` — cross-platform title/duration matching shared by all
  three catalog services.
- `src/lib/connections.ts` — `idFromProfileUrl` (dispatches to `idFromUrl` above), row
  building.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above.
- `src/lib/integrations-registry.ts` — assembles the entry above into
  `INTEGRATION_REGISTRY` (in `INTEGRATION_KEYS` order) and
  `TRACK_ID_COLUMN.spotify`.
- `src/app/artists/[id]/(dashboard)/actions.ts` — `saveSpotifyIdAction`,
  `syncSpotifyAction` (pulls tracks + releases, then snapshots a release revision).
- `src/app/artists/[id]/(dashboard)/integrations.ts` — wires the save/pull actions
  to the registry entry.
- `src/app/artists/[id]/(dashboard)/sync-section-action.ts`,
  `sync-sections.ts` — the Music tab's Sync dialog.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction`, `syncProfileAction`, `pullConnectionAction`, disconnect.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `spotify` slug and
  icon.

## Tests

- `tests/unit/sync/spotify.test.ts` — the client: token reuse, 429 backoff,
  pagination, discography dedupe.
- `tests/integration/sync/sync.test.ts` — track sync against the real database:
  insert new, refresh Spotify-owned rows, never clobber a manual edit, tenancy.
- `tests/integration/sync/sync.releases.test.ts` — release sync: new releases land
  off-site, manager-owned fields (on_site/slug/links) survive re-import, tracks link
  by Spotify id.
- `tests/unit/sync/sync-merge.test.ts` — the cross-platform merge decisions
  (Spotify/Apple/Deezer) against an in-memory stand-in.
- `tests/unit/manager-tools/connections/connections.test.ts` — `idFromProfileUrl`
  Spotify cases, `wantsSync`, `connectInputError` messages, Spotify-is-one-row.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — Spotify is a
  `link`-kind method.
- `tests/unit/manager-tools/connections/integrations-registry.test.ts` —
  `provenBy` reads `spotify_id`.
- `tests/unit/manager-tools/connections/connections-actions.test.ts` —
  `connectOneAction` reporting a pull's result.
- `tests/components/manager-tools/connections/connect-modal.test.tsx`,
  `connection-list.test.tsx` — the Connect flow and list row UI.

## Known gaps

- No refresh-token or extended-quota request has been made — the app stays in
  Spotify Development mode, so the album-listing limit and top-tracks 403 apply
  (memory: `spotify-dev-mode-no-limit`).
- Apple Music and Deezer never create `releases` rows — only Spotify does. A song
  pulled first from Apple or Deezer stays a loose track until (if ever) a later
  Spotify pull matches it into an album.
- Nothing in the code enforces Spotify's API terms of use beyond what's described
  here; no attribution or rate-limit monitoring beyond the 429 backoff exists.
