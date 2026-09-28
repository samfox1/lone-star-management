# Instagram
One line: connecting it gives the artist's site an Instagram button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The username alone (e.g. "the Instagram username"), shown between its address in grey (`instagram.com/` [username]). Accepted: the username with or without @, or a pasted profile link from instagram.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, periods and underscores, 1-30 characters. Regex (`src/lib/connect-methods.ts`, `SPECS.instagram.rule`): `/^[A-Za-z0-9._]{1,30}$/`

No special link shapes for this platform — a pasted link reduces to its first path segment.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the Instagram username.”
- Doesn't match the rule: “That doesn’t look like an Instagram username.”
- A link from a different known platform: “That’s a TikTok link, not Instagram.”
- A link from an unknown host: “That isn’t an Instagram link.”

## How it is stored
`links` row: label "Instagram", url = `https://instagram.com/<username>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `instagram` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#FF0069`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/connect-methods.ts` — SPECS.instagram: noun/hosts/rule/before-after/url builder; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `instagram.com/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Username".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('instagram')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — the cross-platform CRITICAL loop (every `SOCIAL_PLATFORMS` entry, Instagram included, builds a link the site recognises).
- `tests/unit/manager-tools/connections/connections.test.ts` — Instagram's own errors (blank, bad rule) and the cross-platform message ("That's a TikTok link, not Instagram."), plus `idFromProfileUrl` returning null for it.
- `tests/components/manager-tools/connections/connection-list.test.tsx` — a stored Instagram link's row: its handle, its "Open" link, saving an edited handle.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — Instagram's mark in the Add-button picker, and connecting it from the editor calls `connectOneAction('artist-1', 'instagram', …)`.
- `tests/integration/manager-tools/connections/connect-off-site.test.ts` — the control case: an Instagram link added through the ordinary content door still lands on-site by default, proving Connect's off-site rule is special-cased, not the table's default.

## Known gaps
None known.
