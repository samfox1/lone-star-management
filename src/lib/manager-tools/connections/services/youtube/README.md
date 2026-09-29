# YouTube

Connecting YouTube links the artist's channel on the Connections page and, if the manager
leaves Sync on, imports the channel's uploads as draft videos.

## Connection type

Link + sync. YouTube is both a social profile (a `links` row, and optionally a site button)
and a video source (`src/lib/integrations-registry.ts`, section `videos`). One paste can do
both jobs.

## What the manager enters

The minimal input is a handle: `skeenmusic` or `@skeenmusic` (`src/lib/connect-methods.ts`,
`youtube` spec, `noun: 'handle'`). The field also accepts:

- a pasted `youtube.com/@handle` or `youtu.be` link — read back to its handle
- a channel link with no handle in it — `youtube.com/channel/UC…`, `/c/name`, `/user/name` —
  kept as the link itself (`fromPath` in `connect-methods.ts`)
- in the Connect modal's picker, the manager can also just paste any of the above into the
  one field; leaving the field blank keeps Sync's default on

Errors seen, from `parseHandle` (`src/lib/connect-methods.ts`):
- `Enter the YouTube handle.` — blank input
- `That doesn't look like a YouTube handle.` — fails the handle rule (`/^[A-Za-z0-9._-]{3,30}$/`)
- `That's a <Platform> link, not YouTube.` / `That isn't a YouTube link.` — a link from a
  host YouTube's spec doesn't own

`connectInputError` (`src/lib/connections.ts`) runs the same check before a request is made
and again in the server action, so the modal and the door agree.

## Connect with YouTube (Google login)

The easy way in (Sam, 2026-09-28): instead of pasting, the manager presses **Connect with
YouTube** in the YouTube row of the Connect window, picks their Google account, presses
Allow, and we find the channel ourselves. The paste field stays underneath as the fallback.

How it works (`src/lib/youtube-oauth.ts`, routes `src/app/api/youtube/{start,callback}`):

1. **Start** (`/api/youtube/start?artist=<id>`, `&sync=0` when Sync is off) checks the
   signed-in manager owns the artist, sets a short-lived (10 min) HttpOnly state cookie,
   signed with the client secret, that names the artist, the manager, the Sync choice, a
   nonce and a PKCE verifier, and sends the browser to Google asking for
   `youtube.readonly` only (online access, no refresh token, account picker, PKCE S256).
2. **Callback** (`/api/youtube/callback`) checks the cookie, the nonce, the manager and
   ownership before anything else, trades the code for an access token, reads
   `channels?part=snippet&mine=true` once, **revokes the token**, then saves the channel
   through the same door a paste uses (`connectOneAction`: the `links` row + the real
   `UC…` id in `youtube_channel_id` + the first import). Sync, sameAs and the identity
   flag all behave exactly as for a pasted link.
3. The manager lands back on Connections with one line: "YouTube connected.", "No YouTube
   channel on that Google account…", cancelled, or what went wrong (only a CODE travels in
   the URL; the words are chosen on the server).

**What is stored:** only what a paste stores (the profile link, the channel id). The Google
access token is used for one read and then revoked. It is never written to the database, a
cookie or a log. The video sync keeps using the public API key, so nothing needs it later.

**Env vars** (server-only, `.env.local` / Vercel): `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET` (Google Cloud → Google Auth Platform → Clients, a Web
application client). Without both, the button is hidden.

**Redirect URI:** `<origin>/api/youtube/callback`, built from the request's own origin, so
each address just needs registering on the client: `http://localhost:3000/api/youtube/callback`
today, the production one at launch. Only https, or http on `localhost`, is accepted.

**Testing mode:** until Google reviews the app, only test users can sign in (up to 100,
added in Google Auth Platform → Audience → Test users), and Google shows an "unverified
app" warning first. The button's one line under it says that is expected. Google's review
(homepage, privacy policy, then Publish app) comes at launch: see `LAUNCH_CHECKLIST.md`,
section 2.

## How it is stored

- A `links` row: `label: 'YouTube'`, `url` (the handle's profile link, or the channel link as
  pasted), added **off-site** (`addContentAction(..., { offSite: true })` in
  `connections/actions.ts`) — connecting never turns on a site button by itself.
- `artists.youtube_channel_id` — always a real `UC…` id from now on (Sam, 2026-09-28: it used
  to hold whatever shape the connect flow gave it — a raw channel URL, an `@handle`, or the
  id). The shared save door (`saveSourceIdAction`) resolves anything else down to the id via
  `resolveYouTubeChannelId` (`src/lib/youtube.ts`) before writing the column, the same way it
  normalises `drive_folder_id`. `idFromProfileUrl` still returns the YouTube URL itself rather
  than extracting an id — resolution happens once, at the save door, not there — and older
  rows saved before this change may still hold a URL or handle until re-saved (not migrated).
- The site button is **off by default**. A manager turns a connected profile into a button
  from the site editor's Socials picker (`buttonChoices` in `lib/connections.ts`) — editing
  the handle here changes that same button, because it is the same `links` row.

## Sync / integration

API: **YouTube Data API v3** (`https://www.googleapis.com/youtube/v3`), via
`createYouTubeClient` in `src/lib/youtube.ts`. Auth: a `key` query param, from env var
`YOUTUBE_API_KEY`. Missing key throws `YouTube API key not configured (YOUTUBE_API_KEY).`

What it pulls, over the quota-cheap path (not `search.list`, which costs 100 units/call):
1. `channels.list?part=contentDetails` (by id, `forHandle`, or `forUsername`, chosen by
   `channelSelector`) → the channel's uploads playlist id.
2. `playlistItems.list?part=snippet` on that playlist, paginated 50/page, up to `maxPages`
   (default 20).
3. For each video, a HEAD request to `youtube.com/shorts/<id>` (no API quota) — a 200
   response means it's a Short; a redirect means a normal upload. Bounded to 8 in flight,
   5s timeout each; any failure defaults to "not a Short."
4. `videos.list?part=statistics`, batched 50 ids/call, for global view counts.

Where it lands: the `videos` table, via `syncYouTubeVideos` (`src/lib/sync.ts`). Keyed by
`youtube_id`, `source: 'youtube'`. New rows insert `on_site: false`. View counts are cached
as `youtube_views` / `youtube_views_at` when present.

**Quirk found in code:** Shorts are fetched and classified, but then filtered OUT before
syncing (`videos.filter((v) => !v.is_short)`, `lib/sync.ts`) — the comment says "Shorts
aren't used on artist sites right now." The `is_short` column and a Shorts tab still exist
in the dashboard for when that changes.

`provenBy` (`src/lib/integrations-registry.ts`): proven by rows where `videos.source =
'youtube'` exists — a connected channel with zero imported videos reads as "failed," not
"connected."

Limits/quirks: 429s back off using `Retry-After` (shared `httpGetJson`,
`src/lib/http.ts`), up to 3 retries by default. Public channel data only: the Google login
above finds the channel, it is not used to sync.
`pullYouTube` (`actions.ts`) also discards the `SyncResult`'s `failed`/`errors` and always
returns bare `{ ok: true }` — see Known gaps.

How a pull is triggered:
- **Connect** (first time): the Connect modal's Sync toggle ("Import videos"), on by default.
- **Sync**: a connected profile that was never pulled shows a "Sync" action
  (`syncProfileAction`, `connections/actions.ts`) — it re-derives the channel reference from
  the stored link and pulls.
- **Pull now / Retry**: the connection modal's "Pull now" button, or a failed row's Retry
  (`pullConnectionAction` → `syncSectionAction` → `syncYouTubeAction` → `pullYouTube`).

## On the site

YouTube is a `SOCIAL_PLATFORMS` entry (`packages/site-bridge/src/social.ts`, slug
`youtube`). A connected site shows its own YouTube glyph via
`socialIcon('youtube')` (`packages/site-bridge/src/social-icons.ts`) when the manager makes
the profile link a button in the editor. The imported videos themselves show as
embeds (`embed_url: https://www.youtube.com/embed/<id>`) wherever the Videos content is
placed — YouTube has no hosted audio/video of its own on this platform.

## Code map

- `src/lib/manager-tools/connections/services/youtube/index.ts` — this service's own code:
  `social` (the handle spec, `fromPath` for channel/c/user links, `idFromUrl`) and
  `source` (the registry entry).
- `src/lib/youtube.ts` — the API client: `channelSelector`, `getChannelVideos`,
  `viewCounts`, Shorts probing, `resolveChannelId` (channels.list?part=id, on the client),
  and `resolveYouTubeChannelId` (the pure-ish resolver `saveSourceIdAction` calls: a UC id
  or `/channel/UC…` link resolves with no network call by reusing `channelSelector`'s own
  parsing; an `@handle` or legacy `/c/`, `/user/` link resolves through the API).
- `src/lib/youtube-oauth.ts` — Connect with YouTube: state cookie, PKCE, Google's link,
  code exchange, the channel read, revoke, the return words.
- `src/app/api/youtube/start/route.ts`, `src/app/api/youtube/callback/route.ts` — the two
  routes of that flow.
- `src/lib/http.ts` — shared GET-with-429-retry used by the client.
- `src/lib/sync.ts` — `syncYouTubeVideos`: writes the `videos` table, filters out Shorts,
  `on_site: false` on insert.
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS` from the spec above;
  `parseHandle` reads and builds the profile link.
- `src/lib/connections.ts` — `idFromProfileUrl` (dispatches to `idFromUrl` above: the URL
  itself), merges the social + source into one `CONNECTIONS` entry.
- `src/lib/integrations-registry.ts` — assembles the entry above into
  `INTEGRATION_REGISTRY` (in `INTEGRATION_KEYS` order).
- `src/app/artists/[id]/(dashboard)/integrations.ts` — wires `saveYoutubeChannelAction` /
  `syncYouTubeAction` to the registry entry.
- `src/app/artists/[id]/(dashboard)/actions.ts` — `saveYoutubeChannelAction`,
  `pullYouTube`, `syncYouTubeAction`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction`, `syncProfileAction`, `pullConnectionAction` (shared across every
  connection, including YouTube).
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal.tsx`,
  `connection-modal.tsx`, `connection-list.tsx`, `connection-mark.tsx` — the Connections UI.
- `packages/site-bridge/src/social.ts` — the `youtube` `SOCIAL_PLATFORMS` entry (urlHint).
- `packages/site-bridge/src/social-icons.ts` — `socialIcon('youtube')`, the site's own mark.
- `.env.example` — documents `YOUTUBE_API_KEY`.

## Tests

- `tests/unit/sync/youtube.test.ts` — `getChannelVideos` mapping, `channelSelector`
  shapes, Shorts classification via the `/shorts/` probe.
- `tests/unit/sync/youtube-resolve.test.ts` — `resolveYouTubeChannelId`: UC id and
  `/channel/` link resolve with a fetch mock that fails if called; `@handle`, the
  `@handle` link, and legacy `/c/`, `/user/` links resolve via a mocked API; not-found
  and a non-YouTube link each give a plain error.
- `tests/unit/manager-tools/connections/youtube-oauth.test.ts` — state signing, expiry,
  tampering, PKCE, the Google link, code exchange, the channel read, revoke, the input the
  found channel becomes, the return words.
- `tests/unit/manager-tools/connections/youtube-oauth-routes.test.ts` — start and callback:
  every refusal saves nothing and calls Google for nothing; the token is revoked and kept
  nowhere; success saves through `connectOneAction`.
- `tests/components/manager-tools/connections/youtube-connect.test.tsx` — the button, its
  address, hidden without the env, no stranded picks.
- `tests/unit/manager-tools/connections/connections-page-youtube.test.ts` — the page's
  `youtubeApp` flag and return notice.
- `tests/unit/sync/youtube-views.test.ts` — `viewCounts` batching and parsing, skips
  missing/non-numeric counts.
- `tests/integration/sync/sync.youtube.test.ts` — `syncYouTubeVideos` against the real
  database: inserts new, refreshes youtube-owned rows, never clobbers a manual video,
  tenancy (cross-artist writes refused).
- `tests/unit/manager-tools/connections/connect-methods.test.ts` — YouTube handle
  parse/build round trip, a channel-id link kept whole (not reduced to a handle).
- `tests/unit/manager-tools/connections/connections.test.ts` — `idFromProfileUrl` returns
  the URL itself for YouTube, `wantsSync`, connection-row building/sorting, `connectionHandle`
  display for a non-handle channel link.
- `tests/unit/manager-tools/connections/integrations-registry.test.ts` — `provenBy` for
  the `youtube` key (`source = 'youtube'`).
- `tests/unit/sync/sync-section-action.test.ts` — the `videos` section offers exactly
  `['youtube']`.
- `tests/unit/manager-tools/connections/service-icons.test.ts` — indirectly: every
  connection (including YouTube's social mark path) must resolve to a brand icon or fail.

## Known gaps

- Shorts are imported and classified but always filtered out of what gets synced to
  `videos` — there is no manager-facing toggle to bring them in (code comment only, no
  TODO filed).
- The sync reads public data only (the Google login is used once, to find the channel):
  a private or unlisted upload never appears.
- Rows saved before 2026-09-28 may still hold a URL or handle in `youtube_channel_id`
  instead of the real id — not migrated; a re-save (editing the field, or reconnecting)
  resolves it through `resolveYouTubeChannelId` and fixes it going forward.
- A pull that partially fails (some videos error on write) is reported as a full success —
  `pullYouTube` throws away the `SyncResult`'s `failed`/`errors` fields. `lib/sync.ts`'s own
  header warns against exactly this ("a partial failure is not `ok`"); Bandsintown's pull
  action reports it correctly via `syncOutcome`, YouTube's does not.
