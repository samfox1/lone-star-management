# Snapchat
One line: connecting it gives the artist's site a Snapchat button that opens their public profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The username alone (e.g. "the Snapchat username"), shown between its address in grey (`snapchat.com/add/` [username]). Accepted: the username with or without @, or a pasted profile link from snapchat.com — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: starts with a letter, ends with a letter or number, letters/numbers/hyphen/underscore/period in between, 3-15 characters total. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z][A-Za-z0-9_.-]{1,13}[A-Za-z0-9]$/` — cited from [Snapchat Support: How do I change my Snapchat username?](https://support.snapchat.com/en-US/a/change-username) (character set and start/end rule); the 3-15 length is not stated on that page — observed from real usernames and secondary sources, so treat the length bound as a reasonable default rather than an official limit.

The profile link always has the shape `snapchat.com/add/<username>` — the `add` segment is never the username itself, handled by `fromPath` in `index.ts` here (without it, a pasted link would wrongly read "add" as the handle).

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Snapchat username."
- Doesn't match the rule: "That doesn't look like a Snapchat username."
- A link from a different known platform: "That's a TikTok link, not Snapchat."
- A link from an unknown host: "That isn't a Snapchat link."

## How it is stored
`links` row: label "Snapchat", url = `https://snapchat.com/add/<username>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `snapchat` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://snapchat.com/add/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `snapchat`, brand colour `#FFFC00`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/snapchat/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder, `fromPath` for the `/add/` prefix).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `snapchat.com/add/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Username".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('snapchat')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests

Specific to Snapchat:
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "Bluesky, Snapchat, Resident Advisor: the name sits after a fixed path".

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Integration (research)
Docs read: [Snapchat Support — change username](https://support.snapchat.com/en-US/a/change-username) (character rules, must start with a letter, must end in a letter or number, cannot be/contain a phone number); [Snap for Developers — How to Link to Your Public Snapchat Profile](https://developers.snap.com/api/snapchat-for-web/social-plugins/how-to-backlink-for-developers) (confirms the official backlink format is `https://www.snapchat.com/add/{username}`).

No public content API: Snapchat's developer platform (Snap Kit, Marketing API, Ads API) is aimed at login, sharing snaps into the app, and ad campaigns — there is no endpoint for reading a public profile's posts the way YouTube or Spotify expose a catalog. Verdict: link only, no sync possible with a public/documented API.

## Known gaps
- The 3-15 length bound is not confirmed on Snapchat's own support page — only the character set and start/end rule are official. If Snapchat's real limit differs, a valid username could be wrongly rejected or an invalid one accepted.
