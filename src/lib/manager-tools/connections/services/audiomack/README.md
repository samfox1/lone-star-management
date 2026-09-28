# Audiomack
One line: connecting it gives the artist's site an Audiomack button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The handle alone (e.g. "the Audiomack handle"), shown between its address in grey (`audiomack.com/` [handle]). Accepted: the handle with or without @, or a pasted profile link from audiomack.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, underscores and hyphens, 1-30 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9_-]{1,30}$/`. Not officially documented by Audiomack — inferred from real profile URLs (e.g. `audiomack.com/gunna`, and `glen-scott` in Audiomack's own API docs), which show lowercase letters, numbers and hyphens; underscores are assumed allowed by the same convention as the other handle platforms here and have not been individually confirmed.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Audiomack handle."
- Doesn't match the rule: "That doesn't look like an Audiomack handle."
- A link from a different known platform: "That's an Instagram link, not Audiomack."
- A link from an unknown host: "That isn't an Audiomack link."

## How it is stored
`links` row: label "Audiomack", url = `https://audiomack.com/<handle>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `audiomack` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://audiomack.com/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `audiomack`, brand colour `#FFA200`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/audiomack/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `audiomack.com/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Handle".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('audiomack')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests

Specific to Audiomack:
- None: nothing here is Audiomack-only. The shared suites below cover it by looping over every platform.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps
- Handle character rules are not documented by Audiomack; the regex here is inferred from observed URLs, not a cited spec.

## Integration (research)
Docs read:
- [How do I update my Artist URL?](https://audiomack.zendesk.com/hc/en-us/articles/360051284491-How-do-I-update-my-Artist-URL) and [claim your Audiomack artist profile](https://audiomack.zendesk.com/hc/en-us/articles/5729713578394-How-do-I-claim-my-Audiomack-artist-profile) (Zendesk pages 403'd direct fetches from here; read via search snippets and a Ditto Music summary of the same pages).
- [How to Claim Your Audiomack Artist Profile — Ditto Music](https://dittomusic.com/en/blog/how-to-claim-your-audiomack-artist-profile).
- [Audiomack Data API docs](https://audiomack.com/data-api/docs) (fetched directly).

API/connect flow: Audiomack publishes a **Data API** (`audiomack.com/data-api/docs`) using **OAuth 1.0a**. It exposes artist/user profile fields (name, bio, genre, location, verification status, social links) and stats (followers, uploads, favorites, playlists), plus the artist's own uploads and playlists once authorized. The docs don't state whether new developer keys are self-serve or gated — nothing here confirms current issuance status, so treat that as unverified rather than assume it's open. A future sync would need: an OAuth 1.0a app registration/handshake (three-legged, unlike Spotify's client-credentials), an `audiomack_artist_id` (or handle) column, and a client in `src/lib/audiomack.ts` mirroring `src/lib/spotify.ts`'s shape. Profile claiming itself (an artist proving ownership) is a manual Instagram-DM process to `@audiomackartist` — not an API — which matters if this ever needs artist-side verification rather than just reading public data.
