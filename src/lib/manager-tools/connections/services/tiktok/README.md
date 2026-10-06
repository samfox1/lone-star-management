# TikTok
One line: connecting it gives the artist's site a TikTok button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The handle alone (e.g. "the TikTok handle"), shown between its address in grey (`tiktok.com/@` [handle]). Accepted: the handle with or without @, or a pasted profile link from tiktok.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, periods and underscores, 2-24 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9._]{2,24}$/`

No special link shapes for this platform — a pasted link reduces to its first path segment.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the TikTok handle.”
- Doesn't match the rule: “That doesn’t look like a TikTok handle.”
- A link from a different known platform: “That’s an Instagram link, not TikTok.”
- A link from an unknown host: “That isn’t a TikTok link.”

## How it is stored
`links` row: label "TikTok", url = `https://tiktok.com/@<handle>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `tiktok` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#000000`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/manager-tools/connections/services/tiktok/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `tiktok.com/@` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Handle".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('tiktok')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — the cross-platform CRITICAL loop covers TikTok's own handle rule and URL shape.
- `tests/unit/manager-tools/connections/connections.test.ts` — TikTok is the `buttonChoices` fixture (an off-site link becomes a pickable button) and appears in a cross-platform wrong-link message.
- `tests/components/manager-tools/connections/connect-modal.test.tsx` — a TikTok link pasted into another platform's field is refused ("That's a TikTok link, not Deezer."), which proves the site recognises TikTok's built shape.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — TikTok is offered and picked in the Add-button picker, turning its own (off-site) link on.

## Known gaps
None known.
