// One code file per service: the three shared modules assemble from them, and the move changed nothing.
/**
 * ONE FILE PER SERVICE (Sam, 2026-09-28: "I want each service to have its own documentation
 * on how it is implemented and integrated. Maybe they should all have their own file … inside
 * the manager tools"). Each service's pieces — its handle rule, the id inside its link, its
 * sync source, Shopify's def — moved out of three shared modules into
 * `src/lib/manager-tools/connections/services/<slug>/index.ts`, beside its README, and
 * `connect-methods.ts`, `connections.ts` and `integrations-registry.ts` now ASSEMBLE from them.
 *
 * THE MOVE MUST CHANGE NOTHING A CALLER CAN SEE. The BEFORE_* values below were captured
 * from those three modules as they stood before the move (dd3b782), by running this file's
 * own `pin` helpers against them, and are hard-coded on purpose: they are the witness, not a
 * fixture derived from the code under test. A whole collection is compared at once, keys and
 * order included, so a service added or dropped fails here loudly rather than being skipped.
 * When a service changes on purpose, change its line here in the same commit.
 *
 * Functions and RegExps cannot be compared by value, so they are pinned by what they DO: a
 * rule by its source text, a `url` by the link it builds from one handle, a `fromPath` by its
 * answer to a fixed set of links, and `idFromProfileUrl` by every connection's answer to a
 * fixed set of links. The last five FROM_PATH_PROBES and the last ID_PROBE were added after a
 * Stryker run named the branches the first set left unwatched; their answers were computed
 * from `git show dd3b782`'s copies of the two modules, not from the moved code.
 *
 * THE 18 PLATFORMS ADDED 2026-09-28 (youtube music … eventbrite) are new, not moved: their
 * lines below were printed from their service files on the day they were wired and checked
 * by hand against each file. PayPal's `fromPath` answers `{ handle: '' }` to every probe
 * because none is a paypal.me link (it reads only /paypalme/<name> on paypal.com).
 *
 * THE 3 IDENTITY CONNECTIONS (musicbrainz, discogs, wikidata, 2026-09-28) are new too, pinned
 * the same way; identity-only.test.ts pins what each accepts and refuses.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SOCIAL_PLATFORMS } from '@samfox1/site-bridge/social'
import { CONNECT_METHODS, type ConnectMethod } from '@/lib/connect-methods'
import { CONNECTIONS, SHOPIFY_KEY, idFromProfileUrl } from '@/lib/connections'
import { INTEGRATION_KEYS, INTEGRATION_REGISTRY } from '@/lib/integrations-registry'
import { SERVICES } from '@/lib/manager-tools/connections/services'

const FROM_PATH_PROBES = [
  'https://youtube.com/channel/UC123',
  'https://youtube.com/c/Skeen',
  'https://youtube.com/user/skeen',
  'https://youtube.com/@skeen',
  'https://youtube.com/channel',
  'https://facebook.com/profile.php?id=123',
  'https://facebook.com/profile.php?id=abc',
  'https://facebook.com/profile.php',
  'https://facebook.com/skeen',
  'https://discord.com/invite/AbC123',
  'https://discord.gg/invite/AbC123',
  'https://discord.com/invite',
  'https://discord.gg/AbC123',
  'https://facebook.com/skeen?id=123',
  'https://facebook.com/profile.php?id=a1',
  'https://facebook.com/profile.php?id=1a',
  'https://discord.com/channels/AbC123',
  'https://www.discord.com/invite/AbC123',
]

const ID_PROBES = [
  'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR',
  'https://open.spotify.com/intl-de/artist/26Kx?si=x',
  'https://open.spotify.com/playlist/0MLd',
  'https://music.apple.com/no/artist/skeen/1754431714',
  'https://music.apple.com/artist/1754431714',
  'https://music.apple.com/us/album/x/123',
  'https://www.deezer.com/en/artist/5723457',
  'https://deezer.com/artist/5723457',
  'https://youtube.com/@Sskeen',
  'https://youtu.be/abc',
  ' https://open.spotify.com/artist/26K ',
  '   ',
  ' https://youtube.com/@Sskeen ',
]

/** A method as comparable data: every function and RegExp replaced by what it does. */
function pin(m: ConnectMethod) {
  if (m.kind === 'link') return m.path ? { ...m, path: String(m.path) } : m
  const fromPath = m.fromPath
  return {
    ...m,
    rule: String(m.rule),
    url: m.url('h4ndle'),
    fromPath: fromPath
      ? FROM_PATH_PROBES.map((href) => {
          const u = new URL(href)
          return fromPath(u.pathname.split('/').filter(Boolean), u) ?? null
        })
      : null,
  }
}

const NONE = null
const BEFORE_METHOD_KEYS = [
  'instagram', 'tiktok', 'youtube', 'spotify', 'apple music', 'soundcloud', 'bandcamp', 'facebook', 'x', 'threads', 'substack', 'patreon', 'discord', 'twitch', 'deezer', 'tidal',
  // 2026-09-28
  'youtube music', 'amazon music', 'audiomack', 'mixcloud', 'beatport', 'pandora', 'bluesky', 'snapchat', 'whatsapp', 'telegram', 'vimeo', 'songkick', 'ko-fi', 'cash app', 'venmo', 'paypal', 'resident advisor', 'eventbrite',
  // 2026-09-28, identity only
  'musicbrainz', 'discogs', 'wikidata',
]
const NONE18 = Array(18).fill(null)
const BEFORE_METHODS = {
  instagram: { kind: 'handle', label: 'Instagram', noun: 'username', hosts: ['instagram.com'], rule: '/^[A-Za-z0-9._]{1,30}$/', example: 'skeenmusic', before: 'instagram.com/', after: '', url: 'https://instagram.com/h4ndle', fromPath: NONE },
  tiktok: { kind: 'handle', label: 'TikTok', noun: 'handle', hosts: ['tiktok.com'], rule: '/^[A-Za-z0-9._]{2,24}$/', example: 'skeenmusic', before: 'tiktok.com/@', after: '', url: 'https://tiktok.com/@h4ndle', fromPath: NONE },
  youtube: {
    kind: 'handle', label: 'YouTube', noun: 'handle', hosts: ['youtube.com', 'youtu.be'], rule: '/^[A-Za-z0-9._-]{3,30}$/', example: 'skeenmusic', before: 'youtube.com/@', after: '', url: 'https://youtube.com/@h4ndle',
    fromPath: [{ url: 'https://youtube.com/channel/UC123' }, { url: 'https://youtube.com/c/Skeen' }, { url: 'https://youtube.com/user/skeen' }, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  },
  spotify: { kind: 'link', label: 'Spotify' },
  'apple music': { kind: 'link', label: 'Apple Music' },
  soundcloud: { kind: 'handle', label: 'SoundCloud', noun: 'username', hosts: ['soundcloud.com'], rule: '/^[A-Za-z0-9_-]{2,25}$/', example: 'skeenmusic', before: 'soundcloud.com/', after: '', url: 'https://soundcloud.com/h4ndle', fromPath: NONE },
  bandcamp: { kind: 'handle', label: 'Bandcamp', noun: 'name', hosts: ['bandcamp.com'], rule: '/^[A-Za-z0-9-]{1,63}$/', example: 'skeen', before: '', after: '.bandcamp.com', url: 'https://h4ndle.bandcamp.com', subdomain: true, fromPath: NONE },
  facebook: {
    kind: 'handle', label: 'Facebook', noun: 'page name', hosts: ['facebook.com', 'fb.com'], rule: '/^[A-Za-z0-9.]{2,50}$/', example: 'skeenmusic', before: 'facebook.com/', after: '', url: 'https://facebook.com/h4ndle',
    fromPath: [null, null, null, null, null, { url: 'https://facebook.com/profile.php?id=123' }, null, null, null, null, null, null, null, null, null, null, null, null],
  },
  x: { kind: 'handle', label: 'X', noun: 'handle', hosts: ['x.com', 'twitter.com'], rule: '/^[A-Za-z0-9_]{1,15}$/', example: 'skeenmusic', before: 'x.com/', after: '', url: 'https://x.com/h4ndle', fromPath: NONE },
  threads: { kind: 'handle', label: 'Threads', noun: 'handle', hosts: ['threads.com', 'threads.net'], rule: '/^[A-Za-z0-9._]{1,30}$/', example: 'skeenmusic', before: 'threads.com/@', after: '', url: 'https://threads.com/@h4ndle', fromPath: NONE },
  substack: { kind: 'handle', label: 'Substack', noun: 'handle', hosts: ['substack.com'], rule: '/^[A-Za-z0-9_-]{1,40}$/', example: 'skeen', before: 'substack.com/@', after: '', url: 'https://substack.com/@h4ndle', alsoSubdomain: true, fromPath: NONE },
  patreon: { kind: 'handle', label: 'Patreon', noun: 'page name', hosts: ['patreon.com'], rule: '/^[A-Za-z0-9_]{1,64}$/', example: 'skeen', before: 'patreon.com/', after: '', url: 'https://patreon.com/h4ndle', fromPath: NONE },
  discord: {
    kind: 'handle', label: 'Discord', noun: 'invite code', hosts: ['discord.gg', 'discord.com'], rule: '/^[A-Za-z0-9-]{2,32}$/', example: 'AbC123', before: 'discord.gg/', after: '', url: 'https://discord.gg/h4ndle',
    fromPath: [null, null, null, null, null, null, null, null, null, { handle: 'AbC123' }, null, null, null, null, null, null, null, { handle: 'AbC123' }],
  },
  twitch: { kind: 'handle', label: 'Twitch', noun: 'username', hosts: ['twitch.tv'], rule: '/^[A-Za-z0-9_]{4,25}$/', example: 'skeenmusic', before: 'twitch.tv/', after: '', url: 'https://twitch.tv/h4ndle', fromPath: NONE },
  deezer: { kind: 'link', label: 'Deezer' },
  tidal: { kind: 'link', label: 'Tidal' },
  // 2026-09-28
  'youtube music': { kind: 'link', label: 'YouTube Music' },
  'amazon music': { kind: 'link', label: 'Amazon Music' },
  audiomack: { kind: 'handle', label: 'Audiomack', noun: 'handle', hosts: ['audiomack.com'], rule: '/^[A-Za-z0-9_-]{1,30}$/', example: 'skeenmusic', before: 'audiomack.com/', after: '', url: 'https://audiomack.com/h4ndle', fromPath: NONE },
  mixcloud: { kind: 'handle', label: 'Mixcloud', noun: 'handle', hosts: ['mixcloud.com'], rule: '/^[A-Za-z0-9_-]{1,60}$/', example: 'skeenmusic', before: 'mixcloud.com/', after: '', url: 'https://mixcloud.com/h4ndle', fromPath: NONE },
  beatport: { kind: 'link', label: 'Beatport' },
  pandora: { kind: 'link', label: 'Pandora' },
  bluesky: {
    kind: 'handle', label: 'Bluesky', noun: 'handle', hosts: ['bsky.app'], rule: '/^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/', example: 'skeenmusic.bsky.social', before: 'bsky.app/profile/', after: '', url: 'https://bsky.app/profile/h4ndle', fromPath: NONE18,
  },
  snapchat: { kind: 'handle', label: 'Snapchat', noun: 'username', hosts: ['snapchat.com'], rule: '/^[A-Za-z][A-Za-z0-9_.-]{1,13}[A-Za-z0-9]$/', example: 'skeenmusic', before: 'snapchat.com/add/', after: '', url: 'https://snapchat.com/add/h4ndle', fromPath: NONE18 },
  whatsapp: { kind: 'link', label: 'WhatsApp', path: '/^\\/channel\\/(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]+\\/?$/', pathNoun: 'channel' },
  telegram: { kind: 'handle', label: 'Telegram', noun: 'username', hosts: ['t.me', 'telegram.me'], rule: '/^[A-Za-z][A-Za-z0-9_]{4,31}$/', example: 'skeenmusic', before: 't.me/', after: '', url: 'https://t.me/h4ndle', fromPath: NONE },
  vimeo: { kind: 'handle', label: 'Vimeo', noun: 'username', hosts: ['vimeo.com'], rule: '/^[A-Za-z0-9]{1,30}$/', example: 'skeenmusic', before: 'vimeo.com/', after: '', url: 'https://vimeo.com/h4ndle', fromPath: NONE },
  songkick: { kind: 'link', label: 'Songkick' },
  'ko-fi': { kind: 'handle', label: 'Ko-fi', noun: 'page name', hosts: ['ko-fi.com'], rule: '/^[A-Za-z0-9_-]{3,30}$/', example: 'skeenmusic', before: 'ko-fi.com/', after: '', url: 'https://ko-fi.com/h4ndle', fromPath: NONE },
  'cash app': { kind: 'handle', label: 'Cash App', noun: 'handle', hosts: ['cash.app'], rule: '/^(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,20}$/', example: 'skeenmusic', before: 'cash.app/$', after: '', url: 'https://cash.app/$h4ndle', fromPath: NONE },
  venmo: { kind: 'handle', label: 'Venmo', noun: 'username', hosts: ['venmo.com'], rule: '/^[A-Za-z0-9_-]{5,30}$/', example: 'skeenmusic', before: 'venmo.com/u/', after: '', url: 'https://venmo.com/u/h4ndle', fromPath: NONE18 },
  paypal: {
    kind: 'handle', label: 'PayPal', noun: 'page name', hosts: ['paypal.me', 'paypal.com'], rule: '/^[A-Za-z0-9]{1,20}$/', example: 'skeenmusic', before: 'paypal.me/', after: '', url: 'https://paypal.me/h4ndle', fromPath: Array(18).fill({ handle: '' }),
  },
  'resident advisor': { kind: 'handle', label: 'Resident Advisor', noun: 'name', hosts: ['ra.co', 'residentadvisor.net'], rule: '/^[A-Za-z0-9-]{1,50}$/', example: 'skeenmusic', before: 'ra.co/dj/', after: '', url: 'https://ra.co/dj/h4ndle', fromPath: NONE18 },
  eventbrite: { kind: 'link', label: 'Eventbrite' },
  // 2026-09-28, identity only
  musicbrainz: { kind: 'link', label: 'MusicBrainz', path: '/^\\/artist\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\/?$/i', pathNoun: 'artist' },
  discogs: { kind: 'link', label: 'Discogs', path: '/^(?:\\/[a-z]{2}(?:_[A-Z]{2})?)?\\/artist\\/(\\d+)(?:-[^/?#]*)?\\/?$/', pathNoun: 'artist' },
  wikidata: {
    kind: 'handle', label: 'Wikidata', noun: 'ID', hosts: ['wikidata.org'], rule: '/^Q[1-9]\\d*$/', example: 'Q1299', before: 'wikidata.org/wiki/', after: '', url: 'https://www.wikidata.org/wiki/h4ndle', fromPath: NONE18,
  },
}

const BEFORE_CONNECTIONS = [
  { key: 'instagram', label: 'Instagram', kind: 'social', social: 'instagram', urlHint: 'https://instagram.com/' },
  { key: 'tiktok', label: 'TikTok', kind: 'social', social: 'tiktok', urlHint: 'https://tiktok.com/@' },
  { key: 'youtube', label: 'YouTube', kind: 'social', social: 'youtube', urlHint: 'https://youtube.com/@', source: { key: 'youtube', section: 'videos', idField: 'youtube_channel_id', placeholder: 'YouTube @handle, channel ID, or URL' } },
  { key: 'spotify', label: 'Spotify', kind: 'social', social: 'spotify', urlHint: 'https://open.spotify.com/artist/', source: { key: 'spotify', section: 'music', idField: 'spotify_artist_id', placeholder: 'Spotify artist ID' } },
  { key: 'apple music', label: 'Apple Music', kind: 'social', social: 'apple music', urlHint: 'https://music.apple.com/artist/', source: { key: 'apple', section: 'music', idField: 'apple_artist_id', placeholder: 'Apple Music artist ID' } },
  { key: 'soundcloud', label: 'SoundCloud', kind: 'social', social: 'soundcloud', urlHint: 'https://soundcloud.com/' },
  { key: 'bandcamp', label: 'Bandcamp', kind: 'social', social: 'bandcamp', urlHint: 'https://bandcamp.com/' },
  { key: 'facebook', label: 'Facebook', kind: 'social', social: 'facebook', urlHint: 'https://facebook.com/' },
  { key: 'x', label: 'X', kind: 'social', social: 'x', urlHint: 'https://x.com/' },
  { key: 'threads', label: 'Threads', kind: 'social', social: 'threads', urlHint: 'https://threads.com/@' },
  { key: 'substack', label: 'Substack', kind: 'social', social: 'substack', urlHint: 'https://substack.com/@' },
  { key: 'patreon', label: 'Patreon', kind: 'social', social: 'patreon', urlHint: 'https://patreon.com/' },
  { key: 'discord', label: 'Discord', kind: 'social', social: 'discord', urlHint: 'https://discord.gg/' },
  { key: 'twitch', label: 'Twitch', kind: 'social', social: 'twitch', urlHint: 'https://twitch.tv/' },
  { key: 'deezer', label: 'Deezer', kind: 'social', social: 'deezer', urlHint: 'https://deezer.com/artist/', source: { key: 'deezer', section: 'music', idField: 'deezer_artist_id', placeholder: 'Deezer artist ID' } },
  { key: 'tidal', label: 'Tidal', kind: 'social', social: 'tidal', urlHint: 'https://tidal.com/artist/' },
  // 2026-09-28
  { key: 'youtube music', label: 'YouTube Music', kind: 'social', social: 'youtube music', urlHint: 'https://music.youtube.com/channel/' },
  { key: 'amazon music', label: 'Amazon Music', kind: 'social', social: 'amazon music', urlHint: 'https://music.amazon.com/artists/' },
  { key: 'audiomack', label: 'Audiomack', kind: 'social', social: 'audiomack', urlHint: 'https://audiomack.com/' },
  { key: 'mixcloud', label: 'Mixcloud', kind: 'social', social: 'mixcloud', urlHint: 'https://mixcloud.com/' },
  { key: 'beatport', label: 'Beatport', kind: 'social', social: 'beatport', urlHint: 'https://www.beatport.com/artist/' },
  { key: 'pandora', label: 'Pandora', kind: 'social', social: 'pandora', urlHint: 'https://www.pandora.com/artist/' },
  { key: 'bluesky', label: 'Bluesky', kind: 'social', social: 'bluesky', urlHint: 'https://bsky.app/profile/' },
  { key: 'snapchat', label: 'Snapchat', kind: 'social', social: 'snapchat', urlHint: 'https://snapchat.com/add/' },
  { key: 'whatsapp', label: 'WhatsApp', kind: 'social', social: 'whatsapp', urlHint: 'https://whatsapp.com/channel/' },
  { key: 'telegram', label: 'Telegram', kind: 'social', social: 'telegram', urlHint: 'https://t.me/' },
  { key: 'vimeo', label: 'Vimeo', kind: 'social', social: 'vimeo', urlHint: 'https://vimeo.com/' },
  { key: 'songkick', label: 'Songkick', kind: 'social', social: 'songkick', urlHint: 'https://songkick.com/artists/' },
  { key: 'ko-fi', label: 'Ko-fi', kind: 'social', social: 'ko-fi', urlHint: 'https://ko-fi.com/' },
  { key: 'cash app', label: 'Cash App', kind: 'social', social: 'cash app', urlHint: 'https://cash.app/$' },
  { key: 'venmo', label: 'Venmo', kind: 'social', social: 'venmo', urlHint: 'https://venmo.com/u/' },
  { key: 'paypal', label: 'PayPal', kind: 'social', social: 'paypal', urlHint: 'https://paypal.me/' },
  { key: 'resident advisor', label: 'Resident Advisor', kind: 'social', social: 'resident advisor', urlHint: 'https://ra.co/dj/' },
  { key: 'eventbrite', label: 'Eventbrite', kind: 'social', social: 'eventbrite', urlHint: 'https://eventbrite.com/o/' },
  // 2026-09-28, identity only: a connection, never a site button
  { key: 'musicbrainz', label: 'MusicBrainz', kind: 'social', social: 'musicbrainz', urlHint: 'https://musicbrainz.org/artist/', identityOnly: true },
  { key: 'discogs', label: 'Discogs', kind: 'social', social: 'discogs', urlHint: 'https://www.discogs.com/artist/', identityOnly: true },
  { key: 'wikidata', label: 'Wikidata', kind: 'social', social: 'wikidata', urlHint: 'https://www.wikidata.org/wiki/', identityOnly: true },
  { key: 'bandsintown', label: 'Bandsintown', kind: 'service', source: { key: 'bandsintown', section: 'tour', idField: 'bandsintown_name', placeholder: 'Bandsintown artist name' } },
  { key: 'ticketmaster', label: 'Ticketmaster', kind: 'service', source: { key: 'ticketmaster', section: 'tour', idField: 'ticketmaster_attraction_id', placeholder: 'Ticketmaster attraction ID or artist link' } },
  { key: 'drive', label: 'Google Drive', kind: 'service', source: { key: 'drive', section: 'files', idField: 'drive_folder_id', placeholder: 'Google Drive folder link' } },
  { key: 'shopify', label: 'Shopify', kind: 'service', source: { key: 'shopify', section: 'merch', placeholder: 'store.myshopify.com' } },
]

const BEFORE_REGISTRY = [
  { key: 'spotify', label: 'Spotify', section: 'music', idField: 'spotify_artist_id', placeholder: 'Spotify artist ID', pullLabel: 'Pull from Spotify' },
  { key: 'apple', label: 'Apple Music', section: 'music', idField: 'apple_artist_id', placeholder: 'Apple Music artist ID', pullLabel: 'Pull from Apple Music' },
  { key: 'deezer', label: 'Deezer', section: 'music', idField: 'deezer_artist_id', placeholder: 'Deezer artist ID', pullLabel: 'Pull from Deezer' },
  { key: 'youtube', label: 'YouTube', section: 'videos', idField: 'youtube_channel_id', placeholder: 'YouTube @handle, channel ID, or URL', pullLabel: 'Import uploads' },
  { key: 'bandsintown', label: 'Bandsintown', section: 'tour', idField: 'bandsintown_name', placeholder: 'Bandsintown artist name', pullLabel: 'Pull tour dates' },
  { key: 'ticketmaster', label: 'Ticketmaster', section: 'tour', idField: 'ticketmaster_attraction_id', placeholder: 'Ticketmaster attraction ID or artist link', pullLabel: 'Pull tour dates' },
  { key: 'drive', label: 'Google Drive', section: 'files', idField: 'drive_folder_id', placeholder: 'Google Drive folder link', pullLabel: 'Check folder' },
]

/** Each connection's answer to ID_PROBES; a connection not listed answers null to all. */
const BEFORE_IDS: Record<string, (string | null)[]> = {
  youtube: [null, null, null, null, null, null, null, null, 'https://youtube.com/@Sskeen', null, null, null, 'https://youtube.com/@Sskeen'],
  spotify: ['26KxuQlgIw8VP8YX2IkMWR', '26Kx', null, null, null, null, null, null, null, null, '26K', null, null],
  'apple music': [null, null, null, '1754431714', '1754431714', null, null, null, null, null, null, null, null],
  deezer: [null, null, null, null, null, null, '5723457', '5723457', null, null, null, null, null],
}

describe('the move changed nothing a caller can see', () => {
  it('CRITICAL: CONNECT_METHODS — the same platforms, in the same order, each entered the same way', () => {
    expect(Object.keys(CONNECT_METHODS)).toEqual(BEFORE_METHOD_KEYS)
    expect(Object.fromEntries(Object.entries(CONNECT_METHODS).map(([k, m]) => [k, pin(m)]))).toEqual(BEFORE_METHODS)
  })

  it('CRITICAL: CONNECTIONS — the same defs, in the same order, still plain data', () => {
    expect(JSON.parse(JSON.stringify(CONNECTIONS))).toEqual(BEFORE_CONNECTIONS)
    expect(SHOPIFY_KEY).toBe('shopify')
  })

  it('CRITICAL: INTEGRATION_REGISTRY — the same sources in the same order (sync and the overview walk it)', () => {
    expect(INTEGRATION_REGISTRY).toEqual(BEFORE_REGISTRY)
    expect(INTEGRATION_REGISTRY.map((i) => i.key)).toEqual([...INTEGRATION_KEYS])
  })

  it('a source key no service file declares throws on import, rather than dropping that source quietly', async () => {
    vi.resetModules()
    vi.doMock('@/lib/manager-tools/connections/services', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/lib/manager-tools/connections/services')>()
      return { ...real, SERVICES: real.SERVICES.filter((s) => s.source?.key !== 'deezer') }
    })
    try {
      await expect(import('@/lib/integrations-registry')).rejects.toThrow('No service file declares the deezer source')
    } finally {
      vi.doUnmock('@/lib/manager-tools/connections/services')
      vi.resetModules()
    }
  })

  it('CRITICAL: idFromProfileUrl — every connection reads the same id out of the same links', () => {
    for (const d of CONNECTIONS) {
      expect(ID_PROBES.map((p) => idFromProfileUrl(d, p)), d.key).toEqual(BEFORE_IDS[d.key] ?? ID_PROBES.map(() => null))
    }
  })
})

describe('the services list', () => {
  const DIR = join(process.cwd(), 'src/lib/manager-tools/connections/services')
  const folders = readdirSync(DIR).filter((f) => statSync(join(DIR, f)).isDirectory())

  it('CRITICAL: every service folder is in the list once, with its code beside its README', () => {
    // The walk must find the tree, or the rest of this checks nothing.
    expect(folders.length).toBeGreaterThanOrEqual(20)
    expect(SERVICES.map((s) => s.slug).sort()).toEqual([...folders].sort())
    for (const f of folders) {
      const files = readdirSync(join(DIR, f))
      expect(files, f).toContain('index.ts')
      expect(files, f).toContain('README.md')
    }
  })

  it('every service brings at least one piece, and no two claim the same one', () => {
    for (const s of SERVICES) expect(!!(s.social || s.source || s.service), s.slug).toBe(true)
    const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes(SERVICES.flatMap((s) => (s.social ? [s.social.key] : [])))).toEqual([])
    expect(dupes(SERVICES.flatMap((s) => (s.source ? [s.source.key] : [])))).toEqual([])
    expect(dupes(SERVICES.flatMap((s) => (s.service ? [s.service.key] : [])))).toEqual([])
  })

  it('every social a service declares is a platform the bridge knows — CONNECT_METHODS would drop it silently', () => {
    // The other direction (a bridge platform with no way in) is connect-methods.test.ts's.
    const bridge = SOCIAL_PLATFORMS.map((p) => p.slug)
    const socials = SERVICES.flatMap((s) => (s.social ? [s.social.key] : []))
    expect(socials.length).toBeGreaterThan(0)
    expect(socials.filter((k) => !bridge.includes(k))).toEqual([])
  })

  it('CRITICAL: every source a service declares is one INTEGRATION_KEYS names — the registry is assembled in that order', () => {
    const declared = SERVICES.flatMap((s) => (s.source ? [s.source.key] : []))
    expect([...declared].sort()).toEqual([...INTEGRATION_KEYS].sort())
  })
})
