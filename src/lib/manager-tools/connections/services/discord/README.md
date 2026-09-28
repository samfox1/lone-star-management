# Discord
One line: connecting it gives the artist's site a Discord button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The invite code alone (e.g. "the Discord invite code"), shown between its address in grey (`discord.gg/` [invite code]). Accepted: the invite code with or without @, or a pasted profile link from discord.gg and discord.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers and hyphens, 2-32 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9-]{2,32}$/`

A `discord.com/invite/<code>` link (the `fromPath` case in `index.ts` here) is read down to its code and rebuilt on `discord.gg` — both invite-page shapes end up as the same short link.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the Discord invite code.”
- Doesn't match the rule: “That doesn’t look like a Discord invite code.”
- A link from a different known platform: “That’s a TikTok link, not Discord.”
- A link from an unknown host: “That isn’t a Discord link.”

## How it is stored
`links` row: label "Discord", url = `https://discord.gg/<invite code>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `discord` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#5865F2`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/manager-tools/connections/services/discord/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder, `fromPath` for `discord.com/invite/<code>`).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `discord.gg/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Invite code".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('discord')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — explicit case: a bare code, a `discord.gg/<code>` link, and a `https://discord.com/invite/<code>` link all resolve to `{ handle: 'AbC123', url: 'https://discord.gg/AbC123' }`; also covered by the cross-platform loop.

## Known gaps
None known.
