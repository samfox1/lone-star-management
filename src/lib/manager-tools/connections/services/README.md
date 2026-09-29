# Connections — one file per service

Every outside platform an artist can hook up is a **connection** (Sam, 2026-09-13). This
folder documents each one on its own (Sam, 2026-09-28: "each service to have its own
documentation on how it is implemented and integrated"). Every README uses the same
headings: connection type, what the manager enters, how it is stored, sync, on the site,
code map, tests, known gaps.

## The four kinds

| Kind | What the manager enters | What happens |
| --- | --- | --- |
| **Link only** | The handle alone (`x.com/` [skeenmusic]), or a pasted profile link; for a platform with no handle (Tidal, WhatsApp, Eventbrite), its link | A `links` row the site can show as a button. Nothing is pulled. |
| **Link + sync** | The artist link (or handle, for YouTube), with **Sync** on | The same `links` row, plus the id inside it pulls the catalog into the dashboard. Sync off = link only. |
| **Service** | The service's own fields (an id, a name, a folder link, a store domain + token) | Feeds the dashboard (tour dates, files, merch). Never a social button on a site. |
| **Identity** | The artist's page on a music fact database (MusicBrainz, Discogs), or its id (Wikidata `Q1299`) | A `links` row that feeds the site's fact card (`sameAs`) and is never a site button: the bridge marks the platform `identityOnly`, and the editor's Add button refuses it. MusicBrainz's Connect row can also create the page, pre-filled. |

A pasted link must be one the site reads as THAT platform (the bridge's `platformFromUrl`,
2026-09-28): a handle platform reads it back to its handle, and a link platform (Tidal,
WhatsApp…) refuses anything else by name, on Connect and whenever the link is changed later.
WhatsApp takes only a channel link, never a link that carries a phone number.

A new connection starts **off the site**. A site button is added in the site editor's
**Socials → Add button**, which picks from the artist's connections (Sam, 2026-09-28).

## Every service

| Service | Kind | Feeds | Doc |
| --- | --- | --- | --- |
| Amazon Music | Link only (artist link) | — | [amazon-music](amazon-music/README.md) |
| Apple Music | Link + sync | Music | [apple-music](apple-music/README.md) |
| Audiomack | Link only | — | [audiomack](audiomack/README.md) |
| Bandcamp | Link only | — | [bandcamp](bandcamp/README.md) |
| Bandsintown | Service | Tour dates | [bandsintown](bandsintown/README.md) |
| Beatport | Link only (artist link) | — | [beatport](beatport/README.md) |
| Bluesky | Link only | — | [bluesky](bluesky/README.md) |
| Cash App | Link only (tip page) | — | [cash-app](cash-app/README.md) |
| Deezer | Link + sync | Music | [deezer](deezer/README.md) |
| Discogs | Identity (artist link) | Fact card | [discogs](discogs/README.md) |
| Discord | Link only (invite) | — | [discord](discord/README.md) |
| Eventbrite | Link only (organizer link) | — | [eventbrite](eventbrite/README.md) |
| Facebook | Link only | — | [facebook](facebook/README.md) |
| Google Drive | Service | Files | [google-drive](google-drive/README.md) |
| Instagram | Link only | — | [instagram](instagram/README.md) |
| Ko-fi | Link only (tip page) | — | [ko-fi](ko-fi/README.md) |
| Mixcloud | Link only | — | [mixcloud](mixcloud/README.md) |
| MusicBrainz | Identity (artist link) | Fact card | [musicbrainz](musicbrainz/README.md) |
| Pandora | Link only (artist link) | — | [pandora](pandora/README.md) |
| Patreon | Link only | — | [patreon](patreon/README.md) |
| PayPal | Link only (tip page) | — | [paypal](paypal/README.md) |
| Resident Advisor | Link only | — | [resident-advisor](resident-advisor/README.md) |
| Shopify | Service | Merch | [shopify](shopify/README.md) |
| Snapchat | Link only | — | [snapchat](snapchat/README.md) |
| Songkick | Link only (artist link) | — | [songkick](songkick/README.md) |
| SoundCloud | Link only | — | [soundcloud](soundcloud/README.md) |
| Spotify | Link + sync | Music | [spotify](spotify/README.md) |
| Substack | Link only | — | [substack](substack/README.md) |
| Telegram | Link only | — | [telegram](telegram/README.md) |
| Threads | Link only | — | [threads](threads/README.md) |
| Ticketmaster | Service | Tour dates | [ticketmaster](ticketmaster/README.md) |
| Tidal | Link only (artist link) | — | [tidal](tidal/README.md) |
| TikTok | Link only | — | [tiktok](tiktok/README.md) |
| Twitch | Link only | — | [twitch](twitch/README.md) |
| Venmo | Link only (tip page) | — | [venmo](venmo/README.md) |
| Vimeo | Link only | — | [vimeo](vimeo/README.md) |
| WhatsApp | Link only (channel link) | — | [whatsapp](whatsapp/README.md) |
| Wikidata | Identity (item id) | Fact card | [wikidata](wikidata/README.md) |
| X | Link only | — | [x](x/README.md) |
| YouTube | Link + sync | Videos | [youtube](youtube/README.md) |
| YouTube Music | Link only (artist link) | — | [youtube-music](youtube-music/README.md) |

## Where the code is

Each folder holds a README and an `index.ts`: that service's own code, and only that
(`service.ts` says what a file may hold). `index.ts` here lists all of them.

- `<slug>/index.ts` — one `Service`: `social` (bridge slug, how it is entered, the id inside
  its link), `source` (its sync-registry entry), `service` (a whole def, for Shopify).
- `src/lib/connect-methods.ts` — assembles `CONNECT_METHODS`; `parseHandle` and
  `handleFromUrl`, shared by every handle platform.
- `src/lib/connections.ts` — assembles `CONNECTIONS` (bridge `SOCIAL_PLATFORMS` + the
  registry + Shopify), `idFromProfileUrl`, input checks, the page's rows.
- `src/lib/integrations-registry.ts` — assembles `INTEGRATION_REGISTRY` in
  `INTEGRATION_KEYS` order; how a pull is proven.
- `src/lib/service-icons.ts` — the services' brand marks (generated, simple-icons CC0);
  the socials' marks are the bridge's `social-icons`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/` — the page, the Connect
  window, the edit window, and `actions.ts` (connect, sync, pull, remove).

## Adding a service

1. Make its folder: `<slug>/index.ts` exporting one `Service`, and add it to `index.ts`
   here. `services.test.ts` fails until every folder is listed.
2. A social: also add it to the bridge's `SOCIAL_PLATFORMS` (and its icon via
   `npm run social-icons`). The tests fail until the bridge and the file agree. A platform on
   one subdomain of a bigger site (music.youtube.com) is `subdomainOnly`; its other domains
   and country sites go in `aliasHosts`, listed one by one (never "any TLD"), and a country
   domain under a new multi-part suffix needs that suffix in the bridge's
   `MULTI_PART_SUFFIXES` (`tests/unit/site-editor/social-hosts.test.ts` says so). No
   simple-icons mark: a `PLACEHOLDER_MARKS` entry in `scripts/generate-social-icons.ts`
   until the brand's own logo is chosen. A platform that must never be a site button (a
   fact database) is `identityOnly` there; `identity-only.test.ts` lists which ones are.
3. A syncable source: add its key to `INTEGRATION_KEYS` (the order the registry takes) and
   its pull action in the dashboard's `integrations.ts`.
4. A service: its connect path in `connections/actions.ts` and its mark via
   `npm run service-icons`.
5. Write its README with the same headings as the others, and its line in the table above.
