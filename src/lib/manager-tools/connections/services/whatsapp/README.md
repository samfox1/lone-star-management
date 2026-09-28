# WhatsApp
One line: connecting it gives the artist's site a WhatsApp button that links to their channel.

## Connection type
Link only. WhatsApp has no public handle — a Channel's shareable link carries an opaque id (`social.method = { kind: 'link' }`, same shape as Spotify/Tidal), so the manager pastes the whole link rather than typing a name (`src/lib/connections.ts`).

## What the manager enters
The manager pastes the WhatsApp **Channel** link, e.g. `https://whatsapp.com/channel/0029VaEGKpe4yltUDIsrLt3G`. There is no handle field — the id is an opaque string WhatsApp generates when the channel is created, not something the manager chooses or types.

Errors, following the pattern in `src/lib/connections.ts` (`profileLink` / `connectInputError`) for a link-kind connection:
- Empty field: "Paste the WhatsApp link."
- Just the bare site address, nothing after: "Add the rest of the link — that's just the site's address."
- A link to a different known platform: "That's a TikTok link, not WhatsApp." (the wrong platform's name fills in)

**Deliberately not accepted: a `wa.me/<phone number>` click-to-chat link.** That link format puts the artist's phone number in plain text in the URL. WhatsApp's own Help Center pages describe click-to-chat as a business messaging feature, not a profile/channel link, and `wa.me` links have been indexed by Google, exposing the numbers in them (see Integration (research) below for the reporting). A Channel link (`whatsapp.com/channel/<id>`) carries no phone number at all, so it's the only WhatsApp link this connection should accept — `wa.me` is intentionally left out of the bridge's hosts, and the method's `path` takes only `/channel/<id>`.

Enforced since 2026-09-28 (`index.ts` here: `path` + `pathNoun`; `profileLink` in `src/lib/connections.ts`). Refused with "That isn't a WhatsApp channel link.": `wa.me/<phone>`, `api.whatsapp.com/send?phone=…`, a `chat.whatsapp.com` group invite (it lets any visitor into a private group), any other whatsapp.com path, and digits alone after `/channel/` (a channel id always has letters; digits alone would be a number). A channel link saves without its query or fragment, so nothing rides along after the id. The same rule holds when the link is changed later (the edit window, the editor: `updateContentAction`) and on the add door.

## How it is stored
`links` row: label "WhatsApp", url = the channel link as pasted, on_site false until added as a button in the editor, role null. No `artists` column — there is no id extraction (`idFromUrl` is left unset here), matching Tidal's precedent: a source would need an `INTEGRATION_REGISTRY` entry and an `artists` column before an id would have anywhere to go.

## On the site

Bridge slug `whatsapp` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://whatsapp.com/channel/'`; no `wa.me` alias, on purpose: a wa.me link is a phone number.

Mark: `social-icons.ts`, from simple-icons (CC0, `whatsapp`, brand colour `#25D366`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map
- `src/lib/manager-tools/connections/services/whatsapp/index.ts` — this service's own code: `social`: `{ kind: 'link', path, pathNoun: 'channel' }`, the one path its link may have.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above.
- `src/lib/connections.ts` — `idFromProfileUrl` answers null (WhatsApp has no `idFromUrl`); `profileLink` takes only a link `platformFromUrl` reads as WhatsApp, with the channel path, saved without its query; `checkedLinkUrl` applies the same rule for the doors that change a link row.
- `src/app/artists/[id]/(dashboard)/actions.ts` — `updateContentAction` / `addContentAction` refuse the same links (`checkedLinkUrl`).
- `.../connections/actions.ts` — `connectOneAction` (the profile-link-only path), `disconnectConnectionAction`.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `whatsapp` slug, `urlHint`, and icon.

## Tests

Specific to WhatsApp:
- `tests/unit/manager-tools/connections/connections.test.ts` — "WhatsApp takes a channel link only — never a link that carries a phone number" (`wa.me`, `api.whatsapp.com/send?phone=`, `chat.whatsapp.com`, digits after `/channel/`; a channel saves without its query).
- `tests/unit/manager-tools/connections/link-update-guard.test.ts` — the same refusal when the link is CHANGED later (the edit window, the editor) and on the add door.
- `tests/unit/site-editor/social-hosts.test.ts` — "wa.me is NOT WhatsApp".

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "so do the 2026-09-28 platforms with no handle" (a link-kind method).
- `tests/unit/manager-tools/connections/connections.test.ts` — "a link-kind connection takes only ITS platform’s link": its own link is accepted as pasted; a personal site and an Instagram link are refused, by name.
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Integration (research)
Docs read: [WhatsApp Help Center — About WhatsApp Channels](https://faq.whatsapp.com/549900560675125), [How to create a WhatsApp Channel](https://faq.whatsapp.com/794229125227200/?cms_platform=web), [How to share your channel](https://faq.whatsapp.com/2490388581320854/?cms_platform=web) (confirm channels have a shareable link and QR code; exact link grammar wasn't spelled out on the page text I could read, so the shape above is taken from an observed live example: `https://www.whatsapp.com/channel/0029VaEGKpe4yltUDIsrLt3G`); on the phone-number privacy issue: reporting on the Google-indexing exposure (e.g. Android Central, "Don't want your phone number exposed on Google? Don't use this WhatsApp feature", and Tom's Guide's coverage of the same incident).

No API/OAuth connect flow: WhatsApp's developer platform is the Business Platform (Cloud API) for sending/receiving business messages, not for reading a Channel's public post history — there is nothing today for a "pull channel posts" sync to build on. Verdict: link only, no sync possible without a business-messaging integration far outside this feature's scope.

## Known gaps
- (Fixed 2026-09-28.) A link-kind connection used to accept any url that was not another platform's, so a `wa.me/<phone>` link got in. See What the manager enters.
- No sync: connecting WhatsApp only saves the channel link, nothing is pulled anywhere.
