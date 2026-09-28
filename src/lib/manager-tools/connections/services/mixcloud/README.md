# Mixcloud
One line: connecting it gives the artist's site a Mixcloud button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The handle alone (e.g. "the Mixcloud handle"), shown between its address in grey (`mixcloud.com/` [handle]). Accepted: the handle with or without @, or a pasted profile link from mixcloud.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, underscores and hyphens, 1-60 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9_-]{1,60}$/`. Not documented as a formal spec by Mixcloud — their own Usernames FAQ only recommends avoiding "uncommon characters and symbols" (naming `_` and `@` specifically) because they hurt in-site search, which implies they are accepted, just discouraged. The length ceiling here is a guess generous enough not to reject a real handle; Mixcloud does not publish one.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Mixcloud handle."
- Doesn't match the rule: "That doesn't look like a Mixcloud handle."
- A link from a different known platform: "That's an Instagram link, not Mixcloud."
- A link from an unknown host: "That isn't a Mixcloud link."

## How it is stored
`links` row: label "Mixcloud", url = `https://mixcloud.com/<handle>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `mixcloud` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://mixcloud.com/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `mixcloud`, brand colour `#5000FF`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/mixcloud/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `mixcloud.com/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Handle".
- `.../connections/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('mixcloud')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests

Specific to Mixcloud:
- None: nothing here is Mixcloud-only. The shared suites below cover it by looping over every platform.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps
- No cited character/length rule from Mixcloud — the regex here is a generous guess, not a spec.

## Integration (research)
Docs read:
- [Mixcloud API Documentation](https://www.mixcloud.com/developers/) (fetched directly).
- [FAQ: Usernames — Mixcloud Help Center](https://help.mixcloud.com/hc/en-us/articles/10054754875932-FAQ-Usernames) (403'd direct fetch; read via search snippets).

API/connect flow: Mixcloud has a genuinely open **read-only REST API**, no key or OAuth needed — the docs say plainly "None to read; OAuth 2.0 to write." Any site URL maps straight to a JSON endpoint by swapping the domain: `mixcloud.com/<username>/` → `api.mixcloud.com/<username>/` for the profile, and `api.mixcloud.com/<username>/cloudcasts/` for their uploaded mixes (each with title, cover, play count, embed key). This is the easiest of the six to sync if Sam ever wants a "latest mixes" feed: no app registration, no credentials, no rate-limit application — just a fetch. OAuth 2.0 (browser-based) is only needed to write (upload, follow), which is out of scope here.
