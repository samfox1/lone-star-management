# Resident Advisor
One line: connecting it gives the artist's site a Resident Advisor button that links to their DJ/artist profile.

## Connection type
Link only (no API, nothing is pulled — RA has no public developer API; see Integration below).

## What the manager enters
The RA slug alone (e.g. "the Resident Advisor name"), shown between its address in grey (`ra.co/dj/` [name]). Accepted: the slug alone, or a pasted profile link from ra.co or the old residentadvisor.net — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers and hyphens, 1-50 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9-]{1,50}$/`

**Not officially documented by RA** — there is no published spec for artist-page slugs. This is inferred from real profile URLs (`ra.co/dj/djhttps`, `ra.co/dj/who`), which use lowercase URL-slug characters; the rule here accepts upper case too since the manager may type a display name rather than the exact slug RA generated, and RA's own casing behavior for that isn't documented.

A pasted `residentadvisor.net/dj/<slug>` link (the pre-redesign domain) is read down to its slug and rebuilt on `ra.co` — the same old-domain-to-new-domain rebuild X does for `twitter.com`.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Resident Advisor name."
- Doesn't match the rule: "That doesn't look like a Resident Advisor name."
- A link from a different known platform: "That's a SoundCloud link, not Resident Advisor."
- A link from an unknown host: "That isn't a Resident Advisor link."

## How it is stored
`links` row: label "Resident Advisor", url = `https://ra.co/dj/<name>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `resident advisor` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://ra.co/dj/'`; `aliasHosts: ['residentadvisor.net']`.

Mark: **still a PLACEHOLDER** — searched ra.co, pro.ra.co (RA's advertiser site) and the open web (2026-09-28). The rule that mattered: there isn't one — RA publishes no brand, press or media-kit page and no logo-usage rules anywhere on its own sites; every hit is a third-party logo aggregator (Brandfetch, Brands of the World, seeklogo, vectorseek…), which is exactly the kind of source we don't take a mark from. So `scripts/generate-social-icons.ts` still draws a plain lettermark ("RA" inside a square outline), black, marked `// PLACEHOLDER` in `social-icons.ts`. It is not the brand's artwork and was not copied from a brand site. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/resident-advisor/index.ts` — this service's own code: `social`: the handle spec, `fromPath` for the `/dj/<slug>` path, the old-domain host.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the name, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `ra.co/dj/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the name into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored name afterwards (`KvField` + `saveHandle`), labelled "Name".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('resident advisor')` — the placeholder lettermark (see On the site).
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label, `residentadvisor.net` alias, and placeholder mark.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Integration (research)
Docs read: [RA support — "I want an Artist / DJ profile"](https://support.ra.co/article/83-i-want-an-artist-dj-profile), [RA support — "Creating an artist, DJ or label page"](https://support.ra.co/article/266-i-would-like-an-artist-dj-or-label-page), [Resident Advisor — Wikipedia](https://en.wikipedia.org/wiki/Resident_Advisor) (confirms the residentadvisor.net → ra.co domain move). No RA page documents the slug's character rules.

RA does not publish a public developer API or an events-by-artist endpoint. RA's own site is built on an internal GraphQL endpoint (`ra.co/graphql`) that several unofficial scrapers and third-party "API" products (Apify actors, etc.) hit directly with no published schema, no API key, and no terms covering third-party use — it is not a supported integration surface, just an internal endpoint that happens to be reachable. RA did solicit beta testers for an events/charts API on social media in the past, but nothing shipped publicly since.

**Verdict:** no supported API exists. A future "pull RA gigs" feature (the way Bandsintown/Ticketmaster pull tour dates) would mean depending on an undocumented internal endpoint with no stability guarantee — not recommended without RA's explicit sign-off.

## Tests

Specific to Resident Advisor:
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "Bluesky, Snapchat, Resident Advisor: the name sits after a fixed path" (a `residentadvisor.net` link rebuilds on `ra.co`).
- `tests/unit/site-editor/social-hosts.test.ts` — "the platforms’ own other domains": `residentadvisor.net` reads as Resident Advisor.
- `tests/unit/media/social-icons.test.ts` — "the marks simple-icons lacks are PLACEHOLDERS".

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps
- The mark is a PLACEHOLDER lettermark (simple-icons has no RA mark, and RA publishes no brand/press/media-kit page or logo-usage rules of its own to draw from).
- The slug character rule is inferred from two example URLs, not a published spec.
- No API: RA gigs cannot be pulled into the dashboard the way Bandsintown/Ticketmaster tour dates are; the only accessible endpoint (`ra.co/graphql`) is undocumented and unofficial.
