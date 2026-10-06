# Telegram
One line: connecting it gives the artist's site a Telegram button that links to their channel or profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The username alone (e.g. "the Telegram username"), shown between its address in grey (`t.me/` [username]). Accepted: the username with or without @, or a pasted link from t.me and telegram.me — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: starts with a letter, then letters, numbers and underscores, 5-32 characters total. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z][A-Za-z0-9_]{4,31}$/`

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Telegram username."
- Doesn't match the rule: "That doesn't look like a Telegram username."
- A link from a different known platform: "That's a TikTok link, not Telegram."
- A link from an unknown host: "That isn't a Telegram link."

## How it is stored
`links` row: label "Telegram", url = `https://t.me/<username>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `telegram` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://t.me/'`; `aliasHosts: ['telegram.me']`.

Mark: `social-icons.ts`, from simple-icons (CC0, `telegram`, brand colour `#26A5E4`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/telegram/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `t.me/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Username".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('telegram')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests

Specific to Telegram:
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "Telegram: t.me or the old telegram.me; a phone-number link is not a username".
- `tests/unit/site-editor/social-hosts.test.ts` — "the platforms’ own other domains": `telegram.me` reads as Telegram.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Integration (research)
Docs read: [Telegram FAQ](https://telegram.org/faq) (username rules: 5-32 characters, a-z/0-9/underscore, must start with a letter, case-insensitive, unique across accounts); observed real profile and channel links on t.me and the older telegram.me domain, which still resolves the same accounts.

No API/OAuth connect flow is used here — Telegram's Bot API is for building bots inside chats, not for reading a channel's public post history the way YouTube's Data API reads uploads, so there is nothing today for a future "pull posts" sync to build on without a bot being added to the channel first (a much bigger, permission-heavy integration). Verdict: link only, no sync planned.

## Known gaps
- Private invite links (`t.me/+<code>` or the older `t.me/joinchat/<code>`) are not accepted — they fail the username rule (no leading letter) and read as "That doesn't look like a Telegram username." Only a public `@username` channel/profile is supported, same tradeoff Discord makes by only accepting its own invite-code shape.
