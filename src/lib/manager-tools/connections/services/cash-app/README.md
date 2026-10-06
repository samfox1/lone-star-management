# Cash App
One line: connecting it gives the artist's site a Cash App button that links to their public $cashtag page. This is a link only — we never touch payment info, credentials, or account numbers.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The cashtag alone (e.g. "the Cash App handle"), shown between its address in grey (`cash.app/$` [handle]). Accepted: the cashtag with or without its leading `$`, or a pasted profile link from cash.app — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: at least one letter, letters and numbers only, 1-20 characters (Cash App's own published rule — no dashes, underscores or spaces). Regex (`social.method.rule` in `index.ts` here): `/^(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,20}$/`

**The `$` belongs to the address, not the handle.** The field shows `cash.app/$` in grey, and `parseHandle` (`src/lib/connect-methods.ts`) drops a typed or pasted leading `$` for any address that ends in `$` (only Cash App's does), the way it drops a leading `@` everywhere. So `skeenmusic`, `$skeenmusic`, and a pasted `cash.app/$skeenmusic` link all read as `skeenmusic` and save as `https://cash.app/$skeenmusic`. (Round 1 did this with a `$?` in the rule and a `fromPath`; a typed `$skeenmusic` then kept its `$`, and the field read `cash.app/$$skeenmusic`. Changed 2026-09-28.) An amount never rides along: the link is rebuilt from the cashtag alone, so `cash.app/$name/25` or `?amount=` saves as `cash.app/$name`.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Cash App handle."
- Doesn't match the rule: "That doesn't look like a Cash App handle."
- A link from a different known platform: "That's a Venmo link, not Cash App."
- A link from an unknown host: "That isn't a Cash App link."

## How it is stored
`links` row: label "Cash App", url = `https://cash.app/$<cashtag>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `cash app` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://cash.app/$'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `cashapp`, brand colour `#00C244`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/cash-app/index.ts` — this service's own code: `social`: the handle spec (`before: 'cash.app/$'`).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways, and `parseHandle` drops the `$`.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `cash.app/$` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Handle".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('cash app')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Integration (research)
Docs read: [Cash App $Cashtag requirements (UK help)](https://cash.app/help/gb/en-gb/5504-cashtag-requirements), [$Cashtags (US help)](https://cash.app/help/gb/en-us/6489-cashtags) — "must include at least 1 letter and be no longer than 20 characters," and unavailable if it "contains symbols, dashes, or spaces." The exact allowed character set (letters + numbers only, no underscore) is inferred from that "no symbols/dashes/spaces" wording, not spelled out as an explicit charset — flagged as a soft inference, not a direct quote.

No public API or OAuth connect flow for an individual's Cash App page was found — Cash App's developer surface (Cash App Pay) is a merchant checkout integration, not a way to read a person's public profile or transaction history.

**Verdict:** no sync possible or worth building. This stays link-only indefinitely.

## Tests

Specific to Cash App:
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "Cash App — the $ is part of the address, typed or pasted, and an amount never rides along".

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps
- The exact allowed-character rule is inferred, not quoted verbatim from Cash App's docs (see Integration above).
