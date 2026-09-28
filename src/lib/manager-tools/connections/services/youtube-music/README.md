# YouTube Music

Connecting YouTube Music links the artist's YouTube Music profile on the site. It does not
pull anything into the dashboard — that job already belongs to the separate YouTube
connection (`services/youtube`), which imports uploaded videos from the same underlying
channel.

## Connection type

Link only. YouTube Music is a social platform with a `link`-kind connect method
(`src/lib/manager-tools/connections/services/youtube-music/index.ts`: `{ kind: 'link' }`), and
no entry in `src/lib/integrations-registry.ts` — nothing to sync.
This is deliberately separate from `services/youtube`: same underlying channel id, but a
different public URL and a different button on the site.

## What the manager enters

The manager pastes their YouTube Music artist link
(`https://music.youtube.com/channel/<channelId>`). There is no handle field: YouTube Music's
own site has no `@handle`-style artist URL — its share link is always channel-id based (the
manager gets it from the artist page's three-dot menu → Share → Copy, per YouTube Music's
help flow), not a memorable name — so the field takes the whole link rather than a typed
handle.

Errors, matching the pattern used by every other link-kind connection in `src/lib/connections.ts`
(`profileLink` / `connectInputError`):
- Empty field: "Paste the YouTube Music link."
- Just the bare site address (`https://music.youtube.com/channel/`, nothing after): "Add the
  rest of the link — that's just the site's address."
- A link to a different known platform: "That's a TikTok link, not YouTube Music." (the wrong
  platform's name fills in). A plain YouTube link reads as YouTube, so it gets "That's a
  YouTube link, not YouTube Music."
- A link no platform owns (a personal site, a `javascript:` string): "That isn't a YouTube Music link." A link-kind connection takes only a link the site reads as YouTube Music (`platformFromUrl`), made https (2026-09-28).

No Sync checkbox appears in the Connect modal for YouTube Music: `SyncSwitch`
(`connect-modal.tsx`) only renders when the connection def has both a social and a source, and
YouTube Music has neither a source nor an id-extraction function here.

## How it is stored

A `links` row only: `label: 'YouTube Music'`, `url` = the artist link as pasted, `on_site:
false` by default (off the site until the manager makes it a button in the site editor's
Socials panel). This is independent of `artists.youtube_channel_id`, which the separate
YouTube connection owns.

## Sync / integration

None implemented. See "Integration (research)" below.

## On the site

Bridge slug `youtube music` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://music.youtube.com/channel/'`; `subdomainOnly`: only music.youtube.com is YouTube Music, and it wins over YouTube there.

Mark: `social-icons.ts`, from simple-icons (CC0, `youtubemusic`, brand colour `#FF0000`); the dashboard draws it monochrome. A site renders the profile link as a button once the manager turns it on in the site editor's Socials panel; a site with no glyph for the slug still renders it as a plain labelled link.

## Code map

- `src/lib/manager-tools/connections/services/youtube-music/index.ts` — this service's own
  code: `social`: `{ kind: 'link' }`, the only YouTube-Music-specific line of connection logic.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the method above.
- `src/lib/connections.ts` — `idFromProfileUrl` answers null (no `idFromUrl` here — YouTube's
  own service already owns `youtube_channel_id` resolution; duplicating it here would just
  create a second source of truth for the same id); `CONNECTIONS` includes YouTube Music as a
  plain social with no `source`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction` (the profile-link-only path), `disconnectConnectionAction`.
- `packages/site-bridge/src/social.ts`, `social-icons.ts` — the `youtube music` slug,
  `urlHint`, and icon.
- `src/lib/manager-tools/connections/services/youtube/index.ts` — the separate, pre-existing
  YouTube connection (handle-based, link + sync) that already reads this same channel.

## Tests

Specific to YouTube Music:
- `tests/unit/site-editor/social-hosts.test.ts` — "music.youtube.com is YouTube Music; every other YouTube host stays YouTube", and the look-alikes (`music.youtube.com.evil.com`, `musicyoutube.com`) are nobody.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "YouTube: a music.youtube.com link is YouTube Music’s, not a YouTube channel".
- `tests/unit/manager-tools/connections/connections.test.ts` — "the host rules decide": a plain YouTube link is refused here by name.

Shared suites that cover it by looping over the registry (so it joined them by existing):
- `tests/unit/manager-tools/connections/services.test.ts` — the folder is listed in `services/index.ts`, and its connect method and its `CONNECTIONS` def are pinned line by line.
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — "so do the 2026-09-28 platforms with no handle" (a link-kind method).
- `tests/unit/manager-tools/connections/connections.test.ts` — "a link-kind connection takes only ITS platform’s link": its own link is accepted as pasted; a personal site and an Instagram link are refused, by name.
- `tests/unit/manager-tools/connections/connections.test.ts` — "the registry, derived": every social is a connection, once.
- `tests/unit/site-editor/link-vocabulary.test.ts` — "every platform is recognised from a URL built on its own hint".
- `tests/unit/media/social-icons.test.ts` — "every offered platform has a mark", and the committed marks match a fresh generation.
- `tests/components/site-editor/editor-social-buttons.test.tsx` — the editor’s Connect window lists every social by name.

## Known gaps

- No catalog integration: connecting YouTube Music never pulls anything — `services/youtube`
  already owns the channel's uploads.
- (Fixed 2026-09-28.) `music.youtube.com` used to collapse to `youtube.com` and read as
  YouTube. The bridge now marks YouTube Music `subdomainOnly`: its own host wins over YouTube's
  domain, and every other YouTube host (`m.`, `youtu.be`) stays YouTube. A `music.youtube.com`
  link pasted into the YouTube field is refused: "That's a YouTube Music link, not YouTube."

## Integration (research)

Docs read:
- [Finding Your YouTube Music Artist URL — DistroKid Help Center](https://support.distrokid.com/hc/en-us/articles/5532318583187-Finding-Your-YouTube-Music-Artist-URL)
  (403'd direct fetch; read via search snippets).
- [How to Locate Your YouTube Music Artist Page Link — eMastered](https://help.emastered.com/hc/en-us/articles/40187463110285-How-to-Locate-Your-YouTube-Music-Artist-Page-Link)
  and [Finding your YouTube Music artist profile — Feature.fm](https://help.feature.fm/articles/19751822167565-Finding-your-YouTube-Music-artist-profile)
  (read via search snippets), both agreeing on the `music.youtube.com/channel/<id>` shape and
  the three-dot-menu → Share → Copy flow for getting it.
- [Learn about YouTube handles — YouTube Help](https://support.google.com/youtube/answer/11585688)
  (read via search snippet) — confirms `@handle` URLs are a `youtube.com` (not
  `music.youtube.com`) feature.

API/connect flow: no separate YouTube Music API exists — it rides on the same **YouTube Data
API v3** that `src/lib/youtube.ts` already uses for the plain YouTube connection (same
`channels.list` / `playlistItems.list` surface, same `UC…` channel id). A future "sync" here
would add nothing new: it would just be the existing YouTube pull, wearing a second button.
The only reason to keep this a separate connection at all is that the artist may want a
YouTube Music-branded button distinct from the plain-YouTube one on their site, even though
both point at the same channel.
