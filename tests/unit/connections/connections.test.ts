// The Connections model: one list derived from the social vocabulary AND the sync registry.
/**
 * Connections (Sam, 2026-09-13) replaced the Links page and the Integrations hub with one
 * list. What has to hold, because two registries feed it and neither knows about the
 * other:
 *
 *   - every social platform and every syncable source appears EXACTLY once;
 *   - a source whose name is also a social (Spotify) rides that social's row, so a
 *     manager never sees Spotify twice;
 *   - Shopify — in neither registry — is still a connection;
 *   - the picker is A to Z across both kinds, and the search is a plain substring;
 *   - the ids hidden in profile URLs come out, and a playlist or a foreign URL does not;
 *   - the page lists only what is hooked up, excludes booking / role-bound rows, and
 *     ranks a connection that proved nothing ABOVE the ones that merely work quietly.
 *
 * Fixtures are derived from the registries (AGENTS.md rule 4): a seventeenth social or
 * an eighth source joins these tests by existing.
 */
import { describe, expect, it } from 'vitest'
import { SOCIAL_PLATFORMS } from '@samfox1/site-bridge/social'
import { INTEGRATION_REGISTRY, type IntegrationArtist } from '@/lib/integrations-registry'
import {
  CONNECTIONS,
  SHOPIFY_KEY,
  buildConnectionRows,
  connectInputError,
  connectionByKey,
  connectionState,
  connectionsAtoZ,
  idFromProfileUrl,
  isProfileLink,
  searchConnections,
  type ConnectionRow,
  type LinkRowLike,
} from '@/lib/connections'

const byKey = (k: string) => {
  const d = connectionByKey(k)
  if (!d) throw new Error(`no connection ${k}`)
  return d
}

describe('the registry, derived', () => {
  it('CRITICAL: every social platform is a connection, once', () => {
    for (const p of SOCIAL_PLATFORMS) {
      expect(CONNECTIONS.filter((d) => d.social === p.slug), p.slug).toHaveLength(1)
    }
  })

  it('CRITICAL: every syncable source is a connection, once — on its social’s row when it has one', () => {
    for (const intg of INTEGRATION_REGISTRY) {
      const hosts = CONNECTIONS.filter((d) => d.source?.key === intg.key)
      expect(hosts, intg.key).toHaveLength(1)
      expect(hosts[0].source?.idField).toBe(intg.idField)
    }
  })

  it('a source with a social of the same name is ONE row, not two', () => {
    // Spotify is the case that started this: a row on Links and a row on Sources.
    expect(CONNECTIONS.filter((d) => d.label === 'Spotify')).toHaveLength(1)
    expect(byKey('spotify')).toMatchObject({ kind: 'social', social: 'spotify', source: { key: 'spotify', section: 'music' } })
    expect(byKey('apple music').source?.key).toBe('apple')
    expect(byKey('deezer').source?.key).toBe('deezer')
    expect(byKey('youtube').source?.section).toBe('videos')
  })

  it('a source with no social stands alone as a service', () => {
    for (const k of ['bandsintown', 'ticketmaster', 'drive']) {
      expect(byKey(k)).toMatchObject({ kind: 'service' })
      expect(byKey(k).social).toBeUndefined()
    }
  })

  it('Shopify is a connection even though neither registry holds it', () => {
    expect(byKey(SHOPIFY_KEY)).toMatchObject({ kind: 'service', source: { key: SHOPIFY_KEY, section: 'merch' } })
  })

  it('no two connections share a label or a key', () => {
    const labels = CONNECTIONS.map((d) => d.label.toLowerCase())
    const keys = CONNECTIONS.map((d) => d.key)
    expect(new Set(labels).size).toBe(labels.length)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('the picker', () => {
  it('CRITICAL: is A to Z across socials and services together', () => {
    const labels = connectionsAtoZ().map((d) => d.label)
    const sorted = [...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    expect(labels).toEqual(sorted)
    // Bandsintown (a service) sits between Bandcamp and Deezer (socials): one list.
    const i = labels.indexOf('Bandsintown')
    expect(labels[i - 1]).toBe('Bandcamp')
    expect(labels[i + 1]).toBe('Deezer')
  })

  it('search is a case-insensitive substring; blank is everything', () => {
    expect(searchConnections('tik').map((d) => d.label)).toEqual(['TikTok'])
    expect(searchConnections('MUSIC').map((d) => d.label)).toEqual(['Apple Music'])
    expect(searchConnections('   ')).toHaveLength(CONNECTIONS.length)
    expect(searchConnections('zzz')).toEqual([])
  })
})

describe('idFromProfileUrl — the id inside the profile', () => {
  it('reads the artist id out of Spotify, Apple Music and Deezer profile links', () => {
    expect(idFromProfileUrl(byKey('spotify'), 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR')).toBe('26KxuQlgIw8VP8YX2IkMWR')
    expect(idFromProfileUrl(byKey('spotify'), 'https://open.spotify.com/intl-de/artist/26KxuQlgIw8VP8YX2IkMWR?si=x')).toBe('26KxuQlgIw8VP8YX2IkMWR')
    expect(idFromProfileUrl(byKey('apple music'), 'https://music.apple.com/no/artist/skeen/1754431714')).toBe('1754431714')
    expect(idFromProfileUrl(byKey('apple music'), 'https://music.apple.com/artist/1754431714')).toBe('1754431714')
    expect(idFromProfileUrl(byKey('deezer'), 'https://www.deezer.com/en/artist/5723457')).toBe('5723457')
    expect(idFromProfileUrl(byKey('deezer'), 'https://deezer.com/artist/5723457')).toBe('5723457')
    // Pasted with a stray space — the clipboard does that — it still reads.
    expect(idFromProfileUrl(byKey('spotify'), ' https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR ')).toBe('26KxuQlgIw8VP8YX2IkMWR')
    expect(idFromProfileUrl(byKey('spotify'), '   ')).toBeNull()
  })

  it('CRITICAL: a playlist is not an artist — no id comes out', () => {
    // Skeen's "USB button" is a Spotify PLAYLIST link. Reading an id from it would have
    // pointed the whole catalog pull at nothing.
    expect(idFromProfileUrl(byKey('spotify'), 'https://open.spotify.com/playlist/0MLdp3LsWM0uO2oryTniXi')).toBeNull()
  })

  it('hands a YouTube URL through whole, and answers null for platforms without an id', () => {
    expect(idFromProfileUrl(byKey('youtube'), 'https://youtube.com/@Sskeen')).toBe('https://youtube.com/@Sskeen')
    expect(idFromProfileUrl(byKey('instagram'), 'https://instagram.com/skeen')).toBeNull()
    expect(idFromProfileUrl(byKey('spotify'), '')).toBeNull()
  })
})

describe('connectInputError — refused before a request is made', () => {
  it('a social needs a link, and the bare site address does not count', () => {
    expect(connectInputError(byKey('instagram'), {})).toMatch(/Instagram link/)
    expect(connectInputError(byKey('instagram'), { url: 'https://instagram.com/' })).toMatch(/rest of the link/)
    expect(connectInputError(byKey('instagram'), { url: 'https://instagram.com' })).toMatch(/rest of the link/) // no slash, same address
    expect(connectInputError(byKey('instagram'), { url: '  https://instagram.com/skeen  ' })).toBeNull()
    expect(connectInputError(byKey('instagram'), { url: '   ' })).toMatch(/Instagram link/)
  })

  it('CRITICAL: a link to a DIFFERENT known platform is refused, by name', () => {
    expect(connectInputError(byKey('instagram'), { url: 'https://tiktok.com/@skeen' })).toBe('That’s a TikTok link, not Instagram.')
  })

  it('a service needs its id; Shopify needs the domain AND the token', () => {
    expect(connectInputError(byKey('bandsintown'), {})).toMatch(/Bandsintown artist name/)
    expect(connectInputError(byKey('bandsintown'), { id: 'Skeen' })).toBeNull()
    expect(connectInputError(byKey(SHOPIFY_KEY), { domain: 'x.myshopify.com' })).toMatch(/storefront token/)
    expect(connectInputError(byKey(SHOPIFY_KEY), { domain: 'x.myshopify.com', token: '   ' })).toMatch(/storefront token/)
    expect(connectInputError(byKey('bandsintown'), { id: '  ' })).toMatch(/Bandsintown artist name/)
    expect(connectInputError(byKey(SHOPIFY_KEY), { domain: 'x.myshopify.com', token: 't' })).toBeNull()
  })
})

describe('isProfileLink — what belongs on the page', () => {
  const link = (over: Partial<LinkRowLike>): LinkRowLike => ({ id: 'l', label: 'Instagram', url: 'https://instagram.com/x', on_site: true, role: null, ...over })

  it('a social profile does; booking addresses and role-bound rows do not', () => {
    expect(isProfileLink(link({}))).toBe(true)
    expect(isProfileLink(link({ label: 'Booking email', url: 'ross@example.com' }))).toBe(false)
    expect(isProfileLink(link({ label: 'Bookings', url: 'mailto:b@example.com' }))).toBe(false)
    expect(isProfileLink(link({ label: 'USB button', url: 'https://open.spotify.com/playlist/x', role: 'usb' }))).toBe(false)
  })

  it('CRITICAL: a label no site can draw is not a profile', () => {
    // The label IS the address a site maps its mark by; an unknown one renders as nothing.
    expect(isProfileLink(link({ label: 'My cool page' }))).toBe(false)
    expect(isProfileLink(link({ label: null }))).toBe(false)
  })

  it('CRITICAL: a KNOWN label is still not a profile when the row is role-bound or a contact', () => {
    // These are the cases the label check alone would wave through: a Spotify playlist
    // bound to the USB button, an Instagram row that is really a booking address.
    expect(isProfileLink(link({ label: 'Spotify', url: 'https://open.spotify.com/playlist/x', role: 'usb' }))).toBe(false)
    expect(isProfileLink(link({ label: 'Instagram', url: 'mailto:bookings@example.com' }))).toBe(false)
    expect(isProfileLink(link({ label: 'Instagram', url: 'bookings@example.com' }))).toBe(false)
  })
})

describe('buildConnectionRows — only what is hooked up', () => {
  const links: LinkRowLike[] = [
    // The USB button is a Spotify PLAYLIST labelled "Spotify" (save.ts labels role rows by
    // their key's word), and it sorts FIRST — so only the profile-link guard keeps it from
    // being taken as the Spotify profile. A label-only match would return l-usb.
    { id: 'l-usb', label: 'Spotify', url: 'https://open.spotify.com/playlist/0', on_site: true, role: 'usb' },
    { id: 'l-sp', label: 'Spotify', url: 'https://open.spotify.com/artist/26K', on_site: true, role: null },
    { id: 'l-ig', label: 'Instagram', url: 'https://instagram.com/skeen', on_site: false, role: null },
    { id: 'l-x', label: 'X', url: 'https://x.com/skeen', on_site: true, role: null },
    { id: 'l-tt', label: 'TikTok', url: 'https://tiktok.com/@skeen', on_site: false, role: null },
    { id: 'l-am', label: 'Apple Music', url: 'https://music.apple.com/artist/1', on_site: true, role: null },
    { id: 'l-bk', label: 'Booking email', url: 'ross@example.com', on_site: true, role: 'booking' },
    { id: 'l-null', label: null, url: 'https://example.com', on_site: true, role: null },
  ]
  const artist: IntegrationArtist = { spotify_artist_id: '26K', youtube_channel_id: 'Sskeen', bandsintown_name: 'Skeen' }
  const rows = buildConnectionRows({ links, artist, shopifyConnected: false, counts: { spotify: 24, youtube: 3 } })
  const row = (k: string) => rows.find((r) => r.key === k) as ConnectionRow

  it('CRITICAL: Spotify is one row carrying the profile AND the catalog', () => {
    expect(rows.filter((r) => r.label === 'Spotify')).toHaveLength(1)
    expect(row('spotify')).toMatchObject({ linkId: 'l-sp', sourceId: '26K', state: 'synced', onSite: true })
  })

  it('a connected source with no profile is still a row (YouTube), and one with neither is not (Deezer)', () => {
    expect(row('youtube')).toMatchObject({ linkId: undefined, sourceId: 'Sskeen', state: 'synced' })
    expect(row('deezer')).toBeUndefined()
  })

  it('CRITICAL: booking and role-bound links are not connections', () => {
    expect(rows.some((r) => r.linkId === 'l-usb' || r.linkId === 'l-bk')).toBe(false)
  })

  it('CRITICAL: a connected source that pulled nothing reads as FAILED, not synced', () => {
    // Bandsintown is connected (name set) but no tour date carries its source: the pull
    // proved nothing, and a chip saying "synced" would be a lie.
    expect(row('bandsintown').state).toBe('failed')
  })

  it('the ring follows the link when there is one, and the connection when there is not', () => {
    expect(row('x').onSite).toBe(true)
    expect(row('instagram').onSite).toBe(false)
    expect(row('tiktok').onSite).toBe(false)
    expect(row('youtube').onSite).toBe(true) // no link row: connected IS on
  })

  it('a profile whose source is not connected reads "connect"; a plain social reads "none"', () => {
    expect(row('apple music').state).toBe('connect')
    expect(row('instagram').state).toBe('none')
  })

  it('CRITICAL: ranks synced, then failed, then on-site profiles, then off-site — A to Z within', () => {
    // X is on the site and Instagram is not, so X comes first although I sorts before X.
    expect(rows.map((r) => r.key)).toEqual(['spotify', 'youtube', 'bandsintown', 'apple music', 'x', 'instagram', 'tiktok'])
  })

  it('Shopify joins the list when connected, and its state follows its products', () => {
    const on = buildConnectionRows({ links: [], artist: {}, shopifyConnected: true, counts: { shopify: 12 } })
    expect(on.map((r) => r.key)).toEqual([SHOPIFY_KEY])
    expect(on[0].state).toBe('synced')
    const empty = buildConnectionRows({ links: [], artist: {}, shopifyConnected: true, counts: {} })
    expect(empty[0].state).toBe('failed')
  })
})

describe('connectionState', () => {
  it('spells out the four states', () => {
    expect(connectionState(byKey('instagram'), false, 0)).toBe('none')
    expect(connectionState(byKey('spotify'), false, 0)).toBe('connect')
    expect(connectionState(byKey('spotify'), true, 0)).toBe('failed')
    expect(connectionState(byKey('spotify'), true, 1)).toBe('synced')
  })
})
