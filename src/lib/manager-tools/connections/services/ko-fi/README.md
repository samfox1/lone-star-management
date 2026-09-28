# Ko-fi
One line: connecting it gives the artist's site a Ko-fi button that links to their public tip page. This is a link only — we never touch payment info, credentials, or account numbers.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The page name alone (e.g. "the Ko-fi page name"), shown between its address in grey (`ko-fi.com/` [page name]). Accepted: the name alone, or a pasted profile link from ko-fi.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, underscores and hyphens, 3-30 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9_-]{3,30}$/`

This length/charset is **not officially documented** by Ko-fi — Ko-fi's own help center only says non-Gold members need at least 5 characters and Gold members can go shorter (see Integration section below). The rule here is deliberately a little wider than that so a real page name is never wrongly rejected; it is observed from real Ko-fi URLs (`ko-fi.com/generalusername` and similar), which show only letters, numbers, underscores and hyphens.

A link with a path beyond the name (a shop item, a post, `ko-fi.com/<name>/shop`) is not rejected — only the first path segment is read as the name, so it quietly rebuilds down to the bare profile link, same as a PayPal.Me amount is dropped (see paypal/README.md).

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Ko-fi page name."
- Doesn't match the rule: "That doesn't look like a Ko-fi page name."
- A link from a different known platform: "That's a Patreon link, not Ko-fi."
- A link from an unknown host: "That isn't a Ko-fi link."

## How it is stored
`links` row: label "Ko-fi", url = `https://ko-fi.com/<name>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `ko-fi` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://ko-fi.com/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `kofi`, brand colour `#FF6433`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/ko-fi/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `ko-fi.com/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Page name".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('ko-fi')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Integration (research)
Docs read: [Ko-fi Help Center](https://help.ko-fi.com/) (page/URL customization articles), [Does Ko-fi have an API or webhook?](https://help.ko-fi.com/hc/en-us/articles/360004162298-Does-Ko-fi-have-an-API-or-webhook) The exact character rule for a page name is not published; the 5-character minimum for non-Gold accounts is the only documented constraint found.

Ko-fi does have a webhook (not a pull API): it POSTs a form-encoded payload to a URL the creator configures, one event per Donation/Subscription/Shop Order/Commission, verified with a `verification_token`. That is one-way and push-only — there is nothing to poll or OAuth into for a manager's public page, and it requires the creator to configure the webhook on Ko-fi's own site first. It is not useful for embedding a profile or pulling a catalog the way Spotify/YouTube sync does.

**Verdict:** no read API worth building against. If a future feature wanted to show "tips received" it would need the artist to set up a Ko-fi webhook pointed at our own endpoint — a different, opt-in integration, not a profile-link sync.

## Tests

Specific to Ko-fi:
- None: nothing here is Ko-fi-only. The shared suites below cover it by looping over every platform.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps
- Ko-fi's own page-name character rules are not published; the rule above is inferred from real page URLs, not a spec.
- Ko-fi shop items, posts, and commission pages are all different paths under `ko-fi.com` — pasting one of those quietly saves the bare profile link instead (first path segment only), with no message telling the manager that happened.
