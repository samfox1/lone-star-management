# Bluesky
One line: connecting it gives the artist's site a Bluesky button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The handle alone (e.g. "the Bluesky handle"), shown between its address in grey (`bsky.app/profile/` [handle]). A Bluesky handle IS a domain name, not a short name — the default is `<name>.bsky.social` (Bluesky's free hosted subdomain), but an artist can also verify their own domain (`<name>.com`, or a subdomain of it) as their handle, and that becomes the value entered here too. Accepted: the handle typed as-is (no @ prefix is used on Bluesky, but a stray one is stripped like every other platform), or a pasted `bsky.app/profile/<handle>` link — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: one or more dot-separated segments, each 1-63 characters of letters/digits/hyphens (no leading or trailing hyphen), the last segment starting with a letter — the AT Protocol handle grammar. Regex (`social.method.rule` in `index.ts` here, transcribed from the spec): `/^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/`

Because a handle always contains a dot, a bare typed handle is never mistaken for a link by `parseHandle`'s "looks like a link" check (it only fires on a scheme, a `/`, or the literal text `bsky.app` — a dot alone is not enough, same reasoning as a TikTok handle like `skeen.music`). A pasted profile link always has the shape `bsky.app/profile/<handle>` — the `profile` segment is never the handle itself, handled by `fromPath` in `index.ts` here (without it, a pasted link would wrongly read "profile" as the handle and fail the rule).

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Bluesky handle."
- Doesn't match the rule: "That doesn't look like a Bluesky handle."
- A link from a different known platform: "That's a TikTok link, not Bluesky."
- A link from an unknown host: "That isn't a Bluesky link." (this includes a personal domain typed as a URL, e.g. `https://skeenmusic.com` — the handle form of a custom domain must be typed bare, without `https://`, since that's what fails the "looks like a link" scheme check)

## How it is stored
`links` row: label "Bluesky", url = `https://bsky.app/profile/<handle>`, on_site false until added as a button in the editor, role null.

## On the site

Bridge slug `bluesky` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://bsky.app/profile/'`.

Mark: `social-icons.ts`, from simple-icons (CC0, `bluesky`, brand colour `#1185FE`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/bluesky/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder, `fromPath` for the `/profile/` prefix).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `bsky.app/profile/` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Handle".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('bluesky')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label and icon, shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests

Specific to Bluesky:
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "Bluesky, Snapchat, Resident Advisor: the name sits after a fixed path" (a `*.bsky.social` handle, a custom domain, a bare word refused).

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "every handle builds a link the SITE recognises as that platform" and "every host a handle platform takes is one the SITE reads as that platform".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Integration (research)
Docs read: [AT Protocol — Handle](https://atproto.com/specs/handle) (the handle grammar transcribed above, and that handles are case-insensitive and normalized to lowercase); real custom-domain examples (`bsky.app/profile/bskydemo.xyz`, `bsky.app/profile/dnsmichi.dev`) confirming a verified domain replaces the `.bsky.social` suffix entirely as both the handle and the profile URL.

Bluesky/AT Protocol has a fully public, keyless read API (the AppView, e.g. `public.api.bsky.app`) — profiles and post feeds can be read with no auth at all, unlike most of the platforms here that need an app-level token or OAuth. A future sync (posts, or just a follower count) would need a `src/lib/bluesky.ts` client resolving the handle to a DID (`com.atproto.identity.resolveHandle`) and then reading `app.bsky.feed.getAuthorFeed`, no credentials needed for public data — the lowest-friction sync of any service reviewed here. Verdict: link only for now, but an easy future sync if ever wanted.

## Known gaps
- A manager who pastes a custom domain as a full URL (`https://skeenmusic.com`) rather than the bare handle (`skeenmusic.com`) or the `bsky.app/profile/...` link gets "That isn't a Bluesky link" — there is no way to tell a personal-site link from a verified Bluesky custom-domain handle without an AT Protocol lookup, so the field expects the bare handle or the bsky.app link, same limitation a real domain-handle would have anywhere else in this codebase.
