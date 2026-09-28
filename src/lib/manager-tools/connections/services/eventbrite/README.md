# Eventbrite
Connecting Eventbrite links the artist's organizer profile on the site. Nothing is pulled today — see Integration below for what a future events sync would need.

## Connection type
Link only. Eventbrite issues two real, inconsistent organizer-profile shapes (a `/o/<slug>-<id>` path and a custom `<name>.eventbrite.com` subdomain), so — like Spotify and Tidal — there is no one clean handle to build from. The manager pastes their organizer link as-is (`src/lib/connections.ts`).

## What the manager enters
The manager pastes their Eventbrite organizer link (`https://www.eventbrite.com/o/skeenmusic-123456789`, or their custom `https://skeenmusic.eventbrite.com`). There is no separate id field; where the numeric organizer id is present in the link, it is read out for future use (see How it is stored).

Errors, quoted from `src/lib/connections.ts` (`profileLink` / `connectInputError`):
- Empty field: "Paste the Eventbrite link."
- Just the bare site address (nothing after the host): "Add the rest of the link — that's just the site's address."
- A link to a different known platform: "That's an Instagram link, not Eventbrite." (the wrong platform's name fills in; Ticketmaster is a service, not a site platform, so its links read as nobody's)
- A link no platform owns (a personal site, a `javascript:` string): "That isn't an Eventbrite link." A link-kind connection takes only a link the site reads as Eventbrite (`platformFromUrl`), made https (2026-09-28). Its country sites (`eventbrite.co.uk`, `.com.au`…) and an organizer subdomain (`skeen.eventbrite.com`) are Eventbrite.

No Sync checkbox appears in the Connect modal: `SyncSwitch` (`connect-modal.tsx`) only renders when the connection def has both a social and a source, and Eventbrite has no `source` entry in this batch.

## How it is stored
- A `links` row: `label: 'Eventbrite'`, `url` = the organizer link as pasted, `on_site: false` (off the site until the manager makes it a button in the site editor's Socials panel).
- No `artists` column today. `social.idFromUrl` (`index.ts` here) already extracts the numeric organizer id out of an `/o/<slug>-<id>` link, wired generically through `idFromProfileUrl` (`src/lib/connections.ts`) — but nothing reads or stores that id yet, since there is no `source`/registry entry for Eventbrite. It is there so a future sync does not have to re-derive it from scratch.

## On the site

Bridge slug `eventbrite` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://eventbrite.com/o/'`; its country sites (`eventbrite.co.uk`, `.com.au`, `.ca`…) as `aliasHosts`.

Mark: **a PLACEHOLDER** — simple-icons has no Eventbrite mark, so `scripts/generate-social-icons.ts` draws a plain lettermark (an "E" knocked out of a square), black, marked `// PLACEHOLDER` in `social-icons.ts`. It is not the brand's artwork and was not copied from a brand site. Pending Sam's choice of the official brand-kit logo. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/eventbrite/index.ts` — this service's own code: `social` (link method, the organizer-id regex as `idFromUrl`).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above (a link-kind entry needs no handle spec).
- `src/lib/connections.ts` — `idFromProfileUrl` (dispatches to `idFromUrl` above), `profileLink`/`connectInputError` for the link-only flow.
- `.../connections/actions.ts` — `connectOneAction` (the profile-link-only path), `disconnectConnectionAction`.
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('eventbrite')` — the placeholder lettermark (see On the site).
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, `urlHint`, country `aliasHosts`, and placeholder mark.

## Integration (research)
Docs read: [Create and edit your organizer profile](https://www.eventbrite.com/help/en-us/articles/161196/how-to-set-up-your-organizer-profile-page/) (documents the `<name>.eventbrite.com` custom-subdomain shape); real organizer pages observed at `eventbrite.com/o/organizer-96733738163` and `eventbrite.com/o/2666544056` (the `/o/<slug>-<id>` and bare-id shapes — not covered by the help article above); [Eventbrite Platform docs — API Basics / Events](https://www.eventbrite.com/platform/docs/api-basics) (OAuth and private-token auth, general shape only — could not load the full endpoint reference); organizer-events endpoint shape (`GET https://www.eventbriteapi.com/v3/organizations/{organization_id}/events/`) and the `GET /users/me/organizations/` lookup to get that id, both cross-checked against third-party API-documentation summaries rather than Eventbrite's own reference page loading cleanly.

**API verdict: yes, worth a future sync — the one service in this batch closest to Ticketmaster/Bandsintown.** Eventbrite's v3 API can list an organization's events (dates, venue, ticket status) via `GET /organizations/{organization_id}/events/`, bearer-authenticated. For an artist managing their own Eventbrite account, a **private OAuth token** from their own account settings is enough — no app review needed. To pull events on behalf of *any* artist's organizer account from one platform app (the model Bandsintown/Ticketmaster follow here), Eventbrite's **full OAuth authorize/token flow** (`eventbrite.com/oauth/authorize`, `eventbrite.com/oauth/token`) would be needed instead, which means Eventbrite has to approve the app and each artist must grant access — a heavier lift than Spotify's Client Credentials flow. A future implementation would need: an `eventbrite_organizer_id` (or `organization_id`) column, a client (`lib/eventbrite.ts`), an `INTEGRATION_REGISTRY` entry (probably feeding `tour dates`, alongside Bandsintown/Ticketmaster), and either a per-artist private-token flow or the full OAuth dance — none of which exists today.

## Tests

Specific to Eventbrite:
- `tests/unit/site-editor/social-hosts.test.ts` — "Eventbrite on its country sites, and on an organizer subdomain", "every alias is a host the matcher can reach", and the look-alikes (`eventbrite.co.uk.evil.net`, `evileventbrite.co.uk`, `co.uk`).
- `tests/unit/manager-tools/connections/connections.test.ts` — "the host rules decide" (a `.co.uk` organizer link and a subdomain page connect) and "Eventbrite: the organizer id comes out of an /o/ link, and nothing out of anyone else’s".
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
- The mark is a PLACEHOLDER lettermark (simple-icons has no Eventbrite mark), pending Sam's choice of the official brand-kit logo.
- (Fixed 2026-09-28.) Country domains collapsed to `co.uk` and read as nobody. The bridge now keeps three labels under a listed multi-part suffix (`registrableDomain`) and lists Eventbrite's country sites as `aliasHosts` (`EVENTBRITE_COUNTRIES`): explicit, never "any TLD". A country site missing from that list reads as nobody and is refused; add it there. `idFromUrl` is anchored on the host, so an `eventbrite.com/o/…` inside another site's path gives no id.
- No sync is built — see Integration above for exactly what one would need.
