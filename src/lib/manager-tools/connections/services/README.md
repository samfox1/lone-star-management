# Connections — one file per service

Every outside platform an artist can hook up is a **connection** (Sam, 2026-09-13). This
folder documents each one on its own (Sam, 2026-09-28: "each service to have its own
documentation on how it is implemented and integrated"). Every README uses the same
headings: connection type, what the manager enters, how it is stored, sync, on the site,
code map, tests, known gaps.

## The three kinds

| Kind | What the manager enters | What happens |
| --- | --- | --- |
| **Link only** | The handle alone (`x.com/` [skeenmusic]), or a pasted profile link | A `links` row the site can show as a button. Nothing is pulled. |
| **Link + sync** | The artist link (or handle, for YouTube), with **Sync** on | The same `links` row, plus the id inside it pulls the catalog into the dashboard. Sync off = link only. |
| **Service** | The service's own fields (an id, a name, a folder link, a store domain + token) | Feeds the dashboard (tour dates, files, merch). Never a social button on a site. |

A new connection starts **off the site**. A site button is added in the site editor's
**Socials → Add button**, which picks from the artist's connections (Sam, 2026-09-28).

## Every service

| Service | Kind | Feeds | Doc |
| --- | --- | --- | --- |
| Apple Music | Link + sync | Music | [apple-music](apple-music/README.md) |
| Bandcamp | Link only | — | [bandcamp](bandcamp/README.md) |
| Bandsintown | Service | Tour dates | [bandsintown](bandsintown/README.md) |
| Deezer | Link + sync | Music | [deezer](deezer/README.md) |
| Discord | Link only (invite) | — | [discord](discord/README.md) |
| Facebook | Link only | — | [facebook](facebook/README.md) |
| Google Drive | Service | Files | [google-drive](google-drive/README.md) |
| Instagram | Link only | — | [instagram](instagram/README.md) |
| Patreon | Link only | — | [patreon](patreon/README.md) |
| Shopify | Service | Merch | [shopify](shopify/README.md) |
| SoundCloud | Link only | — | [soundcloud](soundcloud/README.md) |
| Spotify | Link + sync | Music | [spotify](spotify/README.md) |
| Substack | Link only | — | [substack](substack/README.md) |
| Threads | Link only | — | [threads](threads/README.md) |
| Ticketmaster | Service | Tour dates | [ticketmaster](ticketmaster/README.md) |
| Tidal | Link only | — | [tidal](tidal/README.md) |
| TikTok | Link only | — | [tiktok](tiktok/README.md) |
| Twitch | Link only | — | [twitch](twitch/README.md) |
| X | Link only | — | [x](x/README.md) |
| YouTube | Link + sync | Videos | [youtube](youtube/README.md) |

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
   `npm run social-icons`). The tests fail until the bridge and the file agree.
3. A syncable source: add its key to `INTEGRATION_KEYS` (the order the registry takes) and
   its pull action in the dashboard's `integrations.ts`.
4. A service: its connect path in `connections/actions.ts` and its mark via
   `npm run service-icons`.
5. Write its README with the same headings as the others, and its line in the table above.
