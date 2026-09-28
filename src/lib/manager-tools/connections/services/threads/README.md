# Threads
One line: connecting it gives the artist's site a Threads button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The handle alone (e.g. "the Threads handle"), shown between its address in grey (`threads.net/@` [handle]). Accepted: the handle with or without @, or a pasted profile link from threads.net and threads.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, periods and underscores, 1-30 characters. Regex (`src/lib/connect-methods.ts`, `SPECS.threads.rule`): `/^[A-Za-z0-9._]{1,30}$/`

A pasted `threads.com` link (also listed in `hosts`) is accepted the same way as `threads.net` and rebuilt on `threads.net` — the field's address and the built link never show `.com`.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the Threads handle.”
- Doesn't match the rule: “That doesn’t look like a Threads handle.”
- A link from a different known platform: “That’s an Instagram link, not Threads.”
- A link from an unknown host: “That isn’t a Threads link.”

## How it is stored
`links` row: label "Threads", url = `https://threads.net/@<handle>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `threads` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#000000`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/connect-methods.ts` — SPECS.threads: noun/hosts/rule/before-after/url builder, the two-entry `hosts` list that also matches `threads.com`; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `threads.net/@` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Handle".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('threads')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — the explicit "@ platforms" case: `parseHandle(threads, 'https://www.threads.net/@skeen')` reads back to `{ handle: 'skeen', url: 'https://threads.net/@skeen' }`; also covered by the cross-platform CRITICAL loop.
- No other test names Threads specifically — it otherwise rides the shared Connect/editor UI tests that exercise any handle platform generically.

## Known gaps
`threads.com` is accepted as a pasted host (SPECS.threads.hosts) alongside `threads.net`, but the built link and the address shown in the field always use `threads.net` — a `threads.com` paste is silently normalised to the other domain.
