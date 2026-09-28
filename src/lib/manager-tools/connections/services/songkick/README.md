# Songkick
One line: connecting it gives the artist's site a Songkick button that links to their artist page.

## Connection type
Link only. Songkick has no handle — an artist page's URL carries a numeric id plus a name slug (`social.method = { kind: 'link' }`, same shape as Tidal), so the manager pastes the whole link rather than typing a name (`src/lib/connections.ts`). Not a tour-date source here (see Integration (research) below) — Bandsintown and Ticketmaster already fill that role in this codebase.

## What the manager enters
The manager pastes their Songkick artist page link, e.g. `https://www.songkick.com/artists/217815-taylor-swift`. There is no handle field — the id is Songkick's own numeric identifier, not something the manager chooses, and the name slug after it is cosmetic (Songkick's own support docs describe reading the id off this URL).

Errors, following the pattern in `src/lib/connections.ts` (`profileLink` / `connectInputError`) for a link-kind connection:
- Empty field: "Paste the Songkick link."
- Just the bare site address, nothing after: "Add the rest of the link — that's just the site's address."
- A link to a different known platform: "That's a TikTok link, not Songkick." (the wrong platform's name fills in)
- A link no platform owns (a personal site, a `javascript:` string): "That isn't a Songkick link." A link-kind connection takes only a link the site reads as Songkick (`platformFromUrl`), made https (2026-09-28).

## How it is stored
`links` row: label "Songkick", url = the artist page link as pasted, on_site false until added as a button in the editor, role null. No `artists` column — there is no id extraction (`idFromUrl` is left unset here), matching Tidal's precedent: a source would need an `INTEGRATION_REGISTRY` entry and an `artists` column before an id would have anywhere to go, and see Known gaps for why that's not worth wiring up today.

## On the site

Bridge slug `songkick` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://songkick.com/artists/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `songkick`, brand colour `#F80046`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/songkick/index.ts` — this service's own code: `social`: `{ kind: 'link' }`, the only Songkick-specific line of connection logic.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above.
- `src/lib/connections.ts` — `idFromProfileUrl` answers null (Songkick has no `idFromUrl`); `profileLink` takes only a link `platformFromUrl` reads as Songkick, made https.
- `.../connections/actions.ts` — `connectOneAction` (the profile-link-only path), `disconnectConnectionAction`.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `songkick` slug, `urlHint`, and icon.

## Tests

Specific to Songkick:
- None: nothing here is Songkick-only. The shared suites below cover it by looping over every platform.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "so do the 2026-09-28 platforms with no handle" (a link-kind method).
- `tests/unit/manager-tools/connections/connections.test.ts` — "a link-kind connection takes only ITS platform’s link": its own link is accepted as pasted; a personal site and an Instagram link are refused, by name.
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Integration (research)
Docs read: [Songkick — Concerts and Festivals API, Getting Started](https://www.songkick.com/developer/getting-started) (base URL `https://api.songkick.com/api/3.0`, key passed as a query param); [Find your Songkick artist ID](https://support.songkick.com/hc/en-us/articles/360012427414-Find-your-Songkick-artist-ID) (id is read off the artist page URL, e.g. `songkick.com/artists/217815-taylor-swift`); [Access the Songkick API](https://support.songkick.com/hc/en-us/articles/360012423194-Access-the-Songkick-API) and the [API key request form](https://www.songkick.com/api_key_requests/new). Not confirmed: whether a bare `songkick.com/artists/217815` link (no name slug) resolves the same page — every example I found in the docs keeps the slug, so this connection accepts the link exactly as pasted rather than trying to rebuild or normalize it.

**API key status, as of this research:** Songkick is *not currently accepting new API key applications* — its own support docs say the API is being updated and existing applicants get a response within 30 working days, with no guarantee of a new key. Separately, Warner Music Group sold Songkick to Suno (the AI music generation company) in November 2025 as part of a lawsuit settlement; reporting (CelebrityAccess, Music Business Worldwide, Hypebot) describes Suno taking over Songkick's user and event data with plans to fold it into its own AI platform, not confirming whether third-party API access continues. Verdict: an API exists on paper (gigography, artist search, tracking), but getting a new key is unconfirmed and the platform's ownership/roadmap just changed hands — **not a good candidate for a sync to build today**; this connection is link only.

## Known gaps
- No sync: connecting Songkick only saves the artist page link, nothing is pulled into Tour dates — Bandsintown and Ticketmaster remain this codebase's tour-date sources.
- If Songkick sync is ever revisited, it would need: a confirmed API key (currently not being issued to new applicants), a `songkick_artist_id` column, an `INTEGRATION_REGISTRY` entry, a `src/lib/songkick.ts` client, and wiring into `SAVE`/`PULL` in `src/app/artists/[id]/(dashboard)/integrations.ts` — none of which exists today, and the Suno acquisition makes the API's future uncertain enough that this isn't recommended right now.
