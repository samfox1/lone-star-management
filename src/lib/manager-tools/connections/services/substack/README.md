# Substack
One line: connecting it gives the artist's site a Substack button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The handle alone (e.g. "the Substack handle"), shown between its address in grey (`substack.com/@` [handle]). Accepted: the handle with or without @, or a pasted profile link from substack.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, underscores and hyphens, 1-40 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9_-]{1,40}$/`

Substack accepts EITHER shape (`alsoSubdomain: true` in `index.ts` here): the `@handle` form, or a bare `<name>.substack.com` link. A pasted subdomain link is read back to its name and rebuilt as `https://substack.com/@<name>` — it is not kept as the subdomain.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the Substack handle.”
- Doesn't match the rule: “That doesn’t look like a Substack handle.”
- A link from a different known platform: “That’s a TikTok link, not Substack.”
- A link from an unknown host: “That isn’t a Substack link.”

## How it is stored
`links` row: label "Substack", url = `https://substack.com/@<handle>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `substack` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#FF6719`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/manager-tools/connections/services/substack/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder, `alsoSubdomain: true`).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `substack.com/@` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Handle".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('substack')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — the cross-platform CRITICAL loop covers Substack's `@handle` shape and rule.
- No test exercises the `alsoSubdomain` paste-a-subdomain path specifically — it is unverified behaviour, read straight from the code.

## Known gaps
A pasted `<name>.substack.com` newsletter link is rewritten to the `substack.com/@<name>` profile form. On the real site these are different pages (the newsletter itself vs. the Notes/profile page); only the profile form is what gets stored, whichever the manager pasted.
