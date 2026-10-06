# Venmo
One line: connecting it gives the artist's site a Venmo button that links to their public profile. This is a link only — we never touch payment info, credentials, or account numbers.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The username alone (e.g. "the Venmo username"), shown between its address in grey (`venmo.com/u/` [username]). Accepted: the username with or without @, or a pasted profile link from venmo.com or account.venmo.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, hyphens and underscores, 5-30 characters (Venmo's own published rule). Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9_-]{5,30}$/`

A pasted `venmo.com/u/<username>` or `account.venmo.com/u/<username>` link is read down to its username and rebuilt on `venmo.com/u/`. `account.venmo.com` needs no separate host entry: its registrable domain (the bridge's `registrableDomain`, which `parseHandle` shares) is `venmo.com`, the one host listed. A bare `venmo.com/<username>` link (no `/u/`) is also read correctly — it falls through to the default "first path segment" handling once `fromPath` declines the `/u/`-specific case.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Venmo username."
- Doesn't match the rule: "That doesn't look like a Venmo username."
- A link from a different known platform: "That's a Cash App link, not Venmo."
- A link from an unknown host: "That isn't a Venmo link."

## How it is stored
`links` row: label "Venmo", url = `https://venmo.com/u/<username>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `venmo` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://venmo.com/u/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `venmo`, brand colour `#008CFF`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/venmo/index.ts` — this service's own code: `social`: the handle spec, `fromPath` for the `/u/<username>` path.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways; the shared `registrableDomain` is what folds `account.venmo.com` into `venmo.com`.
- `src/lib/connections.ts` — `profileLink` builds the link from the username, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `venmo.com/u/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the username into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored username afterwards (`KvField` + `saveHandle`), labelled "Username".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('venmo')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Integration (research)
Docs read: [Check or Edit Your Username](https://help.venmo.com/cs/articles/check-or-edit-your-username-vhel208) — quoted rule: "Your Venmo username must be between 5 and 30 characters (no special characters other than - and _)." The `/u/` path shape and the `account.venmo.com` host were confirmed against real Venmo share links, not a single canonical doc page (Venmo's help center does not spell out the URL format itself).

Venmo's public Developer API was closed to new signups years ago (2016 for general signups, with 2021 tightening remaining access further) and what remains is scoped to existing payment-processing partners, not profile reads. There is no way to look up a username's public profile or transaction activity through an API today.

**Verdict:** no sync possible or worth building. This stays link-only indefinitely.

## Tests

Specific to Venmo:
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "Venmo: /u/<name> on either host; a payment request keeps only the name" (`account.venmo.com` folds in).

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps
- The `/u/` path handling and the `account.venmo.com` host were confirmed by inspecting real links, not by a single authoritative Venmo doc page describing the URL scheme.
