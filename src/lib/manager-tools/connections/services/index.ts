/**
 * EVERY SERVICE, one file each (see `service.ts` for what a file holds, README.md for the
 * index of docs). A to Z by folder. The list's order decides nothing: the modules that
 * assemble from it keep their own orders (the bridge's `SOCIAL_PLATFORMS`, `INTEGRATION_KEYS`).
 *
 * A new folder must be added here: tests/unit/manager-tools/connections/services.test.ts
 * fails until every folder is in this list.
 */
import type { Service } from './service'
import { appleMusic } from './apple-music'
import { bandcamp } from './bandcamp'
import { bandsintown } from './bandsintown'
import { deezer } from './deezer'
import { discord } from './discord'
import { facebook } from './facebook'
import { googleDrive } from './google-drive'
import { instagram } from './instagram'
import { patreon } from './patreon'
import { shopify } from './shopify'
import { soundcloud } from './soundcloud'
import { spotify } from './spotify'
import { substack } from './substack'
import { threads } from './threads'
import { ticketmaster } from './ticketmaster'
import { tidal } from './tidal'
import { tiktok } from './tiktok'
import { twitch } from './twitch'
import { x } from './x'
import { youtube } from './youtube'

export type { Service, ConnectSpec } from './service'
export { SHOPIFY_KEY } from './shopify'

export const SERVICES: readonly Service[] = [
  appleMusic,
  bandcamp,
  bandsintown,
  deezer,
  discord,
  facebook,
  googleDrive,
  instagram,
  patreon,
  shopify,
  soundcloud,
  spotify,
  substack,
  threads,
  ticketmaster,
  tidal,
  tiktok,
  twitch,
  x,
  youtube,
]
