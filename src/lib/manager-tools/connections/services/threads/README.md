# Threads
One line: connecting it gives the artist's site a Threads button that links to their profile.

## Connection type
Link only (no API, nothing is pulled).

## What the manager enters
The handle alone (e.g. "the Threads handle"), shown between its address in grey (`threads.com/@` [handle]). Accepted: the handle with or without @, or a pasted profile link from threads.com or threads.net — share junk (`www.`, tracking params, a trailing slash) stripped.

The rule in plain words: letters, numbers, periods and underscores, 1-30 characters. Regex (`social.method.rule` in `index.ts` here): `/^[A-Za-z0-9._]{1,30}$/`

Threads moved to threads.com (2026-09-28; threads.net now redirects there). A pasted `threads.net` link (also listed in `hosts`, second) is accepted the same way as `threads.com` and rebuilt on `threads.com` — the field's address and the built link always show `.com`, whichever host the manager pasted.

Errors the manager can see, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: “Enter the Threads handle.”
- Doesn't match the rule: “That doesn’t look like a Threads handle.”
- A link from a different known platform: “That’s an Instagram link, not Threads.”
- A link from an unknown host: “That isn’t a Threads link.”

## How it is stored
`links` row: label "Threads", url = `https://threads.com/@<handle>`, on_site false until added as a button in the editor, role null. A link stored before 2026-09-28 may still read `https://threads.net/@<handle>` — existing rows are not rewritten, and both hosts keep working (see On the site).

## On the site
Bridge slug `threads` (`packages/site-bridge/src/social.ts`, `SOCIAL_PLATFORMS`), icon from `social-icons.ts` (simple-icons, CC0; brand colour `#000000`, though the dashboard draws it monochrome). Sites render it from the published `links`. A site must render every bridge platform (skeen gained that on branch feat/all-socials, 2026-09-28; before, it drew only six).

## Code map
- `src/lib/manager-tools/connections/services/threads/index.ts` — this service's own code: `social`: the handle spec (noun/hosts/rule/url builder on threads.com; `threads.net` is a second, alias host).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above; `parseHandle`/`handleFromUrl` do the parsing both ways.
- `src/lib/connections.ts` — `profileLink` builds the link from the handle, `connectInputError` refuses a bad one, `isProfileLink`/`methodOf`/`connectionHandle` read it back.
- `.../connections/connect-modal.tsx` — the handle field: `threads.com/@` shown in grey, paste-tidies-on-paste-and-blur.
- `.../connections/actions.ts` — `connectOneAction` turns the handle into the link and inserts the `links` row off-site (`addContentAction(..., { offSite: true })`).
- `.../connections/connection-modal.tsx` — editing the stored handle afterwards (`KvField` + `saveHandle`), labelled "Handle".
- `.../_ui/connection-mark.tsx` — the dashboard's monochrome mark, from `socialIcon('threads')`.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the bridge's slug, label, icon and `aliasHosts` (so a stored or pasted `threads.net` link is still recognised as Threads by `platformFromUrl`), shared with every connected site.
- `.../editor/panels/link-tools.tsx` (`SocialButtons`) — the site editor's Socials list, where the connection becomes a button.
- `.../editor/add-button-modal.tsx` — "Add button" offers this connection when it has a profile link and isn't on the site yet.

## Tests
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — a typed handle builds a `threads.com` link; a pasted `threads.net` or `threads.com` link both normalise to `threads.com`; also covered by the cross-platform CRITICAL loop.
- Same file — `platformFromUrl` recognises both `threads.net` and `threads.com` as Threads (the alias mechanism in `packages/site-bridge/src/social.ts`).
- No other test names Threads specifically — it otherwise rides the shared Connect/editor UI tests that exercise any handle platform generically.

## Known gaps
None currently known. (Until 2026-09-28 this service built and displayed `threads.net` links; Threads had moved to threads.com, so new links now build on `threads.com`. Links stored before the move were not migrated — they still read `threads.net`, and both hosts keep working via `hosts` here and `aliasHosts` in the bridge.)
