# Patreon
One line: connecting it gives the artist's site a Patreon button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The page name alone (e.g. "the Patreon page name"), shown between its address in grey (`patreon.com/` [page name]). Accepted: the page name with or without @, or a pasted profile link from patreon.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers and underscores — no hyphen — 1-64 characters. Regex (`src/lib/connect-methods.ts`, `SPECS.patreon.rule`): `/^[A-Za-z0-9_]{1,64}$/`

No special link shapes for this platform — a pasted link reduces to its first path segment.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the Patreon page name.”
- Doesn't match the rule: “That doesn’t look like a Patreon page name.”
- A link from a different known platform: “That’s a TikTok link, not Patreon.”
- A link from an unknown host: “That isn’t a Patreon link.”

## How it is stored
`links` row: label "Patreon", url = `https://patreon.com/<page name>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `patreon` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#000000`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/connect-methods.ts` — SPECS.patreon: noun/hosts/rule/before-after/url builder; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `patreon.com/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Page name".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('patreon')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — the cross-platform CRITICAL loop covers Patreon's handle rule and URL shape.
- No test names Patreon specifically beyond that loop.

## Known gaps
None known.
