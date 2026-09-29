/**
 * EVERY SERVICE, one file each (see `service.ts` for what a file holds, README.md for the
 * index of docs). A to Z by folder. The list's order decides nothing: the modules that
 * assemble from it keep their own orders (the bridge's `SOCIAL_PLATFORMS`, `INTEGRATION_KEYS`).
 *
 * A new folder must be added here: tests/unit/manager-tools/connections/services.test.ts
 * fails until every folder is in this list.
 */
import type { Service } from './service'
import { amazonMusic } from './amazon-music'
import { appleMusic } from './apple-music'
import { audiomack } from './audiomack'
import { bandcamp } from './bandcamp'
import { bandsintown } from './bandsintown'
import { beatport } from './beatport'
import { bluesky } from './bluesky'
import { cashApp } from './cash-app'
import { deezer } from './deezer'
import { discogs } from './discogs'
import { discord } from './discord'
import { eventbrite } from './eventbrite'
import { facebook } from './facebook'
import { googleDrive } from './google-drive'
import { instagram } from './instagram'
import { koFi } from './ko-fi'
import { mixcloud } from './mixcloud'
import { musicbrainz } from './musicbrainz'
import { pandora } from './pandora'
import { patreon } from './patreon'
import { paypal } from './paypal'
import { residentAdvisor } from './resident-advisor'
import { shopify } from './shopify'
import { snapchat } from './snapchat'
import { songkick } from './songkick'
import { soundcloud } from './soundcloud'
import { spotify } from './spotify'
import { substack } from './substack'
import { telegram } from './telegram'
import { threads } from './threads'
import { ticketmaster } from './ticketmaster'
import { tidal } from './tidal'
import { tiktok } from './tiktok'
import { twitch } from './twitch'
import { venmo } from './venmo'
import { vimeo } from './vimeo'
import { whatsapp } from './whatsapp'
import { wikidata } from './wikidata'
import { x } from './x'
import { youtube } from './youtube'
import { youtubeMusic } from './youtube-music'

export type { Service, ConnectSpec } from './service'
export { SHOPIFY_KEY } from './shopify'

export const SERVICES: readonly Service[] = [
  amazonMusic,
  appleMusic,
  audiomack,
  bandcamp,
  bandsintown,
  beatport,
  bluesky,
  cashApp,
  deezer,
  discogs,
  discord,
  eventbrite,
  facebook,
  googleDrive,
  instagram,
  koFi,
  mixcloud,
  musicbrainz,
  pandora,
  patreon,
  paypal,
  residentAdvisor,
  shopify,
  snapchat,
  songkick,
  soundcloud,
  spotify,
  substack,
  telegram,
  threads,
  ticketmaster,
  tidal,
  tiktok,
  twitch,
  venmo,
  vimeo,
  whatsapp,
  wikidata,
  x,
  youtube,
  youtubeMusic,
]
