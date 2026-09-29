/**
 * What Tapir knows about the artist, for the SEO / GEO tests: read from the PUBLISHED site (never
 * the draft), and a site address the server is allowed to fetch.
 *
 * Code:     src/lib/seo-tests/known.ts (readKnown, seoSiteOrigin, publishedFromPayload)
 * Feature:  Test runs · the facts every SEO test compares the live site against
 * Tier:     STRICT (AGENTS.md "Test depth"): comparing the live site to the DRAFT would fail a
 *           site that is exactly right, and `siteUrl` is an address the server FETCHES (SSRF).
 * Covers:   • the only reads are the artist row and the two public doors (get_public_site, get_public_releases)
 *           • nothing ever published is `published: null`; a door error throws
 *           • a template, localhost (in development too), private or malformed address is "no site"
 *           • the door's fields map as the tests expect: links deduped (on site first), photos
 *             only, the manager's past-show flag, the title override
 *           • region, country, artist type and the Spotify id read exactly as the fact card states them
 * Not here: fetching the site safely (tests/unit/safe-fetching/); what each SEO test does with
 *           these facts (tests/unit/seo-tests/).
 * Fixtures: a PostgREST fake (brand/_fake-client) that answers the artist row and both doors, and
 *           a draft row for anything else (so a draft read would show); a hand-made door payload.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishedFromPayload, readKnown, seoSiteOrigin } from '@/lib/seo-tests/known'
import type { PublicSitePayload } from '@samfox1/site-bridge/payload'
import { FACT_CONTENT_KEYS, artistPlace, sameAsFrom } from '@samfox1/site-bridge/seo'
import { fakeClient, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

const A = 'artist-1'

afterEach(() => vi.unstubAllEnvs())

const payload = (over: Partial<PublicSitePayload> = {}): PublicSitePayload =>
  ({
    artist: { id: A, slug: 'ex', name: 'Example', bio: '  A bio.  ', hero_image_url: null, template: 'custom', spotify_artist_id: null, genre: 'house', location: 'Chicago, IL' },
    published_at: '2026-09-28T21:14:03.123456+00:00',
    tracks: [],
    tour_dates: [
      { id: 't1', date: '2026-10-01', venue: 'Smartbar', city: 'Chicago', country: 'US', ticket_url: null, is_past: false },
      { id: 't2', date: '2026-01-01', venue: 'Old', city: 'Madison', country: 'US', ticket_url: null, is_past: true },
    ],
    merch: [],
    links: [{ id: 'l1', label: 'Spotify', url: 'https://open.spotify.com/artist/1', sort_order: 0 }],
    identity_links: [
      { url: 'https://open.spotify.com/artist/1', label: 'Spotify' },
      { url: 'https://musicbrainz.org/artist/abc', label: 'MusicBrainz' },
    ],
    videos: [],
    media: [
      { purpose: 'gallery_image', path: 'a1/g1.jpg', alt: 'On stage' },
      { purpose: 'profile_photo', path: 'a1/p.jpg', alt: null },
      { purpose: 'logo_primary', path: 'a1/logo.png', alt: 'Logo' },
    ],
    site_content: { seo_title: 'Example | Chicago house DJ' },
    styles: {},
    fonts: [],
    font_slots: {},
    ...over,
  }) as PublicSitePayload

type World = { artist?: Record<string, unknown> | null; site?: PublicSitePayload | null; siteError?: boolean }

function world({ artist = { slug: 'ex', name: 'Example', site_kind: 'custom', custom_site_url: 'https://www.example-artist.com/' }, site = payload(), siteError = false }: World = {}) {
  return fakeClient((c: Call): Reply => {
    if (c.table === 'artists') return { data: artist }
    if (c.op === 'rpc' && c.table === 'get_public_site') return siteError ? { error: { message: 'boom' } } : { data: site }
    if (c.op === 'rpc' && c.table === 'get_public_releases') return { data: [{ id: 'r1', title: 'EP One', cover_url: null, release_date: '2026-05-01' }] }
    return { data: [{ id: 'draft-row' }] }
  })
}

describe('readKnown reads the PUBLISHED door, never the draft', () => {
  // Published only: the draft is never read, so a site that matches what was published passes.
  it('CRITICAL: the only reads are the artist row and the two public doors', async () => {
    const f = world()
    const k = await readKnown(f.client, A, { now: Date.parse('2026-09-28T12:00:00Z') })
    const touched = f.calls.map((c) => `${c.op}:${c.table}`).sort()
    expect(touched).toEqual(['rpc:get_public_releases', 'rpc:get_public_site', 'select:artists'])
    expect(f.calls.find((c) => c.table === 'get_public_site')?.args).toEqual({ p_slug: 'ex' })
    expect(k.today).toBe('2026-09-28')
    expect(k.siteUrl).toBe('https://www.example-artist.com')
    expect(k.published?.bio).toBe('A bio.')
  })

  // Never published: there is nothing to compare, and that is said as null, not as empty facts.
  it('nothing ever published (no revision) is `published: null`', async () => {
    const k = await readKnown(world({ site: payload({ published_at: null }) }).client, A)
    expect(k.published).toBeNull()
    expect(k.artistName).toBe('Example')
  })

  // A failed read throws: the run must not compare the site against nothing.
  it('a door error throws: the run must not compare the site against nothing', async () => {
    await expect(readKnown(world({ siteError: true }).client, A)).rejects.toThrow(/get_public_site/)
    await expect(readKnown(world({ artist: null }).client, A)).rejects.toThrow()
  })
})

describe('seoSiteOrigin: an address this server may fetch', () => {
  // Unsafe or missing addresses are "no site": the server must never fetch a private or made-up address.
  it('CRITICAL: template, localhost, private and malformed addresses are "no site"', () => {
    expect(seoSiteOrigin({ site_kind: 'template', custom_site_url: 'https://www.example-artist.com' })).toBeNull()
    expect(seoSiteOrigin({ site_kind: 'custom', custom_site_url: 'http://localhost:3004' })).toBeNull()
    expect(seoSiteOrigin({ site_kind: 'custom', custom_site_url: 'http://169.254.169.254/' })).toBeNull()
    expect(seoSiteOrigin({ site_kind: 'custom', custom_site_url: 'https://10.0.0.8' })).toBeNull()
    expect(seoSiteOrigin({ site_kind: 'custom', custom_site_url: 'javascript:alert(1)' })).toBeNull()
    expect(seoSiteOrigin({ site_kind: 'custom', custom_site_url: null })).toBeNull()
    expect(seoSiteOrigin(null)).toBeNull()
  })

  // Development too: the redirect guard lets localhost through there, so this guard must not.
  it('CRITICAL: in DEVELOPMENT too, where the redirect guard lets localhost through (FTBK is localhost:3004)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(seoSiteOrigin({ site_kind: 'custom', custom_site_url: 'http://localhost:3004' })).toBeNull()
    expect(seoSiteOrigin({ site_kind: 'custom', custom_site_url: 'http://127.0.0.1:3004' })).toBeNull()
  })

  // A public site: just its origin, so every test starts from the home page.
  it('a public custom site is its origin (path and slash dropped)', () => {
    expect(seoSiteOrigin({ site_kind: 'custom', custom_site_url: 'https://www.example-artist.com/home/' })).toBe('https://www.example-artist.com')
    expect(seoSiteOrigin({ site_kind: 'custom', custom_site_url: 'https://wren-site-theta.vercel.app' })).toBe('https://wren-site-theta.vercel.app')
  })

  // A template site: no address to test, but the published facts are still read.
  it('readKnown with a template site: siteUrl null, and the door is still read', async () => {
    const k = await readKnown(world({ artist: { slug: 'ex', name: 'Example', site_kind: 'template', custom_site_url: null } }).client, A)
    expect(k.siteUrl).toBeNull()
    expect(k.published).not.toBeNull()
  })
})

describe('publishedFromPayload', () => {
  // Links: the site's buttons first (on site), then identity links not already shown (off site).
  it('links: buttons first (on site), then identity links not already buttons (off site)', () => {
    const p = publishedFromPayload(payload(), [])
    expect(p.links).toEqual([
      { label: 'Spotify', url: 'https://open.spotify.com/artist/1', onSite: true },
      { label: 'MusicBrainz', url: 'https://musicbrainz.org/artist/abc', onSite: false },
    ])
  })

  // Photos: only the profile and gallery images count, with the manager's own alt text.
  it('photos are the profile + gallery images only, with the manager\'s alt (or null)', () => {
    const p = publishedFromPayload(payload(), [])
    expect(p.photos.map((x) => x.alt)).toEqual(['On stage', null])
    expect(p.photos.every((x) => /a1\/(g1|p)\.jpg$/.test(x.url))).toBe(true)
  })

  // Tour, title, releases: the manager's past-show flag, the title override, and the published date.
  it('isPast is the manager\'s flag; title is what the site should show (the override wins)', () => {
    const p = publishedFromPayload(payload(), [{ id: 'r1', title: 'EP One', cover_url: null, release_date: '2026-05-01' }])
    expect(p.tourDates.map((t) => t.isPast)).toEqual([false, true])
    expect(p.seoTitle).toBe('Example | Chicago house DJ')
    expect(p.genre).toBe('house')
    expect(p.releases).toEqual([{ title: 'EP One', releasedOn: '2026-05-01' }])
    expect(p.publishedAt).toBe('2026-09-28T21:14:03.123456+00:00')
  })
})

describe('publishedFromPayload: the facts the tests need, as the fact card reads them', () => {
  const withArtist = (artist: Record<string, unknown>, content: Record<string, string> = {}) =>
    payload({ artist: { ...payload().artist, ...artist }, site_content: { ...payload().site_content, ...content } } as Partial<PublicSitePayload>)

  // Region and country: the same spelling and code the fact card states, or the place test would disagree with the site.
  it('CRITICAL: region and country come from the published fact keys, the country in the bridge table\'s spelling and code', () => {
    const site = withArtist({}, { [FACT_CONTENT_KEYS.region]: ' Illinois ', [FACT_CONTENT_KEYS.country]: 'usa' })
    const p = publishedFromPayload(site, [])
    expect(p.region).toBe('Illinois')
    expect(p.country).toBe('United States')
    expect(p.countryCode).toBe('US')
    // The same code the fact card states (the bridge's own place), not a second reading.
    expect((artistPlace(site)?.address as Record<string, unknown>).addressCountry).toBe(p.countryCode)
  })

  // An unknown country is kept as typed with no code; nothing set is null.
  it('a country the table does not know is kept as typed, with no code; nothing set is null', () => {
    const p = publishedFromPayload(withArtist({}, { [FACT_CONTENT_KEYS.country]: 'Atlantis' }), [])
    expect(p.country).toBe('Atlantis')
    expect(p.countryCode).toBeNull()
    const none = publishedFromPayload(payload(), [])
    expect([none.region, none.country, none.countryCode]).toEqual([null, null, null])
  })

  // Artist type: only a published Person is a visual artist, the bridge's own rule.
  it('CRITICAL: artist type: only a published Person is a visual artist; anything else is a musician (the bridge\'s rule)', () => {
    expect(publishedFromPayload(withArtist({ schema_type: 'Person' }), []).artistType).toBe('Person')
    expect(publishedFromPayload(withArtist({ schema_type: 'MusicGroup' }), []).artistType).toBe('MusicGroup')
    expect(publishedFromPayload(withArtist({ schema_type: null }), []).artistType).toBe('MusicGroup')
    expect(publishedFromPayload(payload(), []).artistType).toBe('MusicGroup')
  })

  // Spotify id: kept exactly when the fact card would carry it, so the profiles test checks the same link.
  it('CRITICAL: the Spotify artist id is kept exactly when the bridge would put its profile on the fact card', () => {
    for (const id of ['26KxuQlgIw8VP8YX2IkMWR', 'bad id!', '', null]) {
      const site = withArtist({ spotify_artist_id: id }, {})
      const p = publishedFromPayload({ ...site, links: [], identity_links: [] }, [])
      const onCard = sameAsFrom({ ...site, links: [], identity_links: [] })
      expect(p.spotifyArtistId, String(id)).toBe(onCard.length ? id : null)
      if (p.spotifyArtistId) expect(onCard).toEqual([`https://open.spotify.com/artist/${p.spotifyArtistId}`])
    }
  })
})
