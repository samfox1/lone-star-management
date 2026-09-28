# Tidal

Connecting Tidal links the artist's Tidal profile on the site. It does not pull
anything into the dashboard — there is no Tidal catalog integration in this codebase.

## Connection type

Link only. Tidal is a social platform in the bridge's `SOCIAL_PLATFORMS`
(`packages/site-bridge/src/social.ts`) with a `link`-kind connect method
(`src/lib/connect-methods.ts`: `tidal: { kind: 'link' }`), but it has **no entry**
in `src/lib/integrations-registry.ts` — so `src/lib/connections.ts` never attaches a
`source` to its connection def. There is nothing to sync.

## What the manager enters

The manager pastes their Tidal artist link (`https://tidal.com/artist/...`). There
is no handle field and no id field — Tidal artists have no handle, and because there
is no sync source, the code never tries to read an id out of the link either.

Errors, quoted from `src/lib/connections.ts` (`profileLink` / `connectInputError`):
- Empty field: "Paste the Tidal link."
- Just the bare site address (`https://tidal.com/artist/`, nothing after): "Add the
  rest of the link — that's just the site's address."
- A link to a different known platform: "That's a TikTok link, not Tidal." (the
  wrong platform's name fills in)

No Sync checkbox appears in the Connect modal for Tidal: `SyncSwitch`
(`connect-modal.tsx`) only renders when the connection def has both a social and a
source, and Tidal has no source.

## How it is stored

A `links` row only: `label: 'Tidal'`, `url` = the artist link as pasted,
`on_site: false` by default (off the site until the manager makes it a button in the
site editor's Socials panel — Connections never flips that on).

There is **no** `artists.tidal_artist_id` column, and no id field anywhere for
Tidal — confirmed by `ArtistIdField` in `src/lib/integrations-registry.ts`, which
lists `spotify_artist_id` / `deezer_artist_id` / `apple_artist_id` /
`youtube_channel_id` / `bandsintown_name` / `ticketmaster_attraction_id` /
`drive_folder_id` and nothing for Tidal, and by a grep of
`supabase/migrations/*.sql`, which has no Tidal-related migration.

## Sync / integration

None. There is no Tidal API client in this codebase (no `src/lib/tidal.ts`), no
Tidal case in `idFromProfileUrl` (`src/lib/connections.ts` — its `switch` handles
`spotify`, `apple music`, `deezer`, and `youtube`; Tidal falls through to the
`default: return null` branch even though a Tidal artist link also carries a numeric
id after `/artist/`), and no Tidal branch in `INTEGRATION_REGISTRY`
(`src/lib/integrations-registry.ts`) or the `SAVE`/`PULL` maps in
`src/app/artists/[id]/(dashboard)/integrations.ts`.

Concretely, connecting Tidal in `connectOneAction`
(`.../connections/actions.ts`) always takes the "just save the link" path:
`wantsSync(def, input)` is `!!def.source && input.sync !== false`, and `def.source`
is `undefined` for Tidal, so `wantsSync` is always `false` and `pulled` stays `null`
regardless of what the manager does. The connection's row in the Connections list
never shows a "Sync" or "Couldn't connect" state — `connectionState` returns
`'none'` for any def with no source, same as a plain social like Instagram.

## On the site

The bridge's `SOCIAL_PLATFORMS` lists Tidal at slug `tidal`
(`packages/site-bridge/src/social.ts`) with a brand icon and colour (`#000000`) in
`social-icons.ts`, so a site that draws the bridge's icon set already knows how to
render a Tidal button. A site renders the profile link as a social button once the
manager turns it on in the site editor's Socials panel; a site with no opinion on
Tidal still renders it as a plain labelled link.

## Code map

- `src/lib/connect-methods.ts` — `tidal: { kind: 'link' }`, the only Tidal-specific
  line of connection logic.
- `src/lib/connections.ts` — `idFromProfileUrl`'s `default` branch (no id
  extraction for Tidal); `CONNECTIONS` includes Tidal as a plain social with no
  `source` because no `INTEGRATION_REGISTRY` entry has label `'Tidal'`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction` (the profile-link-only path), `disconnectConnectionAction`.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `tidal` slug,
  `urlHint`, and icon.

## Tests

- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "the music
  services, whose artists have no handle, take their artist link" asserts
  `CONNECT_METHODS['tidal'].kind === 'link'` alongside Spotify/Apple Music/Deezer.
- `tests/unit/media/social-icons.test.ts` — covers the icon set Tidal is part of
  (every `SOCIAL_PLATFORMS` slug has an icon).
- No test exercises a Tidal sync, pull, or id extraction — there is no such
  behavior to test.

## Known gaps

- No catalog integration at all: connecting Tidal never populates the Music tab,
  however the manager expects the other three music platforms to behave.
- `idFromProfileUrl` does not extract Tidal's numeric artist id from the link even
  though the URL shape (`tidal.com/artist/12345`) would support it the same way
  Deezer's does — there is simply nowhere for that id to go without a registry
  entry and an `artists` column.
- If Tidal sync is ever added, it would need: a `tidal_artist_id` column (migration),
  an `ArtistIdField` entry, an `INTEGRATION_REGISTRY` entry with a `TRACK_ID_COLUMN`
  (e.g. `tidal_id`), a `src/lib/tidal.ts` client, a `syncTidalTracks` in
  `src/lib/sync.ts`, and wiring into `SAVE`/`PULL` in
  `src/app/artists/[id]/(dashboard)/integrations.ts` — none of which exists today.
