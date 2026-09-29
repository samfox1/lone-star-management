/**
 * "Facts are true": profiles, apple, shows, releases, card. The LIVE fact card compared to
 * what Tapir published (`known.published`) where the comparison is the claim.
 */
import { describe, expect, it } from 'vitest'
import { FACTS_TESTS } from '@/lib/seo-tests/facts'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import type { SeoTestResult } from '@/lib/seo-tests/types'
import { ORIGIN, PROFILES, artistNode, evidence, graphBlock, healthyGraph, homeHtml, known, ldScript, page, type Graph } from './_page-fixture'

const ev = (r: SeoTestResult, label: string) => r.evidence.find((e) => e.label === label)?.value
const JARGON = /json-ld|\bmeta\b|og:|canonical|schema|@type|sameAs/i
function plain(r: SeoTestResult) {
  expect(r.value.length).toBeLessThanOrEqual(28)
  expect(r.sentence).not.toMatch(JARGON)
  if (r.status === 'fail') expect(r.sentence).toMatch(/^(?:[a-z0-9]|Apple)/)
  if (r.todo) expect(r.todo).not.toMatch(JARGON)
}
const withGraph = (graph: Graph, more: Parameters<typeof evidence>[0] = {}) => evidence({ home: homeHtml({ ld: [graphBlock(graph)] }), ...more })
const graphWith = (i: number, node: Record<string, unknown> | null): Graph => {
  const g = healthyGraph()
  if (node === null) g.splice(i, 1)
  else g[i] = node
  return g
}

describe('FACTS_TESTS', () => {
  it('covers exactly the "facts" ids in defs.ts', () => {
    const ids = SEO_TEST_DEFS.filter((d) => d.group === 'facts').map((d) => d.id).sort()
    expect(Object.keys(FACTS_TESTS).sort()).toEqual(ids)
  })
  it('is unknown for every test when the home page did not answer', () => {
    for (const [id, test] of Object.entries(FACTS_TESTS)) {
      const r = test(evidence({ pages: [page('/', null, null, { error: 'timeout' })] }))
      expect(r.id).toBe(id)
      expect(r.status).toBe('unknown')
    }
  })
})

describe('profiles', () => {
  const p = FACTS_TESTS.profiles
  it('passes when the fact card lists exactly the profiles Tapir published (tracking and slashes ignored)', () => {
    const r = p(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('4 of 4')
    expect(r.limits).toMatch(/open/i)
    plain(r)
  })
  it('fails a profile Tapir has that the card is missing, naming it', () => {
    const k = known({}, { links: [...known().published!.links, { label: 'Bandcamp', url: 'https://skeen.bandcamp.com/', onSite: false }] })
    const r = p(evidence({ known: k }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('4 of 5')
    expect(ev(r, 'in Tapir: not on your site')).toMatch(/skeen\.bandcamp\.com/)
    plain(r)
  })
  it('CRITICAL: the Spotify profile a site adds from the artist id is one Tapir published, not "not in Tapir"', () => {
    // Tapir's links hold no Spotify profile; the bridge writes it into the card from the id alone.
    const k = known({}, { links: known().published!.links.filter((l) => l.url !== PROFILES[0]), spotifyArtistId: '26KxuQlgIw8VP8YX2IkMWR' })
    const r = p(evidence({ known: k }))
    expect(r.status).toBe('pass')
    expect(r.value).toBe('4 of 4')
    expect(ev(r, 'not in Tapir')).toBeUndefined()
  })
  it('names a Spotify profile Tapir has (from the id) that the card is missing', () => {
    const k = known({}, { spotifyArtistId: 'Zq0Other0Id' })
    const r = p(evidence({ known: k }))
    expect(r.status).toBe('fail')
    expect(ev(r, 'in Tapir: not on your site')).toMatch(/open\.spotify\.com\/artist\/Zq0Other0Id/)
  })
  it('fails a profile on the card that Tapir does not have', () => {
    const r = p(withGraph(graphWith(0, artistNode({ sameAs: [...PROFILES, 'https://www.tiktok.com/@skeen200'] }))))
    expect(r.status).toBe('fail')
    expect(ev(r, 'not in Tapir')).toMatch(/tiktok\.com\/@skeen200/)
  })
  it('fails a link on the card that is not a profile page (a playlist)', () => {
    const r = p(withGraph(graphWith(0, artistNode({ sameAs: [...PROFILES, 'https://open.spotify.com/playlist/37i9dQZF1DX'] }))))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/profile page/)
  })
  it('fails the same profile listed twice, however it is spelled', () => {
    const r = p(withGraph(graphWith(0, artistNode({ sameAs: [...PROFILES, 'https://instagram.com/skeeeeeeen?utm_source=ig'] }))))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/twice/)
  })
  it('reads a single sameAs string', () => {
    const k = known({}, { links: [{ label: 'Spotify', url: PROFILES[0], onSite: true }] })
    expect(p(withGraph(graphWith(0, artistNode({ sameAs: PROFILES[0] })), { known: k })).status).toBe('pass')
  })
  it('fails when there are no profiles at all, pointing to Connections', () => {
    const r = p(withGraph(graphWith(0, artistNode({ sameAs: undefined })), { known: known({}, { links: [] }) }))
    expect(r.status).toBe('fail')
    expect(r.action).toEqual(expect.objectContaining({ target: 'connections' }))
  })
  it('fails when the card has no artist but Tapir has profiles', () => {
    expect(p(evidence({ home: homeHtml({ ld: [] }) })).status).toBe('fail')
  })
  it('is unknown without published data (nothing to compare to)', () => {
    const r = p(evidence({ known: known({ published: null }) }))
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/haven’t published from Tapir/)
  })
})

describe('apple', () => {
  const a = FACTS_TESTS.apple
  const norway = 'https://music.apple.com/no/artist/skeen/1754431714'
  /** The card names `url` as the Apple link (null = none), the artist's country (null = not
   *  said), and Tapir's own Apple link is that same url. */
  const cardApple = (url: string | null, country: unknown = 'US', body = '', tapir: { country: string; countryCode: string | null } | null = null) => {
    const loc = { '@type': 'Place', address: { addressLocality: 'Chicago', addressRegion: 'IL', ...(country === null ? {} : { addressCountry: country }) } }
    const sameAs = url ? [PROFILES[0], url] : [PROFILES[0]]
    const links = known().published!.links.map((l) => (l.label === 'Apple Music' ? { ...l, url: url ?? l.url } : l))
    return evidence({
      home: homeHtml({ ld: [graphBlock([artistNode({ sameAs, foundingLocation: loc })])], body }).replace(/<a href="https:\/\/music\.apple\.com[^"]*">Apple Music<\/a>/, ''),
      // Tapir's own country: none unless a test gives one, so the card's is what these read.
      known: known({}, { links, country: tapir?.country ?? null, countryCode: tapir?.countryCode ?? null }),
    })
  }
  const US = { country: 'United States', countryCode: 'US' }
  it('passes an Apple link on the store of the country the artist is based in', () => {
    const r = a(evidence())
    expect(r.status).toBe('pass')
    plain(r)
  })
  it('fails a Norway-store link for a US artist, with a one-click fix to the US store', () => {
    const r = a(cardApple(norway))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
    expect(r.sentence).toMatch(/Norway/)
    expect(r.action).toEqual({ kind: 'fix', fix: 'apple-storefront', label: expect.any(String) })
    expect(ev(r, 'in Tapir: after the fix')).toBe('https://music.apple.com/us/artist/skeen/1754431714')
    plain(r)
  })
  it('offers no one-click fix for a link that is not in Tapir (the site hard-codes it)', () => {
    const e = cardApple(norway)
    e.known = known()
    const r = a(e)
    expect(r.status).toBe('fail')
    expect(r.action?.kind).not.toBe('fix')
    expect(r.todo).toMatch(/isn’t from Tapir/)
  })
  it('passes a Norway-store link for a Norway-based artist (code or name)', () => {
    expect(a(cardApple(norway, 'NO')).status).toBe('pass')
    expect(a(cardApple(norway, 'Norway')).status).toBe('pass')
    expect(a(cardApple(norway, { '@type': 'Country', name: 'Norway' })).status).toBe('pass')
  })
  it('is unknown when neither Tapir nor the site says which country the artist is in', () => {
    const r = a(cardApple(norway, null))
    expect(r.status).toBe('unknown')
    expect(r.action).toEqual(expect.objectContaining({ target: 'facts' }))
  })
  it('CRITICAL: where you’re based comes from the Facts you published in Tapir first (a card on an older bridge states no country)', () => {
    const r = a(cardApple(norway, null, '', US))
    expect(r.status).toBe('fail')
    expect(r.action).toEqual(expect.objectContaining({ kind: 'fix' }))
    expect(ev(r, 'in Tapir: you’re based in')).toBe('US = the United States')
    plain(r)
  })
  it('CRITICAL: Tapir’s country wins over a card that says otherwise, and both are shown', () => {
    const r = a(cardApple(norway, 'US', '', { country: 'Norway', countryCode: 'NO' }))
    expect(r.status).toBe('pass')
    expect(ev(r, 'in Tapir: you’re based in')).toBe('NO = Norway')
    expect(ev(r, 'fact card: based in')).toBe('US = the United States')
  })
  it('falls back to the card’s country when Tapir has none, labelled as the site’s', () => {
    const r = a(cardApple('https://music.apple.com/us/artist/skeen/1754431714', 'CA'))
    expect(ev(r, 'fact card: based in')).toBe('CA = Canada')
    expect(r.evidence.some((e) => /^in Tapir: you/.test(e.label))).toBe(false)
  })
  it('a country Tapir holds that no table knows is read by its English name, else not used', () => {
    expect(a(cardApple(norway, null, '', { country: 'Norway', countryCode: null })).status).toBe('pass')
    expect(a(cardApple(norway, null, '', { country: 'Atlantis', countryCode: null })).status).toBe('unknown')
  })
  it('fails a US-store link for a Canadian artist, without the US-only one-click fix', () => {
    const r = a(cardApple('https://music.apple.com/us/artist/skeen/1754431714', 'CA'))
    expect(r.status).toBe('fail')
    expect(r.action?.kind).not.toBe('fix')
    expect(r.todo).toMatch(/Canada store/)
  })
  it('passes a link with no store in it (Apple picks the fan’s store)', () => {
    expect(a(cardApple('https://music.apple.com/artist/1754431714', null)).status).toBe('pass')
    expect(a(cardApple('https://geo.music.apple.com/artist/skeen/1754431714', null)).status).toBe('pass')
  })
  it('CRITICAL: does not apply (`na`) when the site has no Apple Music link: no store to get wrong is not a pass', () => {
    const r = a(cardApple(null))
    expect(r.status).toBe('na')
    expect(r.value).toMatch(/no Apple/i)
    // The page writes "Doesn't apply:" in front; the sentence gives the reason, not an echo.
    expect(r.sentence).toMatch(/no Apple Music link/)
    expect(r.action).toBeUndefined()
  })
  it('reads Apple links the page shows as buttons too, not only the card', () => {
    const r = a(cardApple(null, 'US', `<a href="${norway}?l=nb">Apple Music</a>`))
    expect(r.status).toBe('fail')
  })
  it('names the one wrong link among several', () => {
    const r = a(cardApple(norway, 'US', '<a href="https://music.apple.com/us/artist/skeen/1754431714">Apple</a>'))
    expect(r.status).toBe('fail')
    expect(ev(r, 'link')).toMatch(/\/no\//)
  })
})

describe('shows', () => {
  const s = FACTS_TESTS.shows
  const event = (startDate: string, city = 'Chicago', more: Record<string, unknown> = {}) => ({
    '@type': 'MusicEvent', name: `Skeen at X, ${city}`, startDate, location: { '@type': 'Place', name: 'X', address: { '@type': 'PostalAddress', addressLocality: city } }, ...more,
  })
  it('passes when the upcoming shows match Tour and nothing old is listed as coming up', () => {
    const r = s(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('1 upcoming')
    plain(r)
  })
  it('fails a past show still listed as coming up', () => {
    const r = s(withGraph([...healthyGraph(), event('2026-09-01')]))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/past show/)
    expect(ev(r, 'past, listed as coming up')).toMatch(/Sep 1, 2026/)
    plain(r)
  })
  it('treats a show today as upcoming, and one still running (end date) as not old', () => {
    const k = known({}, { tourDates: [{ date: '2026-10-15', venue: 'Smartbar', city: 'Chicago', isPast: false }, { date: '2026-09-28', venue: 'X', city: 'Chicago', isPast: false }, { date: '2026-09-27', venue: 'Fest', city: 'Chicago', isPast: false }] })
    const r = s(withGraph([...healthyGraph(), event('2026-09-28'), event('2026-09-27', 'Chicago', { endDate: '2026-09-29' })], { known: k }))
    expect(r.status).toBe('pass')
  })
  it('does not count a cancelled past show as listed as coming up', () => {
    const r = s(withGraph([...healthyGraph(), event('2026-09-01', 'Chicago', { eventStatus: 'https://schema.org/EventCancelled' })]))
    expect(r.status).toBe('pass')
    expect(ev(r, 'past, listed as coming up')).toBeUndefined()
  })
  it('fails an upcoming Tour show missing from the site', () => {
    const k = known({}, { tourDates: [...known().published!.tourDates, { date: '2026-11-01', venue: 'Miramar', city: 'Milwaukee', isPast: false }] })
    const r = s(evidence({ known: k }))
    expect(r.status).toBe('fail')
    expect(ev(r, 'in Tapir: in Tour, not on your site')).toMatch(/Milwaukee/)
  })
  it('does not expect a show with no city (search engines need a place), but says so', () => {
    const k = known({}, { tourDates: [...known().published!.tourDates, { date: '2026-11-01', venue: 'TBA', city: null, isPast: false }] })
    const r = s(evidence({ known: k }))
    expect(r.status).toBe('pass')
    expect(ev(r, 'in Tapir: left out (no city)')).toMatch(/Nov 1, 2026/)
  })
  it('fails a show on the site that Tour does not have, like one marked past or cancelled', () => {
    const k = known({}, { tourDates: [{ date: '2026-10-15', venue: 'Smartbar', city: 'Chicago', isPast: true }] })
    const r = s(evidence({ known: k }))
    expect(r.status).toBe('fail')
    expect(ev(r, 'on your site, not in Tour')).toMatch(/Oct 15, 2026/)
  })
  it('passes with no shows anywhere, saying none are booked', () => {
    const r = s(withGraph(graphWith(2, null), { known: known({}, { tourDates: [] }) }))
    expect(r.status).toBe('pass')
    expect(r.value).toBe('none booked')
  })
  it('matches a start given with a time and zone', () => {
    expect(s(withGraph(graphWith(2, event('2026-10-15T21:00:00-05:00'))))).toEqual(expect.objectContaining({ status: 'pass' }))
  })
  it('is unknown without published data, or with a card that cannot be read', () => {
    expect(s(evidence({ known: known({ published: null }) })).status).toBe('unknown')
    expect(s(evidence({ home: homeHtml({ ld: ['<script type="application/ld+json">{oops</script>'] }) })).status).toBe('unknown')
    expect(s(evidence({ known: known({ today: 'soon' }) })).status).toBe('unknown')
  })
})

describe('releases', () => {
  const r = FACTS_TESTS.releases
  it('passes when every published release is on the card, naming the newest', () => {
    const out = r(evidence())
    expect(out.status).toBe('pass')
    expect(out.value).toBe('3 releases')
    expect(out.sentence).toMatch(/You Were There/)
    plain(out)
  })
  it('fails when the newest release is missing, naming it', () => {
    const out = r(withGraph(graphWith(3, null)))
    expect(out.status).toBe('fail')
    expect(out.sentence).toMatch(/newest/)
    expect(out.sentence).toMatch(/You Were There/)
    expect(out.action).toEqual(expect.objectContaining({ target: 'music' }))
    plain(out)
  })
  it('fails when an older release is missing', () => {
    const out = r(withGraph(graphWith(5, null)))
    expect(out.status).toBe('fail')
    expect(out.value).toBe('2 of 3')
  })
  it('fails a release on the card that Music does not have', () => {
    const g = [...healthyGraph(), { '@type': 'MusicAlbum', name: 'Deleted EP', byArtist: { '@id': `${ORIGIN}/#artist` } }]
    const out = r(withGraph(g))
    expect(out.status).toBe('fail')
    expect(ev(out, 'not in Music')).toMatch(/Deleted EP/)
  })
  it('matches titles whatever their case and spacing, and counts repeated titles', () => {
    const g = graphWith(4, { '@type': 'MusicAlbum', name: 'heatwaves  &  horizons', byArtist: { '@id': 'x' } })
    expect(r(withGraph(g)).status).toBe('pass')
    const twice = known({}, { releases: [...known().published!.releases, { title: 'OutWest', releasedOn: '2024-02-01' }] })
    expect(r(evidence({ known: twice })).status).toBe('fail')
  })
  it('fails when there are no releases anywhere, pointing to Music', () => {
    const g = healthyGraph().slice(0, 3)
    const out = r(withGraph(g, { known: known({}, { releases: [] }) }))
    expect(out.status).toBe('fail')
    expect(out.action).toEqual(expect.objectContaining({ target: 'music' }))
  })
  it('CRITICAL: does not apply (`na`) to a visual artist with no releases anywhere', () => {
    const g = healthyGraph().slice(0, 3)
    const out = r(withGraph(g, { known: known({}, { releases: [], artistType: 'Person' }) }))
    expect(out.status).toBe('na')
    expect(out.sentence).toMatch(/visual artist/)
  })
  it('a visual artist whose card lists a release Music doesn’t have still fails (a look found something)', () => {
    const out = r(evidence({ known: known({}, { releases: [], artistType: 'Person' }) }))
    expect(out.status).toBe('fail')
    expect(ev(out, 'not in Music')).toMatch(/You Were There/)
  })
  it('names what Tapir has that the card is missing as Tapir’s', () => {
    const out = r(withGraph(graphWith(5, null)))
    expect(ev(out, 'in Tapir: not on your site')).toBe('OutWest')
  })
  it('CRITICAL: fails a release the fact card lists that no page shows (skeen, 2026-09-29: “Home Again” on the card, not on the page)', () => {
    const g = [...healthyGraph(), { '@type': 'MusicAlbum', name: 'Home Again', byArtist: { '@id': `${ORIGIN}/#artist` }, datePublished: '2025-04-18' }]
    const k = known({}, { releases: [...known().published!.releases, { title: 'Home Again', releasedOn: '2025-04-18' }] })
    const out = r(withGraph(g, { known: k }))
    expect(out.status).toBe('fail')
    expect(out.sentence).toMatch(/Home Again/)
    expect(ev(out, 'on your fact card, not on your pages')).toBe('Home Again')
    plain(out)
  })
  it('counts a release a page shows only as a cover picture’s description (a cover grid)', () => {
    const g = [...healthyGraph(), { '@type': 'MusicAlbum', name: 'Home Again', byArtist: { '@id': `${ORIGIN}/#artist` } }]
    const k = known({}, { releases: [...known().published!.releases, { title: 'Home Again', releasedOn: '2025-04-18' }] })
    const out = r(evidence({ home: homeHtml({ ld: [graphBlock(g)], body: '<img src="/c/home-again.jpg" alt="Home Again cover art">' }), known: k }))
    expect(out.status).toBe('pass')
  })
  it('matches whole words: a short title (“Up”) is not found inside another word (“upcoming”)', () => {
    const g = [...healthyGraph(), { '@type': 'MusicAlbum', name: 'Up', byArtist: { '@id': `${ORIGIN}/#artist` } }]
    const k = known({}, { releases: [...known().published!.releases, { title: 'Up', releasedOn: null }] })
    // No /about page: the fixture's bio says "from the ground up", and "up" there IS the word.
    const hidden = r(evidence({ home: homeHtml({ ld: [graphBlock(g)], body: '<p>Upcoming shows soon.</p>' }), about: null, known: k }))
    expect(hidden.status).toBe('fail')
    expect(ev(hidden, 'on your fact card, not on your pages')).toBe('Up')
    expect(r(evidence({ home: homeHtml({ ld: [graphBlock(g)], body: '<p>New single: Up.</p>' }), known: k })).status).toBe('pass')
  })
  it('is unknown when a listed release is not on the pages read and a page could not be read', () => {
    const g = [...healthyGraph(), { '@type': 'MusicAlbum', name: 'Home Again', byArtist: { '@id': `${ORIGIN}/#artist` } }]
    const k = known({}, { releases: [...known().published!.releases, { title: 'Home Again', releasedOn: '2025-04-18' }] })
    const out = r(evidence({ pages: [page('/', homeHtml({ ld: [graphBlock(g)] })), page('/music', null, null, { error: 'timeout' })], known: k }))
    expect(out.status).toBe('unknown')
  })
  it('is unknown without published data', () => {
    expect(r(evidence({ known: known({ published: null }) })).status).toBe('unknown')
  })
})

describe('card', () => {
  const c = FACTS_TESTS.card
  it('passes when every block on every page parses and has what each type needs', () => {
    const out = c(evidence())
    expect(out.status).toBe('pass')
    expect(ev(out, '/')).toMatch(/MusicGroup · WebSite · MusicEvent · 3 MusicAlbum/)
    plain(out)
  })
  it('fails a block that does not parse, saying which page', () => {
    const out = c(evidence({ home: homeHtml({ ld: [graphBlock(healthyGraph()), '<script type="application/ld+json">{"@context":"https://schema.org",</script>'] }) }))
    expect(out.status).toBe('fail')
    expect(ev(out, 'problems')).toMatch(/\/: block 2 can’t be read/)
    plain(out)
  })
  it('fails an empty card (the bridge writes one for an artist with no name)', () => {
    expect(c(evidence({ home: homeHtml({ ld: [ldScript({ '@context': 'https://schema.org', '@graph': [] })] }) })).status).toBe('fail')
    expect(c(evidence({ home: homeHtml({ ld: ['<script type="application/ld+json">   </script>'] }) })).status).toBe('fail')
  })
  it('fails a home page with no card, or no artist in it', () => {
    expect(c(evidence({ home: homeHtml({ ld: [] }) })).status).toBe('fail')
    expect(c(withGraph(graphWith(0, null))).status).toBe('fail')
  })
  it('fails a node missing a field its type needs, naming it', () => {
    const out = c(withGraph(graphWith(3, { '@type': 'MusicAlbum', name: 'You Were There' })))
    expect(out.status).toBe('fail')
    expect(ev(out, 'problems')).toMatch(/MusicAlbum.*byArtist/)
    expect(c(withGraph(graphWith(0, artistNode({ url: undefined })))).status).toBe('fail')
  })
  it('fails a show whose place has no address, and a song with no name', () => {
    const show = { '@type': 'MusicEvent', name: 'x', startDate: '2026-10-15', location: { '@type': 'Place', name: 'Smartbar' } }
    expect(c(withGraph(graphWith(2, show))).status).toBe('fail')
    const album = { '@type': 'MusicAlbum', name: 'A', byArtist: { '@id': 'x' }, track: [{ '@type': 'MusicRecording', byArtist: { '@id': 'x' } }] }
    expect(ev(c(withGraph(graphWith(4, album))), 'problems')).toMatch(/track 1.*name/)
  })
  it('fails a block with no schema.org context', () => {
    expect(c(evidence({ home: homeHtml({ ld: [ldScript({ '@graph': healthyGraph() })] }) })).status).toBe('fail')
  })
  it('reads @graph as one object, and a top-level array of nodes each with a context', () => {
    const ctx = (n: Record<string, unknown>) => ({ '@context': 'https://schema.org', ...n })
    expect(c(evidence({ home: homeHtml({ ld: [ldScript(healthyGraph().map(ctx))] }) })).status).toBe('pass')
    expect(c(evidence({ home: homeHtml({ ld: [ldScript({ '@context': { '@vocab': 'https://schema.org/' }, '@graph': artistNode() })] }) })).status).toBe('pass')
  })
  it('checks every tested page, not only the home page', () => {
    const about = `<html><body><script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicAlbum","name":"x"}</script></body></html>`
    const out = c(evidence({ about }))
    expect(out.status).toBe('fail')
    expect(ev(out, 'problems')).toMatch(/\/about/)
  })
  it('is unknown when a page was cut short and its last block breaks at the cut', () => {
    const cut = homeHtml().replace(/("@type":"MusicAlbum","@id":"[^"]*release-3").*$/, '$1')
    const out = c(evidence({ pages: [page('/', cut, 200, { truncated: true })] }))
    expect(out.status).toBe('unknown')
  })
})
