# Pandora

Connecting Pandora links the artist's Pandora profile on the site. It does not pull
anything into the dashboard — there is no Pandora catalog integration in this codebase.

## Connection type

Link only. Pandora is a social platform with a `link`-kind connect method
(`src/lib/manager-tools/connections/services/pandora/index.ts`: `{ kind: 'link' }`), and
no entry in `src/lib/integrations-registry.ts` — nothing to sync.

## What the manager enters

The manager pastes their Pandora artist link
(`https://www.pandora.com/artist/<name>/<id>`, e.g.
`https://www.pandora.com/artist/halsey/ARVjV9gbVJ7cjxq`). There is no handle field: Pandora
has no `@handle`-style profile, and the name segment in the URL is not unique or stable by
itself — Pandora's own community forum documents artists ending up with more than one
`AR…` id for the same name — so the field takes the whole link rather than a typed name.

Errors, matching the pattern used by every other link-kind connection in `src/lib/connections.ts`
(`profileLink` / `connectInputError`):
- Empty field: "Paste the Pandora link."
- Just the bare site address (`https://www.pandora.com/artist/`, nothing after): "Add the
  rest of the link — that's just the site's address."
- A link to a different known platform: "That's a TikTok link, not Pandora." (the wrong
  platform's name fills in)
- A link no platform owns (a personal site, a `javascript:` string): "That isn't a Pandora link." A link-kind connection takes only a link the site reads as Pandora (`platformFromUrl`), made https (2026-09-28).

No Sync checkbox appears in the Connect modal for Pandora: `SyncSwitch` (`connect-modal.tsx`)
only renders when the connection def has both a social and a source, and Pandora has neither
a source nor an id-extraction function here.

## How it is stored

A `links` row only: `label: 'Pandora'`, `url` = the artist link as pasted, `on_site: false` by
default (off the site until the manager makes it a button in the site editor's Socials panel).

There is no `artists.pandora_artist_id` column and no id field anywhere for Pandora.

## Sync / integration

None implemented. See "Integration (research)" below for what a future sync would need.

## On the site

Bridge slug `pandora` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://www.pandora.com/artist/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `pandora`, brand colour `#224099`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map

- `src/lib/manager-tools/connections/services/pandora/index.ts` — this service's own code:
  `social`: `{ kind: 'link' }`, the only Pandora-specific line of connection logic.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above.
- `src/lib/connections.ts` — `idFromProfileUrl` answers null (Pandora has no `idFromUrl`);
  `CONNECTIONS` includes Pandora as a plain social with no `source`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction` (the profile-link-only path), `disconnectConnectionAction`.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `pandora` slug, `urlHint`,
  and icon.

## Tests

Specific to Pandora:
- None: nothing here is Pandora-only. The shared suites below cover it by looping over every platform.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "so do the 2026-09-28 platforms with no handle" (a link-kind method).
- `tests/unit/manager-tools/connections/connections.test.ts` — "a link-kind connection takes only ITS platform’s link": its own link is accepted as pasted; a personal site and an Instagram link are refused, by name.
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps

- No catalog integration at all: connecting Pandora never pulls anything into the dashboard.
- No id extraction: `idFromProfileUrl` won't read the `AR…` id out of a pasted Pandora link
  even though the URL shape supports it (`/artist/<name>/<id>`) — same shape as Tidal's and
  Beatport's gap.

## Integration (research)

Docs read:
- [Pandora Developer Center — APIs](https://developer.pandora.com/docs/key-concepts/apis/)
  (fetched directly).
- [Pandora Developer Center — Partner Access](https://developer.pandora.com/docs/overview/partner-access/)
  and a Pandora Community thread confirming current status
  ([Pandora API Developer Account](https://community.pandora.com/t5/Other-Devices/Pandora-API-Developer-Account/td-p/175964))
  (read via search snippets, not fetched directly).
- Real artist page URLs observed via search results (e.g.
  `pandora.com/artist/halsey/ARVjV9gbVJ7cjxq`) to confirm the id-after-name shape.

API/connect flow: Pandora publishes a GraphQL developer API (Playback, Podcast, Search,
Collection, Feedback, Profile) at `developer.pandora.com`, with a full search surface that
includes artists. But per Pandora's own Developer Center and a community-forum confirmation,
**Pandora is not currently accepting new partnership requests** — access is invitation-only
through an existing approved partner, so a new integration cannot get a key today regardless
of what the API could technically do. Treat any future Pandora sync as blocked on that gate
reopening, not as a build task. If it ever does: an `pandora_artist_id` column (the `AR…` id,
not the name), a client in `src/lib/pandora.ts`, and an `idFromUrl` here
(`grab(url, /pandora\.com\/artist\/[^/]+\/(\w+)/)`) to read it out of the pasted link.
