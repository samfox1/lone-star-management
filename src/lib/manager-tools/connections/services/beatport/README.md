# Beatport

Connecting Beatport links the artist's Beatport profile on the site. It does not pull
anything into the dashboard — there is no Beatport catalog integration in this codebase.

## Connection type

Link only. Beatport is a social platform with a `link`-kind connect method
(`src/lib/manager-tools/connections/services/beatport/index.ts`: `{ kind: 'link' }`), and
no entry in `src/lib/integrations-registry.ts` — nothing to sync.

## What the manager enters

The manager pastes their Beatport artist link (`https://www.beatport.com/artist/<slug>/<id>`).
There is no handle field: Beatport has no `@handle`-style profile, and the slug in the URL
(`https://www.beatport.com/artist/local-artist/429378`) is not unique by itself — the numeric
id after it is what actually identifies the artist (two different artists can share the same
slug, e.g. Beatport's own `local-artist` and `known-artist` pages each carry a distinct id).
Because of that, the field takes the whole link rather than trying to build one from a typed
name.

Errors, matching the pattern used by every other link-kind connection in `src/lib/connections.ts`
(`profileLink` / `connectInputError`):
- Empty field: "Paste the Beatport link."
- Just the bare site address (`https://www.beatport.com/artist/`, nothing after): "Add the
  rest of the link — that's just the site's address."
- A link to a different known platform: "That's a TikTok link, not Beatport." (the wrong
  platform's name fills in)
- A link no platform owns (a personal site, a `javascript:` string): "That isn't a Beatport link." A link-kind connection takes only a link the site reads as Beatport (`platformFromUrl`), made https (2026-09-28).

No Sync checkbox appears in the Connect modal for Beatport: `SyncSwitch` (`connect-modal.tsx`)
only renders when the connection def has both a social and a source, and Beatport has neither
a source nor an id-extraction function here.

## How it is stored

A `links` row only: `label: 'Beatport'`, `url` = the artist link as pasted, `on_site: false` by
default (off the site until the manager makes it a button in the site editor's Socials panel).

There is no `artists.beatport_artist_id` column and no id field anywhere for Beatport.

## Sync / integration

None implemented. See "Integration (research)" below for what a future sync would need.

## On the site

Bridge slug `beatport` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://www.beatport.com/artist/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `beatport`, brand colour `#01FF95`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map

- `src/lib/manager-tools/connections/services/beatport/index.ts` — this service's own code:
  `social`: `{ kind: 'link' }`, the only Beatport-specific line of connection logic.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above.
- `src/lib/connections.ts` — `idFromProfileUrl` answers null (Beatport has no `idFromUrl`);
  `CONNECTIONS` includes Beatport as a plain social with no `source`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction` (the profile-link-only path), `disconnectConnectionAction`.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `beatport` slug, `urlHint`,
  and icon.

## Tests

Specific to Beatport:
- None: nothing here is Beatport-only. The shared suites below cover it by looping over every platform.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "so do the 2026-09-28 platforms with no handle" (a link-kind method).
- `tests/unit/manager-tools/connections/connections.test.ts` — "a link-kind connection takes only ITS platform’s link": its own link is accepted as pasted; a personal site and an Instagram link are refused, by name.
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps

- No catalog integration at all: connecting Beatport never pulls anything into the dashboard.
- No id extraction: `idFromProfileUrl` won't read the numeric id out of a pasted Beatport
  link even though the URL shape supports it (`/artist/<slug>/<id>`) — there's simply nowhere
  for that id to go without a registry entry and an `artists` column, same shape as Tidal's gap.

## Integration (research)

Docs read:
- Beatport's own developer docs are not public; the v4 API's existence and shape are described
  secondhand by a community-maintained gist
  ([Beatport (Internal + External) API Documentation](https://gist.github.com/kemo/506ca56e35b9506ee5233bc4d773c1c8))
  and a thread on obtaining access
  ([How to get access to Beatport API](https://groups.google.com/g/beatport-api/c/3qR1Uj1HnUk)).
- Real artist page URLs observed directly (`beatport.com/artist/<slug>/<id>`, e.g.
  `https://www.beatport.com/artist/various-artists/10578`) to confirm the id-after-slug shape.

API/connect flow: Beatport runs a v4 REST API (`api.beatport.com`) gated behind OAuth 2.0
authorization-code grant, reachable only through Beatport's Partner Portal — there is no
public self-serve client-credentials tier. This could not be confirmed against an official,
publicly reachable Beatport doc (Beatport doesn't publish one at a stable public URL); take
the API's existence as credible but unverified from a first-party source. A future sync would
need: partner approval from Beatport, an OAuth app registration, a `beatport_artist_id` column
(the numeric id, not the slug), a client in `src/lib/beatport.ts`, and — if approved — an
`idFromUrl` here to grab that id out of the pasted link (`grab(url, /beatport\.com\/artist\/[^/]+\/(\d+)/)`
would do it).
