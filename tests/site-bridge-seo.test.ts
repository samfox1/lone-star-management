/**
 * The bridge's SEO builders (SEO_GEO_PLAN B4): ONE copy of the rules skeen's lib/seo.ts
 * and lone-star's src/lib/seo.ts each carried. Pure, DB-free, in the mutation slice.
 *
 * The fixture is typed `satisfies PublicSitePayload`, so a wire field added later is a
 * compile error here, not a silently unexercised branch.
 */
import { describe, expect, it } from 'vitest'
import type { PublicSitePayload } from '@samfox1/site-bridge/payload'
import {
  SEO_RULES,
  faqEntries,
  faqPageJsonLd,
  probePrompts,
  aboutPlacement,
  auditGeoFacts,
  isProfileUrl,
  jsonLdGraph,
  jsonLdScript,
  lastModifiedFrom,
  resolveSeo,
  robotsRules,
  sameAsFrom,
  sitemapEntries,
} from '@samfox1/site-bridge/seo'

const ORIGIN = 'https://www.example.com'

function payload(over: Partial<PublicSitePayload> = {}): PublicSitePayload {
  return {
    artist: {
      id: 'a1',
      slug: 'skeen',
      name: 'Skeen',
      bio: 'Chicago DJ, producer and filmmaker.\nSecond paragraph.',
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      template: 'custom',
      spotify_artist_id: 'abc123',
      genre: 'House, Techno',
      location: 'Chicago',
    },
    published_at: '2026-08-20T12:00:00.000Z',
    tracks: [
      { id: 't1', title: 'Night Drive', cover_url: null, stream_url: 'https://open.spotify.com/track/1', provider_url: null, apple_url: null, has_audio: false, featured_artists: [], album_name: 'Night Drive EP', release_id: 'r1', sort_order: 1, source: null, spotify_id: null, apple_id: null, deezer_id: null, soundcloud_url: null, released: true },
      { id: 't2', title: 'Loose', cover_url: null, stream_url: null, provider_url: null, apple_url: null, has_audio: false, featured_artists: [], album_name: null, release_id: null, sort_order: 2, source: null, spotify_id: null, apple_id: null, deezer_id: null, soundcloud_url: null, released: true },
    ],
    tour_dates: [
      { id: 's1', date: '2026-09-10', venue: 'Smartbar', city: 'Chicago', state: 'IL', country: 'US', ticket_url: 'https://tix.example.com/1', support: ['Jigitz'] },
      { id: 's2', date: '2026-08-01', venue: 'Past Venue', city: 'Detroit', country: 'US', ticket_url: null },
      { id: 's3', date: null, venue: 'TBA', city: null, country: null, ticket_url: null },
      // Dated and upcoming but venue-less: Google requires location, so it is NOT stated.
      { id: 's4', date: '2026-10-01', venue: 'Somewhere', city: null, country: 'US', ticket_url: 'https://tix.example.com/4' },
      // Future date but the manager marked it past (cancelled): never advertised.
      { id: 's5', date: '2026-12-01', venue: 'V', city: 'C', country: 'US', ticket_url: null, is_past: true },
    ],
    merch: [],
    links: [
      { id: 'l1', label: 'Instagram', url: 'https://instagram.com/skeen', sort_order: 1 },
      { id: 'l2', label: 'Website', url: 'https://skeenmusic.com', sort_order: 2 },
      { id: 'l3', label: 'Evil', url: 'javascript:alert(1)', sort_order: 3 },
      // A playlist is not an identity page: sameAs must not claim it (review, 2026-08-26).
      { id: 'l4', label: 'USB', url: 'https://open.spotify.com/playlist/0MLdp3LsWM?si=abc', sort_order: 4 },
      { id: 'l5', label: 'SoundCloud set', url: 'https://soundcloud.com/skeen/sets/mix', sort_order: 5 },
    ],
    videos: [
      { id: 'v1', title: 'Night Drive (live)', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/abc123XYZ', storage_path: null, sort_order: 1, created_at: '2026-07-01T00:00:00.000Z', published_at: '2026-05-01T00:00:00.000Z' },
      { id: 'v2', title: 'Studio', provider: 'uploaded', embed_url: null, storage_path: 'a1/videos/studio.mp4', sort_order: 2, created_at: '2026-07-02T00:00:00.000Z', published_at: '2026-05-02T00:00:00.000Z' },
      { id: 'v3', title: 'Broken', provider: 'youtube', embed_url: null, storage_path: null, sort_order: 3 },
      { id: 'v4', title: 'Mix', provider: 'soundcloud', embed_url: 'https://w.soundcloud.com/player/?url=x', storage_path: null, sort_order: 4, created_at: '2026-05-03T00:00:00.000Z' },
      // A YouTube embed with only created_at (the day it was ADDED): uploadDate unknown → left out.
      { id: 'v5', title: 'Old', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/old000000', storage_path: null, sort_order: 5, created_at: '2026-07-05T00:00:00.000Z' },
    ],
    media: [
      { id: 'm1', purpose: 'gallery_image', path: 'a1/gallery/skeen-oslo.jpg', kind: 'photo', alt: 'Skeen, Oslo' },
      { id: 'm2', purpose: 'gallery_image', path: 'a1/gallery/blue-study.jpg', kind: 'artwork', alt: null, label: 'Blue Study' },
      { id: 'm3', purpose: 'gallery_image', path: 'a1/gallery/ornament.png', kind: 'none' },
      { id: 'm4', purpose: 'logo_primary', path: 'a1/brand/logo.png' },
    ],
    site_content: {},
    styles: {},
    fonts: [],
    font_slots: {},
    ...over,
  } satisfies PublicSitePayload
}

describe('resolveSeo', () => {
  it('override > bio > "name — official site", collapsed and capped at 160', () => {
    expect(resolveSeo(payload()).description).toBe('Chicago DJ, producer and filmmaker. Second paragraph.')
    expect(resolveSeo(payload({ site_content: { seo_description: '  Hand  written ' } })).description).toBe('Hand written')
    expect(resolveSeo(payload({ artist: { ...payload().artist, bio: null } })).description).toBe('Skeen — official site')
    const long = resolveSeo(payload({ site_content: { seo_description: 'x'.repeat(200) } })).description
    expect(long.length).toBe(160)
    expect(long.endsWith('…')).toBe(true)
  })
  it('title: override else the name; whitespace-only override = unset', () => {
    expect(resolveSeo(payload()).title).toBe('Skeen')
    expect(resolveSeo(payload({ site_content: { seo_title: 'SKEEN' } })).title).toBe('SKEEN')
    expect(resolveSeo(payload({ site_content: { seo_title: '   ' } })).title).toBe('Skeen')
  })
  it('CRITICAL: og image is og_image > hero, http(s) only', () => {
    expect(resolveSeo(payload()).ogImage).toBe('https://cdn.example.com/hero.jpg')
    expect(resolveSeo(payload({ site_content: { og_image: 'https://cdn.example.com/card.png' } })).ogImage).toBe('https://cdn.example.com/card.png')
    expect(resolveSeo(payload({ site_content: { og_image: 'javascript:alert(1)' }, artist: { ...payload().artist, hero_image_url: 'data:image/png;base64,AAAA' } })).ogImage).toBeNull()
  })
})

describe('jsonLdGraph', () => {
  // listImage = the SITE's rendering: the same src the page uses, and its alt. m3 is
  // never placed on the page, so the site returns null for it.
  const listImage = (m: { id?: string | null; path: string; alt?: string | null }) =>
    m.id === 'm3' ? null : { url: `https://cdn.example.com/render/${m.path}?w=600`, alt: m.alt ?? null }
  const graph = jsonLdGraph(payload(), { origin: ORIGIN, today: '2026-08-26', listImage, imageUrl: 'https://cdn.example.com/logo.png', releases: [
    // links as the dashboard stores them: an ARRAY of {label,url} (a record of urls is
    // the older shape; both are read). A non-string value must be skipped, not thrown on —
    // the 2026-08-26 skeen build died prerendering "/" on exactly that.
    { id: 'r1', title: 'Night Drive EP', cover_url: 'https://cdn.example.com/cover.jpg', release_date: '2026-06-01', release_type: 'ep', links: [{ label: 'Apple', url: 'https://music.apple.com/x' }, { label: 'Bad', url: 'javascript:1' }, { label: 'Broken' } as { label: string }], spotify_id: 'alb1' },
  ] })
  const nodes = graph['@graph'] as Record<string, unknown>[]
  const byType = (t: string) => nodes.filter((n) => n['@type'] === t)

  it('artist node: MusicGroup with genre, location, https social sameAs + spotify, description from resolveSeo', () => {
    const [a] = byType('MusicGroup')
    expect(a['@id']).toBe(`${ORIGIN}/#artist`)
    expect(a.genre).toEqual(['House', 'Techno'])
    expect(a.foundingLocation).toEqual({ '@type': 'Place', name: 'Chicago' })
    expect(a.sameAs).toEqual(['https://instagram.com/skeen', 'https://open.spotify.com/artist/abc123'])
    // The WHOLE bio (collapsed), not the 160-char meta description: this is the text AI answers quote.
    expect(a.description).toBe('Chicago DJ, producer and filmmaker. Second paragraph.')
    const long = jsonLdGraph(payload({ artist: { ...payload().artist, bio: 'x'.repeat(400) } }), { origin: ORIGIN })['@graph'][0] as Record<string, unknown>
    expect((long.description as string).length).toBe(400)
    expect(a.image).toBe('https://cdn.example.com/logo.png')
  })
  it('Person when the artist says so — with homeLocation, where a MusicGroup has foundingLocation', () => {
    const g = jsonLdGraph(payload({ artist: { ...payload().artist, schema_type: 'Person' } }), { origin: ORIGIN })
    const p = g['@graph'][0] as Record<string, unknown>
    expect(p['@type']).toBe('Person')
    expect(p.homeLocation).toEqual({ '@type': 'Place', name: 'Chicago' })
    expect(p.foundingLocation).toBeUndefined()
    // schema.org defines neither genre nor logo on Person — the validator flags both.
    expect(p.genre).toBeUndefined()
    expect(p.logo).toBeUndefined()
    expect(byType('MusicGroup')[0].homeLocation).toBeUndefined()
  })
  it('CRITICAL: VideoObject only when Google\'s required fields are all known — uploadDate is the PLATFORM publish date (never the day it was added); SoundCloud is audio', () => {
    const g = jsonLdGraph(payload(), { origin: ORIGIN, videoUrl: (p) => `https://cdn.example.com/videos/${p}`, videoPoster: (v) => (v.id === 'v2' ? 'https://cdn.example.com/poster.jpg' : null) })
    const vids = (g['@graph'] as Record<string, unknown>[]).filter((n) => n['@type'] === 'VideoObject')
    expect(vids).toEqual([
      { '@type': 'VideoObject', name: 'Night Drive (live)', description: 'Night Drive (live) by Skeen', thumbnailUrl: 'https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg', uploadDate: '2026-05-01T00:00:00.000Z', embedUrl: 'https://www.youtube.com/embed/abc123XYZ', creator: { '@id': `${ORIGIN}/#artist` } },
      { '@type': 'VideoObject', name: 'Studio', description: 'Studio by Skeen', thumbnailUrl: 'https://cdn.example.com/poster.jpg', uploadDate: '2026-05-02T00:00:00.000Z', contentUrl: 'https://cdn.example.com/videos/a1/videos/studio.mp4', creator: { '@id': `${ORIGIN}/#artist` } },
    ])
    // No poster hook → the upload has no thumbnail → not stated.
    expect(byType('VideoObject').map((v) => v.name)).toEqual(['Night Drive (live)'])
  })
  it('CRITICAL: songs are NESTED in their album (track[] of MusicRecording), never loose in the graph', () => {
    expect(byType('MusicRecording')).toEqual([])
    const [alb] = byType('MusicAlbum')
    expect((alb.track as Record<string, unknown>[]).map((t) => t['@type'])).toEqual(['MusicRecording'])
  })
  it('CRITICAL: one MusicEvent per DATED UPCOMING show WITH a city — none for past, undated, city-less (no address to state), or manager-marked-past', () => {
    const events = byType('MusicEvent')
    expect(events.length).toBe(1)
    const [e] = events
    expect(e.name).toBe('Skeen at Smartbar, Chicago')
    expect(e.startDate).toBe('2026-09-10')
    expect(e.location).toEqual({ '@type': 'Place', name: 'Smartbar', address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'IL', addressCountry: 'US' } })
    expect(e.offers).toEqual({ '@type': 'Offer', url: 'https://tix.example.com/1', availability: 'https://schema.org/InStock' })
    expect(e.performer).toEqual([{ '@id': `${ORIGIN}/#artist` }, { '@type': 'MusicGroup', name: 'Jigitz' }])
  })
  it('without `today`, is_past decides', () => {
    const g = jsonLdGraph(payload({ tour_dates: [{ id: 'x', date: '2020-01-01', venue: 'V', city: 'C', country: 'US', ticket_url: null, is_past: true }, { id: 'y', date: '2020-01-02', venue: 'V', city: 'C', country: 'US', ticket_url: null, is_past: false }] }), { origin: ORIGIN })
    expect((g['@graph'] as Record<string, unknown>[]).filter((n) => n['@type'] === 'MusicEvent').map((n) => n.startDate)).toEqual(['2020-01-02'])
  })
  it('MusicAlbum per release with its songs, type, cover, https sameAs + spotify', () => {
    const [alb] = byType('MusicAlbum')
    expect(alb.name).toBe('Night Drive EP')
    expect(alb.datePublished).toBe('2026-06-01')
    expect(alb.albumReleaseType).toBe('https://schema.org/EPRelease')
    expect(alb.sameAs).toEqual(['https://music.apple.com/x', 'https://open.spotify.com/album/alb1'])
    expect(alb.numTracks).toBeUndefined() // the wire carries on-site songs only; a count would be a fact about the page
    expect((alb.track as Record<string, unknown>[])[0]).toMatchObject({ '@type': 'MusicRecording', name: 'Night Drive', url: 'https://open.spotify.com/track/1' })
  })
  it('CRITICAL: a record-shaped links map still works, and junk values never throw', () => {
    const g = jsonLdGraph(payload(), { origin: ORIGIN, releases: [{ id: 'r9', title: 'X', cover_url: null, release_date: null, links: { apple: 'https://music.apple.com/y', junk: { nested: true } as unknown as string } }] })
    const alb = (g['@graph'] as Record<string, unknown>[]).find((n) => n['@type'] === 'MusicAlbum')!
    expect(alb.sameAs).toEqual(['https://music.apple.com/y'])
    expect(() => jsonLdGraph(payload({ site_content: { og_image: 42 as unknown as string } }), { origin: ORIGIN })).not.toThrow()
  })
  it('no releases passed → no albums', () => {
    const g = jsonLdGraph(payload(), { origin: ORIGIN })
    expect((g['@graph'] as Record<string, unknown>[]).some((n) => n['@type'] === 'MusicAlbum')).toBe(false)
  })
  it('CRITICAL: images are the ones the SITE lists, at the src it renders — photo → ImageObject with the alt, artwork → VisualArtwork, unplaced/none/logo → left out', () => {
    expect(byType('ImageObject')).toEqual([{ '@type': 'ImageObject', contentUrl: 'https://cdn.example.com/render/a1/gallery/skeen-oslo.jpg?w=600', caption: 'Skeen, Oslo', creditText: 'Skeen' }])
    expect(byType('VisualArtwork')).toEqual([{ '@type': 'VisualArtwork', name: 'Blue Study by Skeen', image: 'https://cdn.example.com/render/a1/gallery/blue-study.jpg?w=600', creator: { '@id': `${ORIGIN}/#artist` } }])
    expect(nodes.some((n) => JSON.stringify(n).includes('ornament') || JSON.stringify(n).includes('logo.png') && n['@type'] !== 'MusicGroup')).toBe(false)
  })
  it('no listImage → no image nodes at all', () => {
    const g = jsonLdGraph(payload(), { origin: ORIGIN })
    expect((g['@graph'] as Record<string, unknown>[]).some((n) => n['@type'] === 'ImageObject' || n['@type'] === 'VisualArtwork')).toBe(false)
  })
  it('WebSite links back to the artist', () => {
    expect(byType('WebSite')[0]).toEqual({ '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/`, name: 'Skeen', publisher: { '@id': `${ORIGIN}/#artist` }, inLanguage: 'en' })
  })
  it('CRITICAL: jsonLdScript escapes < so a caption cannot close the script tag', () => {
    expect(jsonLdScript({ x: '</script><script>alert(1)</script>' })).not.toContain('</script>')
    expect(jsonLdScript({ x: '<' })).toContain('\\u003c')
  })
  it('sameAsFrom drops non-social and non-https links', () => {
    expect(sameAsFrom(payload({ artist: { ...payload().artist, spotify_artist_id: null } }))).toEqual(['https://instagram.com/skeen'])
  })
})

describe('sitemap + robots', () => {
  it('CRITICAL: lastmod is the newest publish OR the newest show that has passed — never the clock', () => {
    expect(lastModifiedFrom(payload(), '2026-08-26')?.toISOString()).toBe('2026-08-20T12:00:00.000Z')
    // A show passed after the last publish: the page changed (Upcoming → Past) with no publish.
    expect(lastModifiedFrom(payload({ published_at: '2026-07-01T00:00:00.000Z' }), '2026-08-26')?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    // On the DAY of a show it is still upcoming on the page, so it must not count yet.
    expect(lastModifiedFrom(payload({ published_at: '2026-07-01T00:00:00.000Z' }), '2026-08-01')?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    // Same inputs, same answer — and no `today` means no show can count.
    expect(lastModifiedFrom(payload({ published_at: '2026-07-01T00:00:00.000Z' }))?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(lastModifiedFrom({ published_at: null, tour_dates: [] })).toBeUndefined()
  })
  it('entries: the homepage plus declared pages, all stamped the same', () => {
    const e = sitemapEntries(payload(), { origin: ORIGIN, pages: ['/about'], today: '2026-08-26' })
    expect(e.map((x) => x.url)).toEqual([`${ORIGIN}/`, `${ORIGIN}/about`])
    expect(e[1].lastModified).toEqual(e[0].lastModified)
    expect(e[0].priority).toBe(1)
  })
  it('CRITICAL: robots allows everything — /edit is NOT disallowed, or Google never fetches it and never sees its noindex', () => {
    expect(robotsRules(ORIGIN)).toEqual({ rules: [{ userAgent: '*', allow: '/', disallow: [] }], sitemap: `${ORIGIN}/sitemap.xml`, host: ORIGIN })
  })
  it('sameAs: profile pages only', () => {
    for (const ok of ['https://open.spotify.com/artist/abc', 'https://soundcloud.com/skeen', 'https://www.youtube.com/@skeen', 'https://youtube.com/channel/UCx', 'https://instagram.com/skeen', 'https://music.apple.com/us/artist/skeen/1'])
      expect(isProfileUrl(ok), ok).toBe(true)
    for (const no of ['https://open.spotify.com/playlist/x', 'https://open.spotify.com/track/x', 'https://soundcloud.com/skeen/sets/mix', 'https://www.youtube.com/watch?v=x', 'https://instagram.com/p/abc'])
      expect(isProfileUrl(no), no).toBe(false)
  })
  it('auditGeoFacts: a MusicGroup without genre or location is a finding; a Person needs only a location', () => {
    expect(auditGeoFacts({ '@graph': [{ '@type': 'MusicGroup', name: 'S' }] }).map((f) => f.rule)).toEqual(['facts-geo', 'facts-geo'])
    expect(auditGeoFacts({ '@graph': [{ '@type': 'MusicGroup', name: 'S', genre: 'House', foundingLocation: { '@type': 'Place', name: 'Chicago' } }] })).toEqual([])
    expect(auditGeoFacts({ '@graph': [{ '@type': 'Person', name: 'S', homeLocation: { '@type': 'Place', name: 'Oslo' } }] })).toEqual([])
    expect(auditGeoFacts({ '@graph': [] })[0].problem).toContain('no artist node')
  })
  it('SEO_RULES is the registry every list derives from', () => {
    expect(SEO_RULES.map((r) => r.rule)).toEqual(expect.arrayContaining(['description', 'robots', 'facts', 'facts-geo', 'bio-visible', 'other']))
  })
})

describe('aboutPlacement', () => {
  const about = { placements: ['home', 'page'] as const, default: 'page' as const }
  it("the manager's choice when the site supports it", () => {
    expect(aboutPlacement({ site_content: { about_placement: 'home' } }, about)).toBe('home')
    expect(aboutPlacement({ site_content: { about_placement: 'hidden' } }, about)).toBe('hidden')
  })
  it("CRITICAL: the SITE's default when unset — skeen removed its bio on purpose", () => {
    expect(aboutPlacement({ site_content: {} }, about)).toBe('page')
  })
  it('a choice the site does not declare falls back to the default; no declaration = hidden', () => {
    expect(aboutPlacement({ site_content: { about_placement: 'home' } }, { placements: ['page'], default: 'page' })).toBe('page')
    expect(aboutPlacement({ site_content: { about_placement: 'home' } }, null)).toBe('hidden')
  })
})

describe('the FAQ sheet (AI visibility)', () => {
  it('CRITICAL: the five prompts are frozen and never carry a fact the site should teach', () => {
    const p = probePrompts('Skeen', 'MusicGroup')
    expect(p).toHaveLength(5)
    expect(p[0]).toBe('Who is Skeen, the musician?')
    expect(probePrompts('Wren', 'Person')[0]).toBe('Who is Wren, the artist?')
    for (const q of p) expect(q).not.toMatch(/Chicago|house|techno/i)
  })
  it('answers pair with their prompt by number; blanks are left out; none = no sheet', () => {
    const p = payload({ site_content: { faq_answer_1: ' Skeen is a Chicago DJ. ', faq_answer_3: 'Smartbar, Sept 10.' } })
    expect(faqEntries(p)).toEqual([
      { question: 'Who is Skeen, the musician?', answer: 'Skeen is a Chicago DJ.' },
      { question: 'When is Skeen playing next?', answer: 'Smartbar, Sept 10.' },
    ])
    expect(faqPageJsonLd(payload(), { origin: ORIGIN })).toBeNull()
    const sheet = faqPageJsonLd(p, { origin: ORIGIN })!
    const page = (sheet['@graph'] as Record<string, unknown>[])[0]
    expect(page['@type']).toBe('FAQPage')
    expect(page.url).toBe(`${ORIGIN}/faqsheet`)
    expect(page.about).toEqual({ '@id': `${ORIGIN}/#artist` })
    expect((page.mainEntity as Record<string, unknown>[]).map((q) => q['@type'])).toEqual(['Question', 'Question'])
  })
})
