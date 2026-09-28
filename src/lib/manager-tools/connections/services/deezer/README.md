# Deezer

Connecting Deezer links the artist's Deezer profile on the site and pulls their top
songs (metadata + a link-out, no audio) into the dashboard.

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

**What is pulled**: the artist's top tracks,
`GET /artist/{id}/top?limit=100`, following `next` cursors up to a hard cap of 50
pages (`maxPages`, so a self-referential or looping cursor can't spin forever). The
result is de-duplicated by lowercased, trimmed title before being handed to the
sync step.

**Where it lands**: `syncDeezerTracks` (`src/lib/sync.ts`) writes/merges into the
`tracks` table only — Deezer never creates a `releases` row. Fields written:
`deezer_id`, `title`, `cover_url`, `album_name`, `duration_ms`, and the deezer.com
link-out in `provider_url`. New rows land `on_site: false`. Deezer has no
`stream_url` — its ToS bars exposing audio, per the file header comment, so it is a
metadata + link-out source only (same as Apple Music).

A song already pulled from another platform is matched by normalized title +
duration and gets Deezer's id stamped onto that same row instead of duplicating it
(`src/lib/sync-match.ts`, `matchTrackCandidate`); on a merge Deezer's link is
deliberately left out of the fill (`mergeFill: {}` in `syncDeezerTracks`) because it
rebuilds from `deezer_id` rather than needing to be stored twice.

**Proof of sync**: `TRACK_ID_COLUMN.deezer = 'deezer_id'`
(`src/lib/integrations-registry.ts`) — the connection reads "synced" when at least
one track row carries a non-null `deezer_id`, "failed" when the artist id is set but
nothing does.

**Limits and quirks (from code)**: Deezer signals quota exhaustion in the response
**body** with HTTP 200 (`{ error: { code: 4 } }`), not with an HTTP error status —
`onBody` in the shared `httpGetJson` helper detects code 4 and retries with a 1s
backoff; any other body-level error throws. Standard HTTP 429s back off using
`Retry-After` and retry up to 3 times, same as Spotify and Apple Music
(`src/lib/http.ts`).

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
- `src/lib/deezer.ts` — `createDeezerClient`: pagination, title dedupe, the
  in-body quota-error handling.
- `src/lib/sync.ts` — `syncDeezerTracks`: writes/merges into `tracks`.
- `src/lib/sync-match.ts` — cross-platform title/duration matching shared by all
  three catalog services.
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

- `tests/unit/sync/deezer.test.ts` — the client: mapping, `next` pagination, title
  dedupe, HTTP-429 backoff, Deezer's in-body quota error (code 4) backoff.
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

- No `releases` sync: a song pulled from Deezer never creates or joins an album/EP
  card on its own — it stays a loose track unless a later Spotify pull matches it in
  by title + duration.
- No audio: Deezer's terms bar exposing streams, so Deezer-only songs have no
  in-app playback, only a link-out.
- `getArtistTracks` reads the artist's **top** tracks endpoint (`/top?limit=100`),
  not a full discography endpoint — an artist with a large catalog may not have
  every song pulled, only what Deezer ranks as their top tracks across up to 50
  pages.
