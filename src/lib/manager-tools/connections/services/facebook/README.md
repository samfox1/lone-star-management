# Facebook
One line: connecting it gives the artist's site a Facebook button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The page name alone (e.g. "the Facebook page name"), shown between its address in grey (`facebook.com/` [page name]). Accepted: the page name with or without @, or a pasted profile link from facebook.com and fb.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers and periods — no underscore — 2-50 characters. Regex (`src/lib/connect-methods.ts`, `SPECS.facebook.rule`): `/^[A-Za-z0-9.]{2,50}$/`

A `facebook.com/profile.php?id=<digits>` link (the `fromPath` case in SPECS.facebook) is kept WHOLE, numeric id and all, instead of being reduced to a page name — a numeric profile has no name to extract.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the Facebook page name.”
- Doesn't match the rule: “That doesn’t look like a Facebook page name.”
- A link from a different known platform: “That’s a TikTok link, not Facebook.”
- A link from an unknown host: “That isn’t a Facebook link.”

## How it is stored
`links` row: label "Facebook", url = `https://facebook.com/<page name>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `facebook` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#0866FF`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/connect-methods.ts` — SPECS.facebook: noun/hosts/rule/before-after/url builder, `fromPath` for the `profile.php?id=` shape; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `facebook.com/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Page name".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('facebook')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — the cross-platform CRITICAL loop builds `https://facebook.com/skeenmusic` and checks the site recognises it; the `profile.php?id=` branch is not separately asserted.

## Known gaps
The `profile.php?id=…` special case has no dedicated unit test — only the cross-platform CRITICAL loop in connect-methods.test.ts touches Facebook at all, and it only exercises the plain `facebook.com/<name>` shape.
