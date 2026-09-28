# Apple Music

Connecting Apple Music links the artist's Apple Music profile on the site and pulls
their songs (metadata + a store link, no audio) into the dashboard, grouped into the
albums, EPs and singles they came from.

## Connection type

Link + sync. Apple Music has no handle, only an artist link, and the artist id the
catalog pull needs sits inside that link — one paste links the profile and (if Sync
is on) pulls the songs (`src/lib/connections.ts`).

## What the manager enters

The manager pastes their Apple Music artist link
(`https://music.apple.com/artist/...` or `https://music.apple.com/us/artist/name/...`).
There is no separate id field in the Connect flow.

Accepted shapes: a link with or without a two-letter storefront segment
(`music.apple.com/no/artist/skeen/1754431714`), and with or without the artist's
name slug before the numeric id (`idFromProfileUrl` in `src/lib/connections.ts`
pulls the trailing digits either way).

Errors, quoted from `src/lib/connections.ts`:
- Empty field: "Paste the Apple Music link."
- Just the bare site address: "Add the rest of the link — that's just the site's
  address."
- A link to a different known platform: "That's a TikTok link, not Apple Music."
  (the wrong platform's name fills in)

A "Sync music" checkbox is on by default; unchecking it links the profile without
pulling anything.

Once connected, the row's modal also exposes a raw **ID** field
(`saveSourceIdAction`) for editing the stored Apple Music artist id directly.

## How it is stored

- A `links` row: `label: 'Apple Music'`, `url` = the artist link, `on_site: false`
  (off the site until the manager makes it a button in the site editor's Socials
  panel — Connections never flips that on).
- `artists.apple_artist_id` — the numeric artist id extracted from the link (or
  typed into the ID field).

## Sync / integration

**API**: the free iTunes Search API's `lookup` endpoint,
`https://itunes.apple.com/lookup` (`src/lib/apple.ts`, `createAppleMusicClient`).
This is **not** Apple's authenticated MusicKit API — the code comment is explicit
that MusicKit needs a paid Apple Developer membership, and the free `lookup`
endpoint returns the same metadata (title, album, artwork, duration, store link) an
artist page needs, with hosted/downloadable audio out of scope either way.

**Auth / env vars**: none required. `APPLE_STOREFRONT` (optional, defaults to `us`)
sets the iTunes storefront country used in the lookup query (see `.env.example`).

**What is pulled**: one request per pull — `lookup?id={artistId}&entity=song&limit=200`
— returns the artist row first, then up to 200 of their songs; the client drops the
artist row and keeps the tracks (`getArtistTracks`). There is no cursor pagination;
200 is the iTunes API's own cap. Every song row already names its collection (id,
name, link, artwork, a per-song date), so releases cost no extra request.

**Where it lands**: `syncAppleTracks` (`src/lib/sync.ts`) writes/merges the songs into
`tracks`, then groups them into `releases` (since 2026-09-28; Sam: "Yes, group them").
Song fields: `apple_id`, `title`, `cover_url` (upsized from the 100x100 thumbnail to
600x600), `album_name` (Apple's " - Single" / " - EP" suffix removed), `duration_ms`,
and the store link in `apple_url` (its own column, kept separate from Spotify's
`stream_url` so a merged row keeps both platforms' links independently). New rows land
`on_site: false`.

A song already pulled from another platform is matched by normalized title +
duration and gets Apple's id + link stamped onto that same row instead of
duplicating it (`src/lib/sync-match.ts`, `matchTrackCandidate`). When a single and
its album both carry the song (two rows, same title and length), the copy on the same
album wins the tie, so each copy lands on its own row.

**Releases** (`syncReleases` in `src/lib/sync.ts`, the one release sync all three
catalog platforms share):
- *Which songs make a release*: songs are grouped by `collectionId` (`groupReleases`
  in `src/lib/sync-match.ts`). A collection that is not the artist's own is left out
  and its songs stay loose — a Various Artists compilation (it names another
  `collectionArtistId`) or an appearance on someone else's album (another collection
  credit, on a song by another artist id). A joint credit that includes the artist
  ("TSG: AP! & Skeen") counts as theirs, as it does on Spotify.
- *Type*: Apple names every non-album release "<title> - Single" or "<title> - EP";
  that suffix is the explicit type and is taken as given. No suffix = album. The
  track count never decides for Apple (it only does where a platform cannot tell a
  single from an EP — Spotify; `classifyRelease`).
- *Fields*: title (suffix removed), cover (600x600), date (the LATEST song's date —
  an album's pre-released singles keep their own earlier dates), and one seed link
  `{ label: 'Apple Music', url }` to the album page (the song's `?i=` pointer removed).
  New releases land `on_site: false`, `source: 'apple'`, with a unique slug.
- *Finding an existing release* (so Spotify, Deezer and Apple never make two):
  `releases` has no Apple id column, so an Apple release is known by its songs. In
  order: the release Apple's songs already sit in (most of them — the song merge has
  just said which songs are the same); else an imported release with the same
  normalized title, when exactly one is open (reported as "merged by title" in the
  Sync dialog); else a new release. A hand-made release is only ever joined through
  its songs, never on a name alone.
- *What a pull may write*: on a release Apple created, title, cover/date (never null
  over a value) and the type unless the manager locked it. On a release another
  platform or the manager made: only an empty cover or date. Never `on_site`, slug,
  `links`, `released`, `sort_order`. Songs are filed only where unassigned (a manual
  move wins) and take the release's type only while still at the default `single`.

**Proof of sync**: `TRACK_ID_COLUMN.apple = 'apple_id'`
(`src/lib/integrations-registry.ts`) — the connection reads "synced" when at least
one track row carries a non-null `apple_id`, "failed" when the artist id is set but
nothing does.

**Limits and quirks (from code)**: a `wrapperType === 'track' || kind === 'song'`
filter, plus a `trackId != null` check, keeps the artist row (which carries no
useful id-of-its-own for this filter) out of the results. 429s back off using
`Retry-After` and retry up to 3 times (`src/lib/http.ts`) — the same shared retry
helper Spotify and Deezer use, though iTunes rate limits aren't otherwise documented
in this codebase.

**How a pull is triggered**: automatically on Connect (if Sync is on); the list
row's "Sync" action for a linked-but-never-pulled profile (`syncProfileAction`);
"Pull now" in the row's modal or Retry on a failed row (`pullConnectionAction`);
"Pull from Apple Music" from the Music tab's Sync dialog (`syncSectionAction`).

## On the site

The bridge's `SOCIAL_PLATFORMS` lists it at slug `apple music`
(`packages/site-bridge/src/social.ts`) with a brand icon and colour (`#FA243C`) in
`social-icons.ts`. A site renders the profile link as a social button once the
manager turns it on in the site editor's Socials panel; an unrecognized site just
shows it as a plain labelled link.

## Code map

- `src/lib/manager-tools/connections/services/apple-music/index.ts` — this service's own
  code: `social` (link method, the artist-id regex as `idFromUrl`) and `source` (the
  registry entry).
- `src/lib/apple.ts` — `createAppleMusicClient`: the iTunes `lookup` call, artwork
  upsizing, track mapping, `appleCollection` (the suffix → type rule), the
  own-collection rule.
- `src/lib/sync.ts` — `syncAppleTracks`: writes/merges into `tracks`, then
  `syncReleases` groups them into `releases`.
- `src/lib/sync-match.ts` — cross-platform title/duration matching, the release-type
  law (`classifyRelease`) and `groupReleases`, shared by all three catalog services.
- `src/lib/connections.ts` — `idFromProfileUrl` (dispatches to `idFromUrl` above), row
  building.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above.
- `src/lib/integrations-registry.ts` — assembles the entry above into
  `INTEGRATION_REGISTRY` (in `INTEGRATION_KEYS` order) and
  `TRACK_ID_COLUMN.apple`.
- `src/app/artists/[id]/(dashboard)/actions.ts` — `saveAppleIdAction`,
  `syncAppleAction`.
- `src/app/artists/[id]/(dashboard)/integrations.ts` — wires the save/pull actions
  to the registry entry.
- `src/app/artists/[id]/(dashboard)/sync-section-action.ts`,
  `sync-sections.ts` — the Music tab's Sync dialog.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction`, `syncProfileAction`, `pullConnectionAction`, disconnect.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `apple music` slug
  and icon.

## Tests

- `tests/unit/sync/apple.test.ts` — the client: lookup mapping, the artist-row
  filter, artwork upsizing, 429 backoff, the release each song carries (suffix types,
  compilations/appearances left out, joint credits kept).
- `tests/unit/sync/catalog-releases.test.ts` — `classifyRelease` and `groupReleases`.
- `tests/integration/sync/sync.catalog-releases.test.ts` — Apple-only pull creates the
  releases; Spotify→Apple, Apple→Spotify, Deezer→Apple meet on one release; the title
  fallback; manual edits surviving a re-pull (fetch stubbed, real DB).
- `tests/integration/sync/sync.apple.test.ts` — track sync against the real
  database: insert new, refresh Apple-owned rows, never clobber a manual edit or
  another provider's row, tenancy (throwaway artists, per `AGENTS.md` rule 6).
- `tests/unit/sync/sync-merge.test.ts` — the cross-platform merge decisions
  (Spotify/Apple/Deezer) against an in-memory stand-in.
- `tests/unit/manager-tools/connections/connections.test.ts` — `idFromProfileUrl`
  Apple Music cases, `connectInputError` messages.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — Apple Music is a
  `link`-kind method.
- `tests/unit/manager-tools/connections/integrations-registry.test.ts` —
  `provenBy` reads `apple_id`.
- `tests/components/manager-tools/connections/connect-modal.test.tsx` — the
  Connect flow UI.

## Known gaps

- A release Apple created has its title/cover/date refreshed by every Apple pull, so a
  manager's rename of it reverts (Spotify's releases behave the same). Only the type
  has a lock (`release_type_locked`); a title lock would need a migration.
- No Apple release id column: joining an existing release relies on the songs having
  merged (or the title). A pull never adds its own link to a release another platform
  made — with no id column it cannot tell "never added" from "the manager removed it".
- The release smart-link snapshot: the Spotify pull publishes a release revision after
  syncing (`publishContent` in `pullSpotify`); `syncAppleAction` does not yet.
- No audio: Apple's free lookup endpoint returns a store link, not a stream, so
  Apple-only songs have no in-app playback.
- Country/storefront is a single global `APPLE_STOREFRONT` env var, not a per-artist
  setting — an artist whose catalog differs by storefront pulls whatever that one
  storefront returns.
