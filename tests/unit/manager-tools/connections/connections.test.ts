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
  buttonChoices,
  connectInputError,
  connectionByKey,
  connectionHandle,
  connectionOfLink,
  connectionState,
  connectionsAtoZ,
  idFromProfileUrl,
  isProfileLink,
  searchConnections,
  type ConnectionRow,
  type LinkRowLike,
  methodOf,
  profileLink,
  wantsSync,
} from '@/lib/connections'
import { CONNECT_METHODS, withArticle, type HandleMethod } from '@/lib/connect-methods'

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
    // Bandsintown (a service) sits between Bandcamp and Beatport (socials): one list.
    const i = labels.indexOf('Bandsintown')
    expect(labels[i - 1]).toBe('Bandcamp')
    expect(labels[i + 1]).toBe('Beatport')
  })

  it('search is a case-insensitive substring; blank is everything', () => {
    expect(searchConnections('tik').map((d) => d.label)).toEqual(['TikTok'])
    expect(searchConnections('MUSIC').map((d) => d.label)).toEqual(['Apple Music', 'YouTube Music', 'Amazon Music', 'MusicBrainz'])
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
  it('CRITICAL: a handle platform needs only the handle (Sam, 2026-09-28), and reads a pasted link too', () => {
    expect(connectInputError(byKey('x'), { handle: 'skeenmusic' })).toBeNull()
    expect(connectInputError(byKey('x'), { handle: '@skeenmusic' })).toBeNull()
    expect(connectInputError(byKey('x'), { handle: 'https://twitter.com/skeenmusic' })).toBeNull()
    expect(connectInputError(byKey('x'), {})).toBe('Enter the X handle.')
    expect(connectInputError(byKey('x'), { handle: 'skeen music' })).toBe('That doesn’t look like an X handle.')
    // An older caller that sends a whole link still works: it is read back to its handle.
    expect(connectInputError(byKey('instagram'), { url: '  https://instagram.com/skeen  ' })).toBeNull()
    expect(connectInputError(byKey('instagram'), { url: 'https://instagram.com/' })).toBe('Enter the Instagram username.')
  })

  it('CRITICAL: a link to a DIFFERENT known platform is refused, by name', () => {
    expect(connectInputError(byKey('instagram'), { handle: 'https://tiktok.com/@skeen' })).toBe('That’s a TikTok link, not Instagram.')
    expect(connectInputError(byKey('spotify'), { url: 'https://tiktok.com/@skeen' })).toBe('That’s a TikTok link, not Spotify.')
  })

  it('a music service (no handles) needs its artist link, and the bare site address does not count', () => {
    expect(connectInputError(byKey('spotify'), {})).toMatch(/Spotify link/)
    expect(connectInputError(byKey('spotify'), { url: '   ' })).toMatch(/Spotify link/)
    expect(connectInputError(byKey('spotify'), { url: 'https://open.spotify.com/artist/' })).toMatch(/rest of the link/)
    expect(connectInputError(byKey('spotify'), { url: 'https://open.spotify.com/artist/26K' })).toBeNull()
  })

  it('profileLink: the one link a social saves — built from the handle, or the pasted link as is', () => {
    expect(profileLink(byKey('x'), { handle: '@skeenmusic' })).toEqual({ url: 'https://x.com/skeenmusic' })
    expect(profileLink(byKey('bandcamp'), { handle: 'skeen' })).toEqual({ url: 'https://skeen.bandcamp.com' })
    expect(profileLink(byKey('spotify'), { url: ' https://open.spotify.com/artist/26K ' })).toEqual({ url: 'https://open.spotify.com/artist/26K' })
    expect(profileLink(byKey('x'), { handle: '' })).toEqual({ error: 'Enter the X handle.' })
  })

  it('wantsSync: a connection that can pull does, unless the manager turned it off; a plain social never does', () => {
    expect(wantsSync(byKey('spotify'), {})).toBe(true)
    expect(wantsSync(byKey('spotify'), { sync: true })).toBe(true)
    expect(wantsSync(byKey('spotify'), { sync: false })).toBe(false)
    expect(wantsSync(byKey('youtube'), { sync: false })).toBe(false)
    expect(wantsSync(byKey('x'), { sync: true })).toBe(false)
  })

  it('every social has its connect method; the services have none', () => {
    for (const d of CONNECTIONS) expect(!!methodOf(d), d.key).toBe(!!d.social)
    expect(methodOf(byKey('x'))?.kind).toBe('handle')
    expect(methodOf(byKey('spotify'))?.kind).toBe('link')
  })

  it('CRITICAL: a connection is PLAIN DATA — it crosses from the server page to the client list', () => {
    // A def (inside every ConnectionRow) is passed to client components, and a function or
    // a RegExp on it cannot be serialized: the whole Connections page answered 500 when the
    // handle rules rode on the def (2026-09-28). The rules are looked up by slug instead.
    for (const d of CONNECTIONS) expect(JSON.parse(JSON.stringify(d)), d.key).toEqual(d)
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

describe('a link-kind connection takes only ITS platform’s link (2026-09-28)', () => {
  // Until now a link-kind connection (Spotify, Tidal…) accepted ANY url that was not
  // recognisably another platform's: a personal site, a `javascript:` string, a WhatsApp
  // chat link carrying a phone number. Sam: "if its behavior before was not correct, it
  // should be changed". Derived from the registry, so a new link-kind platform joins by existing.
  const linkKinds = CONNECTIONS.filter((d) => methodOf(d)?.kind === 'link')
  // A platform whose profile is one path shape gets a link of that shape (identity-only.test.ts pins those shapes).
  const OWN: Record<string, string> = {
    whatsapp: 'https://whatsapp.com/channel/0029VaSkeenMusic',
    musicbrainz: 'https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d',
    discogs: 'https://www.discogs.com/artist/123-Skeen',
  }
  const ownLink = (key: string, hint: string) => OWN[key] ?? `${hint}skeen-123`

  it('CRITICAL: every one refuses a link no platform owns, and one that is another platform’s, by name', () => {
    expect(linkKinds.length).toBeGreaterThanOrEqual(10)
    for (const d of linkKinds) {
      const m = methodOf(d)
      const noun = m?.kind === 'link' ? m.pathNoun : undefined
      expect(connectInputError(d, { url: 'https://juniperhale.com/music' }), d.key).toBe(`That isn’t ${withArticle(d.label)}${noun ? ` ${noun}` : ''} link.`)
      expect(connectInputError(d, { url: 'https://instagram.com/skeen' }), d.key).toBe(`That’s an Instagram link, not ${d.label}.`)
    }
  })

  it('CRITICAL: every one accepts its own link, as pasted', () => {
    for (const d of linkKinds) {
      const url = ownLink(d.key, d.urlHint!)
      expect(profileLink(d, { url }), d.key).toEqual({ url })
    }
  })

  it('only a web link: no javascript:, mailto: or other scheme gets in', () => {
    for (const url of ['javascript:alert(1)', 'javascript://open.spotify.com/%0Aalert(1)', 'mailto:a@b.com', 'ftp://open.spotify.com/artist/26K'])
      expect(connectInputError(byKey('spotify'), { url }), url).toBe('That isn’t a Spotify link.')
  })

  it('a link pasted without https:// gets it, and http:// becomes https://', () => {
    expect(profileLink(byKey('spotify'), { url: 'open.spotify.com/artist/26K' })).toEqual({ url: 'https://open.spotify.com/artist/26K' })
    expect(profileLink(byKey('spotify'), { url: 'http://open.spotify.com/artist/26K' })).toEqual({ url: 'https://open.spotify.com/artist/26K' })
    expect(connectInputError(byKey('spotify'), { url: 'http://open.spotify.com/artist/' })).toMatch(/rest of the link/)
  })

  it('the host rules decide: a subdomain platform, and a country domain', () => {
    expect(connectInputError(byKey('youtube music'), { url: 'https://youtube.com/channel/UC1' })).toBe('That’s a YouTube link, not YouTube Music.')
    expect(connectInputError(byKey('youtube music'), { url: 'https://music.youtube.com/channel/UC1' })).toBeNull()
    expect(connectInputError(byKey('amazon music'), { url: 'https://www.amazon.com/dp/B00157GJ20' })).toBe('That isn’t an Amazon Music link.')
    expect(connectInputError(byKey('amazon music'), { url: 'https://music.amazon.co.uk/artists/B00157GJ20/skeen' })).toBeNull()
    expect(connectInputError(byKey('eventbrite'), { url: 'https://www.eventbrite.co.uk/o/skeen-123' })).toBeNull()
    expect(connectInputError(byKey('eventbrite'), { url: 'https://skeen.eventbrite.com' })).toBeNull()
  })

  it('CRITICAL: WhatsApp takes a channel link only — never a link that carries a phone number', () => {
    const wa = byKey('whatsapp')
    for (const url of [
      'https://wa.me/15551234567',
      'wa.me/15551234567',
      'https://api.whatsapp.com/send?phone=15551234567',
      'https://api.whatsapp.com/send/?phone=15551234567&text=hi',
      'https://chat.whatsapp.com/AbCdEf123',
      'https://web.whatsapp.com',
      'https://whatsapp.com/15551234567',
      // A channel id always has letters in it; digits alone would be a phone number.
      'https://whatsapp.com/channel/15551234567',
      'https://whatsapp.com/channel/0029VaSkeen/15551234567',
    ])
      expect(connectInputError(wa, { url }), url).toBe('That isn’t a WhatsApp channel link.')
    // Saved without its query or fragment: nothing rides along after the channel id.
    expect(profileLink(wa, { url: 'https://www.whatsapp.com/channel/0029VaSkeen?phone=15551234567#x' })).toEqual({ url: 'https://www.whatsapp.com/channel/0029VaSkeen' })
    expect(connectInputError(wa, { url: 'https://whatsapp.com/channel/' })).toMatch(/rest of the link/)
  })

  it('Eventbrite: the organizer id comes out of an /o/ link, and nothing out of anyone else’s', () => {
    const eb = byKey('eventbrite')
    expect(idFromProfileUrl(eb, 'https://www.eventbrite.com/o/skeenmusic-123456789')).toBe('123456789')
    expect(idFromProfileUrl(eb, 'https://www.eventbrite.co.uk/o/2666544056')).toBe('2666544056')
    expect(idFromProfileUrl(eb, 'https://skeenmusic.eventbrite.com')).toBeNull()
    expect(idFromProfileUrl(eb, 'https://evil.com/eventbrite.com/o/skeen-123')).toBeNull()
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
    expect(row('spotify')).toMatchObject({ linkId: 'l-sp', sourceId: '26K', state: 'synced' })
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

  it('CRITICAL: a row carries no on-site flag — a site button is made in the editor, not here', () => {
    // Sam, 2026-09-28: "Only in the editor." The page used to wear a ring per row that put
    // the link on the site; a connection is an account, the button is the editor's.
    for (const r of rows) expect(r).not.toHaveProperty('onSite')
  })

  it('a profile whose source is not connected reads "connect"; a plain social reads "none"', () => {
    expect(row('apple music').state).toBe('connect')
    expect(row('instagram').state).toBe('none')
  })

  it('CRITICAL: ranks synced, then failed, then everything else — A to Z within, on the site or not', () => {
    // X is on the site and Instagram and TikTok are not; that no longer moves anyone.
    const order = ['spotify', 'youtube', 'bandsintown', 'apple music', 'instagram', 'tiktok', 'x']
    expect(rows.map((r) => r.key)).toEqual(order)
    // Every link flipped the other way: the same list, in the same order.
    const flipped = links.map((l) => ({ ...l, on_site: !l.on_site }))
    const again = buildConnectionRows({ links: flipped, artist, shopifyConnected: false, counts: { spotify: 24, youtube: 3 } })
    expect(again.map((r) => r.key)).toEqual(order)
  })

  it('CRITICAL: Eventbrite’s shows follow its SIGN-IN, not an id column; with the sign-in off, a pasted link is a plain social', () => {
    const eb: LinkRowLike[] = [{ id: 'l-eb', label: 'Eventbrite', url: 'https://www.eventbrite.com/o/skeen-222', on_site: false, role: null }]
    const signedIn = buildConnectionRows({ links: eb, artist: {}, shopifyConnected: false, signedIn: { eventbrite: true }, counts: { eventbrite: 4 } })
    expect(signedIn.find((r) => r.key === 'eventbrite')).toMatchObject({ linkId: 'l-eb', state: 'synced', sourceId: undefined })
    const pulledNothing = buildConnectionRows({ links: eb, artist: {}, shopifyConnected: false, signedIn: { eventbrite: true }, counts: {} })
    expect(pulledNothing.find((r) => r.key === 'eventbrite')!.state).toBe('failed')
    // Not signed in, the button is there: a "Sync" chip that says how.
    const pasted = buildConnectionRows({ links: eb, artist: {}, shopifyConnected: false, signedIn: { eventbrite: false }, counts: {} })
    expect(pasted.find((r) => r.key === 'eventbrite')!.state).toBe('connect')
    // The app is not set up: nothing can pull, so no chip at all.
    const off = buildConnectionRows({ links: eb, artist: {}, shopifyConnected: false, counts: {} })
    expect(off.find((r) => r.key === 'eventbrite')!.state).toBe('none')
    // Signed in with no link still makes a row (the token pulls on its own).
    expect(buildConnectionRows({ links: [], artist: {}, shopifyConnected: false, signedIn: { eventbrite: true }, counts: { eventbrite: 1 } }).map((r) => r.key)).toEqual(['eventbrite'])
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

describe('site buttons — a connection the editor can put on the site', () => {
  type EditorLinkLike = LinkRowLike & { onSite: boolean }
  const link = (over: Partial<EditorLinkLike> & { id: string }): EditorLinkLike => ({ label: 'Instagram', url: 'https://instagram.com/skeen', role: null, onSite: false, ...over })
  // Every service, derived: a row labelled with a service's name is never a button, whatever
  // it points at (Sam, 2026-09-28: "I will use shopify differently").
  const services = CONNECTIONS.filter((d) => d.kind === 'service')
  const links: EditorLinkLike[] = [
    link({ id: 'l-x', label: 'X', url: 'https://x.com/skeen', onSite: true }),
    link({ id: 'l-tt', label: 'TikTok', url: 'https://tiktok.com/@skeen' }),
    link({ id: 'l-ig', label: 'Instagram', url: 'https://instagram.com/skeen' }),
    link({ id: 'l-usb', label: 'Spotify', url: 'https://open.spotify.com/playlist/0', role: 'usb' }),
    link({ id: 'l-bk', label: 'Instagram', url: 'mailto:book@example.com' }),
    link({ id: 'l-odd', label: 'My cool page', url: 'https://example.com' }),
    ...services.map((d) => link({ id: `l-${d.key}`, label: d.label, url: 'https://example.com/skeen' })),
  ]

  it('CRITICAL: only profiles that are not buttons yet — A to Z, each with its connection', () => {
    const choices = buttonChoices(links)
    expect(choices.map((c) => c.link.id)).toEqual(['l-ig', 'l-tt'])
    // The SAME row, not a copy: picking it turns that row on.
    expect(choices[0].link).toBe(links[2])
    expect(choices.map((c) => c.def.key)).toEqual(['instagram', 'tiktok'])
  })

  it('CRITICAL: a service is never a button, and neither is a role-bound or contact row', () => {
    expect(services.length).toBeGreaterThan(0) // the guard has to be guarding something
    const ids = buttonChoices(links).map((c) => c.link.id)
    for (const d of services) expect(ids).not.toContain(`l-${d.key}`)
    expect(ids).not.toContain('l-usb')
    expect(ids).not.toContain('l-bk')
    expect(ids).not.toContain('l-odd')
  })

  it('connectionOfLink: a profile row names its social connection; anything else, none', () => {
    expect(connectionOfLink(links[0])?.key).toBe('x')
    expect(connectionOfLink({ id: 'a', label: 'apple music', url: 'https://music.apple.com/us/artist/1' })?.key).toBe('apple music')
    expect(connectionOfLink(links[3])).toBeUndefined() // the USB playlist
    expect(connectionOfLink(links[4])).toBeUndefined() // a booking address
    for (const d of services) expect(connectionOfLink({ id: 's', label: d.label, url: 'https://example.com' })).toBeUndefined()
  })

  it('connectionHandle: a handle platform shows the handle, round trip, for every one of them', () => {
    const handles = Object.entries(CONNECT_METHODS).filter((e): e is [string, HandleMethod] => e[1].kind === 'handle')
    expect(handles.length).toBeGreaterThan(5)
    for (const [slug, m] of handles) expect(connectionHandle(byKey(slug), m.url(m.example)), slug).toBe(m.example)
  })

  it('connectionHandle: a link platform, or a link with no handle in it, shows the address as a person says it', () => {
    expect(connectionHandle(byKey('spotify'), 'https://open.spotify.com/artist/26K/')).toBe('open.spotify.com/artist/26K')
    expect(connectionHandle(byKey('youtube'), 'https://www.youtube.com/channel/UC123')).toBe('youtube.com/channel/UC123')
    // A connection with no connect method at all (a service) reads the same way, not a throw.
    expect(connectionHandle(byKey(SHOPIFY_KEY), 'https://skeen.myshopify.com/')).toBe('skeen.myshopify.com')
  })
})
