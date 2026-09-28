# Vimeo
One line: connecting it gives the artist's site a Vimeo button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The username alone (e.g. "the Vimeo username"), shown between its address in grey (`vimeo.com/` [username]). Accepted: the username with or without @, or a pasted profile link from vimeo.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters and numbers only, 1-30 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9]{1,30}$/`

An account with no claimed custom URL shows as `vimeo.com/user12345678` instead of a chosen name — that still reads as a plain username here (it's one path segment, all letters and digits), so no special-case `fromPath` is needed the way YouTube needs one for `/channel/UC…`.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Vimeo username."
- Doesn't match the rule: "That doesn't look like a Vimeo username."
- A link from a different known platform: "That's a TikTok link, not Vimeo."
- A link from an unknown host: "That isn't a Vimeo link."

## How it is stored
`links` row: label "Vimeo", url = `https://vimeo.com/<username>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `vimeo` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://vimeo.com/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `vimeo`, brand colour `#1AB7EA`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/vimeo/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `vimeo.com/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Username".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('vimeo')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests

Specific to Vimeo:
- None: nothing here is Vimeo-only. The shared suites below cover it by looping over every platform.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Integration (research)
Docs read: [Vimeo Help Center — About managing your Vimeo profile page](https://help.vimeo.com/hc/en-us/articles/12425669540113-About-managing-your-Vimeo-profile-page) (custom URL example `vimeo.com/staff`, states "custom URLs can only include letters and numbers"; claiming one requires a paid plan); [Vimeo API Reference](https://developer.vimeo.com/api/reference) (base `https://api.vimeo.com`, OAuth2). Not confirmed: the exact min/max length of a custom URL, and whether older accounts can still hold hyphens/underscores from before this rule — secondary aggregator sites disagree with the official help article on this, so the rule here follows the official page only.

Vimeo has a full public API (`developer.vimeo.com`) with OAuth2 app registration, used elsewhere for uploading and managing video. A future "pull uploads" sync (parallel to YouTube's) would need: an app registered at developer.vimeo.com for a client id/secret, an access token (either a personal token for read-only public data or full OAuth for a connected account), a `vimeo_user_id` (or the URI form `/users/<id>`) column, an `INTEGRATION_REGISTRY` entry, and a `src/lib/vimeo.ts` client mirroring `src/lib/youtube.ts`'s shape (list videos, paginate, no per-video HEAD probing needed since Vimeo's API reports privacy/type directly). Verdict: API exists and is well-documented; no sync built here, this connection is link only for now.

## Known gaps
- No sync: connecting Vimeo only saves the profile link, nothing is pulled into Videos.
