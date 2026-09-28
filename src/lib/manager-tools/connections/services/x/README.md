# X
One line: connecting it gives the artist's site an X button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The handle alone (e.g. "the X handle"), shown between its address in grey (`x.com/` [handle]). Accepted: the handle with or without @, or a pasted profile link from x.com and twitter.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers and underscores, 1-15 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9_]{1,15}$/`

A pasted `twitter.com` or `mobile.twitter.com` link (the old domain, still one of `hosts`) is read back to its handle and rebuilt on `x.com` — share params (`?s=21&t=…`) and a stray `www.`/`mobile.` are dropped along the way.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the X handle.”
- Doesn't match the rule: “That doesn’t look like an X handle.”
- A link from a different known platform: “That’s an Instagram link, not X.”
- A link from an unknown host: “That isn’t an X link.”

## How it is stored
`links` row: label "X", url = `https://x.com/<handle>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `x` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#000000`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/manager-tools/connections/services/x/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder; the old `twitter.com` is a second host).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `x.com/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Handle".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('x')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — X is the primary `parseHandle` fixture: bare handle with/without @, pasted `x.com`/`twitter.com`/`mobile.twitter.com` links, and every error string.
- `tests/unit/manager-tools/connections/connections.test.ts` — `connectInputError`, `profileLink`, `wantsSync` and `methodOf` all exercised on X.
- `tests/components/manager-tools/connections/connect-modal.test.tsx` — the field shows `x.com/` in grey with a bare `handle` placeholder; a pasted link tidies to the handle on paste, an @ drops on blur; the run step sends the raw handle and then shows `x.com/skeenmusic`.
- `tests/unit/manager-tools/connections/connections-actions.test.ts` — `connectOneAction('a1', 'x', { handle: '@skeenmusic' })`.
- `tests/integration/manager-tools/connections/connect-off-site.test.ts` — CRITICAL: connecting X saves the profile OFF the site, and a Retry after a manual on-site edit leaves that flag alone.

## Known gaps
None known.
