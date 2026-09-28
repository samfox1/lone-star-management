# SoundCloud
One line: connecting it gives the artist's site a SoundCloud button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The username alone (e.g. "the SoundCloud username"), shown between its address in grey (`soundcloud.com/` [username]). Accepted: the username with or without @, or a pasted profile link from soundcloud.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, underscores and hyphens, 2-25 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9_-]{2,25}$/`

No special link shapes for this platform — a pasted link reduces to its first path segment.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the SoundCloud username.”
- Doesn't match the rule: “That doesn’t look like a SoundCloud username.”
- A link from a different known platform: “That’s an Instagram link, not SoundCloud.”
- A link from an unknown host: “That isn’t a SoundCloud link.”

## How it is stored
`links` row: label "SoundCloud", url = `https://soundcloud.com/<username>`, on_site false until added as a button in the editor, role null.

## On the site
Bridge slug `soundcloud` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#FF5500`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/manager-tools/connections/services/soundcloud/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `soundcloud.com/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Username".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('soundcloud')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — the cross-platform CRITICAL loop covers SoundCloud's handle rule and URL shape.
- Every other `soundcloud` hit under tests/ (music, embed-url, analytics) is the unrelated per-song `soundcloud_url` embed field, not this Connections handle.

## Known gaps
None known. (A song can separately carry its own `soundcloud_url` for embedding a track in the Music tool — a different field entirely, not this profile connection.)
