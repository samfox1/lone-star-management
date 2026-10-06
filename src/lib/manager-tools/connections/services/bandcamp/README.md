# Bandcamp
One line: connecting it gives the artist's site a Bandcamp button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The name alone (e.g. "the Bandcamp name"), shown between its address in grey ([name] `.bandcamp.com`). Accepted: the name with or without @, or a pasted profile link from bandcamp.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers and hyphens, 1-63 characters (a subdomain label's real length limit). Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9-]{1,63}$/`

Bandcamp is a SUBDOMAIN account (`subdomain: true` in `index.ts` here): the name sits BEFORE the address in the field (`[name]` `.bandcamp.com`), and a pasted `skeen.bandcamp.com/album/x` link reduces straight to the subdomain `skeen`, dropping the album path.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the Bandcamp name.”
- Doesn't match the rule: “That doesn’t look like a Bandcamp name.”
- A link from a different known platform: “That’s a TikTok link, not Bandcamp.”
- A link from an unknown host: “That isn’t a Bandcamp link.”

## How it is stored
`links` row: label "Bandcamp", url = `https://<name>.bandcamp.com`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `bandcamp` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#408294`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/manager-tools/connections/services/bandcamp/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule, `subdomain: true`, the url builder).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `[name]` shown in grey, `.bandcamp.com` after it, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Name".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('bandcamp')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — explicit case: the name goes before the address, and a pasted `https://skeen.bandcamp.com/album/x` reduces to `{ handle: 'skeen', url: 'https://skeen.bandcamp.com' }`.
- `tests/unit/manager-tools/connections/connections.test.ts` — `profileLink(byKey('bandcamp'), { handle: 'skeen' })` → `{ url: 'https://skeen.bandcamp.com' }`.
- `tests/components/manager-tools/connections/connect-modal.test.tsx` — "Bandcamp's name goes BEFORE its address" checks the field's layout; also used as a search-by-name fixture.

## Known gaps
None known.
