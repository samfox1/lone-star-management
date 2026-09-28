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

- `src/lib/connections.ts` — the list of connections (derived from the bridge's
  `SOCIAL_PLATFORMS` + `integrations-registry.ts` + Shopify), input checks, the page's rows.
- `src/lib/connect-methods.ts` — how each social is entered: handle rules, the address
  shown around the field, reading a pasted link back to its handle.
- `src/lib/integrations-registry.ts` — the syncable sources: id column, section, how a pull
  is proven.
- `src/lib/service-icons.ts` — the services' brand marks (generated, simple-icons CC0);
  the socials' marks are the bridge's `social-icons`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/` — the page, the Connect
  window, the edit window, and `actions.ts` (connect, sync, pull, remove).

## Adding a service

1. A social: add it to the bridge's `SOCIAL_PLATFORMS` (and its icon via
   `npm run social-icons`), then its handle rule in `connect-methods.ts`. The tests fail
   until both exist.
2. A syncable source: an `INTEGRATION_REGISTRY` entry and its pull action in the
   dashboard's `integrations.ts`.
3. A service: its connect path in `connections/actions.ts` and its mark via
   `npm run service-icons`.
4. Write its README here, with the same headings as the others.
