# Twitch
One line: connecting it gives the artist's site a Twitch button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The username alone (e.g. "the Twitch username"), shown between its address in grey (`twitch.tv/` [username]). Accepted: the username with or without @, or a pasted profile link from twitch.tv — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers and underscores, 4-25 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9_]{4,25}$/`

No special link shapes for this platform — a pasted link reduces to its first path segment.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the Twitch username.”
- Doesn't match the rule: “That doesn’t look like a Twitch username.”
- A link from a different known platform: “That’s a TikTok link, not Twitch.”
- A link from an unknown host: “That isn’t a Twitch link.”

## How it is stored
`links` row: label "Twitch", url = `https://twitch.tv/<username>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `twitch` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#9146FF`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/manager-tools/connections/services/twitch/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `twitch.tv/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Username".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('twitch')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — the cross-platform CRITICAL loop covers Twitch's handle rule and URL shape.
- No test names Twitch specifically beyond that loop.

## Known gaps
None known.
