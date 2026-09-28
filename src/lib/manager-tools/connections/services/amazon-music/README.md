# Amazon Music

Connecting Amazon Music links the artist's Amazon Music profile on the site. It does not
pull anything into the dashboard — there is no Amazon Music catalog integration in this
codebase.

## Connection type

Link only. Amazon Music is a social platform with a `link`-kind connect method
(`src/lib/manager-tools/connections/services/amazon-music/index.ts`: `{ kind: 'link' }`), and
no entry in `src/lib/integrations-registry.ts` — nothing to sync.

## What the manager enters

The manager pastes their Amazon Music artist link
(`https://music.amazon.com/artists/<ASIN>/<slug>`, e.g.
`https://music.amazon.com/artists/B00157GJ20/taylor-swift`). There is no handle field: Amazon
Music has no `@handle`-style profile, only an ASIN (Amazon's catalog id) followed by a
cosmetic name slug — so the field takes the whole link rather than a typed name.

Errors, matching the pattern used by every other link-kind connection in `src/lib/connections.ts`
(`profileLink` / `connectInputError`):
- Empty field: "Paste the Amazon Music link."
- Just the bare site address (`https://music.amazon.com/artists/`, nothing after): "Add the
  rest of the link — that's just the site's address."
- A link to a different known platform: "That's a TikTok link, not Amazon Music." (the wrong
  platform's name fills in). A country storefront (`music.amazon.co.uk`, `.de`, `.co.jp`…)
  is Amazon Music; an Amazon shop page (`amazon.com/dp/…`) is nobody's and is refused.
- A link no platform owns (a personal site, a `javascript:` string): "That isn't an Amazon Music link." A link-kind connection takes only a link the site reads as Amazon Music (`platformFromUrl`), made https (2026-09-28).

No Sync checkbox appears in the Connect modal for Amazon Music: `SyncSwitch`
(`connect-modal.tsx`) only renders when the connection def has both a social and a source, and
Amazon Music has neither a source nor an id-extraction function here.

## How it is stored

A `links` row only: `label: 'Amazon Music'`, `url` = the artist link as pasted, `on_site:
false` by default (off the site until the manager makes it a button in the site editor's
Socials panel).

There is no `artists.amazon_music_artist_id` column and no id field anywhere for Amazon Music.

## Sync / integration

None implemented. See "Integration (research)" below.

## On the site

Bridge slug `amazon music` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://music.amazon.com/artists/'`; `subdomainOnly`, with its country storefronts (`music.amazon.co.uk`, `.de`, `.co.jp`…) as `aliasHosts`; the rest of amazon.com is nobody's.

Mark: **a PLACEHOLDER** — simple-icons has no Amazon Music mark, so `scripts/generate-social-icons.ts` draws a plain lettermark (an "A" knocked out of a circle), black, marked `// PLACEHOLDER` in `social-icons.ts`. It is not the brand's artwork and was not copied from a brand site. Pending Sam's choice of the official brand-kit logo. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map

- `src/lib/manager-tools/connections/services/amazon-music/index.ts` — this service's own
  code: `social`: `{ kind: 'link' }`, the only Amazon-Music-specific line of connection logic.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above.
- `src/lib/connections.ts` — `idFromProfileUrl` answers null (Amazon Music has no
  `idFromUrl`); `CONNECTIONS` includes Amazon Music as a plain social with no `source`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction` (the profile-link-only path), `disconnectConnectionAction`.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `amazon music` slug,
  `urlHint`, and placeholder mark.

## Tests

Specific to Amazon Music:
- `tests/unit/site-editor/social-hosts.test.ts` — "music.amazon.<country> is Amazon Music, and the rest of Amazon is nothing" (all twelve storefronts; an amazon.com product page is null), and the look-alikes (`music.amazon.co.uk.evil.net`, `music.amazon.xyz`, `notmusic.amazon.com`).
- `tests/unit/manager-tools/connections/connections.test.ts` — "the host rules decide": a `music.amazon.co.uk` link connects, an `amazon.com/dp/…` link does not.
- `tests/unit/media/social-icons.test.ts` — "the marks simple-icons lacks are PLACEHOLDERS".

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "so do the 2026-09-28 platforms with no handle" (a link-kind method).
- `tests/unit/manager-tools/connections/connections.test.ts` — "a link-kind connection takes only ITS platform’s link": its own link is accepted as pasted; a personal site and an Instagram link are refused, by name.
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps

- No catalog integration: connecting Amazon Music never pulls anything into the dashboard.
- No id extraction: `idFromProfileUrl` won't read the ASIN out of a pasted Amazon Music link
  even though the URL shape supports it (`/artists/<ASIN>/<slug>`) — same shape as Tidal's gap.
- The mark is a PLACEHOLDER lettermark (simple-icons has no Amazon mark of any kind), pending
  Sam's choice of the official brand-kit logo. See On the site.
- (Fixed 2026-09-28.) Country domains collapsed to `co.uk` and read as nobody. The bridge now
  keeps three labels under a listed multi-part suffix (`registrableDomain`), and Amazon Music is
  `subdomainOnly` with an explicit list of its storefronts as `aliasHosts`: never "any TLD", so
  a stranger's `music.amazon.xyz` is nobody's. A storefront missing from that list reads as
  nobody and is refused; add it to `AMAZON_MUSIC_COUNTRIES` in the bridge.

## Integration (research)

Docs read:
- [Amazon Music Artist Profiles — Amazon Music for Artists Help Center](https://intercom.help/amazon-music-for-artists/en/articles/7231422-amazon-music-artist-profiles)
  (fetched directly) — confirms the `music.amazon.com/artists/<ASIN>/<slug>` shape.
- [Web API Artists V1.0 — Amazon Music Web API](https://developer.amazon.com/docs/music/API_web_artist.html)
  (fetched directly).
- Search results referencing Amazon's UK/DE storefronts for the Artist Merch Shop, used to
  confirm country domains exist; not independently fetched from a single authoritative page.

API/connect flow: Amazon publishes a Web API for artist catalog data (name, ids, images,
discography, similar artists, follower counts, direct Amazon Music links) — but its own docs
say plainly: **"These Amazon Music APIs are currently in a closed Beta. Please check back soon
for updates."** Scopes named (`music::catalog`, `music::favorites:read`) suggest it's meant for
apps already inside Amazon's ecosystem (Alexa skills, device integrations), not a general
public signup. There is no confirmed path to a key today. A future sync would need Amazon to
open (or grant) Beta access, an `amazon_music_artist_id` (ASIN) column, a client in
`src/lib/amazon-music.ts`, and an `idFromUrl` here
(`grab(url, /music\.amazon\.[a-z.]+\/artists\/([A-Za-z0-9]+)/)`) once the domain-matching gap
above is resolved.
