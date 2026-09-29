/**
 * The independent verifier's repros (scratchpad verify-content.md, 2026-09-29), one per defect
 * id, each written to FAIL on the code it found the defect in. The builders' own suites passed
 * with every one of these defects in place, which is why they live here by id.
 */
import { describe, expect, it } from 'vitest'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import { SHARED_TESTS } from '@/lib/seo-tests/shared'
import { FACTS_TESTS } from '@/lib/seo-tests/facts'
import { countryCode, countryName } from '@/lib/seo-tests/apple-storefront'
import { linkKey } from '@/lib/seo-tests/html'
import type { SeoEvidence, SeoTestResult } from '@/lib/seo-tests/types'
import { ORIGIN, LONG_BIO, PROFILES, aboutHtml, artistNode, evidence, graphBlock, healthyGraph, homeHtml, known, ldScript, page } from './_page-fixture'

const ev = (r: SeoTestResult, label: RegExp) => r.evidence.find((e) => label.test(e.label))?.value
const withGraph = (graph: Record<string, unknown>[], more: Parameters<typeof evidence>[0] = {}) => evidence({ home: homeHtml({ ld: [graphBlock(graph)] }), ...more })
const noApple = (html: string) => html.replace(/<a href="https:\/\/music\.apple\.com[^"]*">Apple Music<\/a>/, '')

/* ── H1: a home page cut at the read cap ── */
describe('H1 a home page we only read part of is "couldn’t check", never a statement', () => {
  const cut = () => evidence({ pages: [page('/', noApple(homeHtml({ ld: [] })), 200, { truncated: true })] })
  it.each(['genre', 'place'] as const)('%s', (id) => {
    const r = WHO_TESTS[id](cut())
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/too big|only part/i)
  })
  it.each(['profiles', 'shows', 'releases', 'card', 'apple'] as const)('%s', (id) => {
    const r = FACTS_TESTS[id](cut())
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/too big|only part/i)
  })
  it('shows: no pass on a cut page even with Tour empty', () => {
    const e = cut()
    e.known = known({}, { tourDates: [] })
    expect(FACTS_TESTS.shows(e).status).toBe('unknown')
  })
  it('still judges a card that WAS read whole before the cut', () => {
    const e = evidence({ pages: [page('/', homeHtml(), 200, { truncated: true })] })
    expect(WHO_TESTS.genre(e).status).toBe('pass')
    expect(WHO_TESTS.place(e).status).toBe('pass')
    expect(FACTS_TESTS.profiles(e).status).toBe('pass')
  })
})

/* ── apple ── */
describe('apple', () => {
  const a = FACTS_TESTS.apple
  const withLinks = (hrefs: string[], country = 'US', tapirApple?: string) => {
    const body = hrefs.map((h) => `<a href="${h}">Apple</a>`).join('')
    const links = known().published!.links.filter((l) => l.label !== 'Apple Music')
    if (tapirApple) links.push({ label: 'Apple Music', url: tapirApple, onSite: false })
    const k = known({}, { links, countryCode: country, country: countryName(country).replace(/^the /, '') })
    return evidence({ home: noApple(homeHtml({ ld: [graphBlock([artistNode({ sameAs: [PROFILES[0]] })])], body })), known: k })
  }
  it('AP1 a pinned ALBUM or SONG link is judged, not passed as "each fan’s own store"', () => {
    for (const u of ['https://music.apple.com/no/album/home-again/1755555555', 'https://music.apple.com/gb/song/home-again/1755555556', 'https://music.apple.com/jp/album/x/1?i=2']) {
      const r = a(withLinks([u]))
      expect(r.status, u).toBe('fail')
      expect(r.sentence).not.toMatch(/each fan/)
    }
  })
  it('AP2 a right artist link does not hide a wrong release link', () => {
    const r = a(withLinks(['https://music.apple.com/us/artist/skeen/1754431714', 'https://music.apple.com/no/album/home-again/1755555555'], 'US', 'https://music.apple.com/us/artist/skeen/1754431714'))
    expect(r.status).toBe('fail')
  })
  it('AP3 no Apple link found while a page could not be read is "couldn’t check", not "doesn’t apply"', () => {
    const home = noApple(homeHtml({ ld: [graphBlock([artistNode({ sameAs: [PROFILES[0]] })])] }))
    const e = evidence({ pages: [page('/', home), page('/music', null, null, { error: 'timeout' })] })
    expect(a(e).status).toBe('unknown')
  })
  it('AP4 another artist’s Apple link on the page is not called "your" link', () => {
    const own = 'https://music.apple.com/us/artist/skeen/1754431714'
    const r = a(withLinks([own, 'https://music.apple.com/gb/artist/four-tet/4628083'], 'US', own))
    expect(r.status).toBe('pass')
    expect(ev(r, /other artists/i)).toMatch(/four-tet/)
  })
  it('AP5 no "the the" in any sentence', () => {
    const own = 'https://music.apple.com/us/artist/skeen/1754431714'
    expect(a(withLinks([own], 'US', own)).sentence).not.toMatch(/the the/i)
    expect(a(withLinks(['https://music.apple.com/us/artist/skeen/1754431714'], 'GB', own)).sentence).not.toMatch(/the the/i)
  })
  it('AP7 "/uk/" is not an Apple store (Apple sends it to /us/): it is not read as the UK store', () => {
    const uk = 'https://music.apple.com/uk/artist/skeen/1754431714'
    const r = a(withLinks([uk], 'GB', uk))
    expect(r.status).toBe('fail')
    expect(r.sentence).not.toMatch(/opens the (the )?United Kingdom store/)
  })
  it('AP8 no "the Czechia"', () => {
    expect(countryName('CZ')).toBe('Czechia')
  })
  it('AP9 common spellings of a country', () => {
    expect(['the United States', 'Turkey', 'Czech Republic', 'Hong Kong', 'México', 'Ivory Coast', 'The Netherlands'].map((c) => countryCode(c))).toEqual(['US', 'TR', 'CZ', 'HK', 'MX', 'CI', 'NL'])
  })
})

/* ── alt ── */
describe('alt', () => {
  const alt = SHARED_TESTS.alt
  const withBody = (body: string) => alt(evidence({ home: homeHtml({ body }), about: null }))
  it('A1 pictures with no src (srcset, lazy loaders) are not merged into one', () => {
    expect(withBody('<img srcset="/a.jpg 1x" alt="Skeen on stage at the Salt Shed"><img srcset="/b.jpg 1x">').status).toBe('fail')
    const lazy = '<img data-lazy-src="/a.jpg" alt="Skeen live"><img data-lazy-src="/b.jpg"><img data-lazy-src="/c.jpg"><img data-lazy-src="/d.jpg">'
    const r = withBody(lazy)
    expect(r.status).toBe('fail')
    expect(r.value).toBe('2 of 5')
    expect(withBody('<img alt="Skeen live at the Salt Shed"><img>').status).toBe('fail')
  })
  it.each(['Image 1', 'photo 3', 'IMG_1234', 'DSC00123', 'image1', '.', '-', 'x', 'undefined', 'null', 'alt text', 'Screen Shot 2026-09-01 at 10.00.00 AM', 'logo'])('A2 "%s" is not a description', (junk) => {
    expect(withBody(`<img src="/j.jpg" alt="${junk}">`).status).toBe('fail')
  })
  it('A2 real short descriptions still count, in any script', () => {
    expect(withBody('<img src="/k.jpg" alt="Skeen DJ set">').status).toBe('pass')
    expect(withBody('<img src="/k.jpg" alt="花火大会">').status).toBe('pass')
  })
  it('A3 the same picture twice: an undescribed copy is still undescribed', () => {
    expect(withBody('<img src="/twice.jpg" alt="Skeen at Smartbar"><img src="/twice.jpg">').status).toBe('fail')
  })
  it('A4 small icons (both sides 48px or less) are not photos', () => {
    expect(withBody('<img src="/ig.svg" width="20" height="20"><img src="/x.svg" width="24" height="24">').status).toBe('pass')
  })
  it('A5 the sentence and limits say how many pages were read', () => {
    const r = alt(evidence())
    expect(r.sentence).toMatch(/2 pages we read/)
    expect(r.limits).toMatch(/pages/)
  })
})

/* ── bio ── */
describe('bio', () => {
  const b = WHO_TESTS.bio
  const straight = 'Skeen\'s "big" night -- the warehouse show in Chicago was loud. He played until the sun came up over the lake.'
  const onPage = (text: string) => evidence({ home: homeHtml({ ld: [] }), about: `<html><body><p>${text}</p></body></html>`, known: known({}, { bio: straight }) })
  it('B1 curly quotes, an em dash, a soft hyphen and a zero-width space on the page still match', () => {
    const typeset = 'Skeen’s “big” night — the ware&shy;house show in Chi​cago was loud. He played until the sun came up over the lake.'
    const r = b(onPage(typeset))
    // Since 2026-09-29 the bio test counts words and facts, not characters: the whole bio is
    // found (every word counted), and its city is read through the zero-width space.
    expect(r.value).toMatch(new RegExp(`^${[...new Intl.Segmenter('und', { granularity: 'word' }).segment(straight)].filter((x) => x.isWordLike).length} words`))
    expect(r.evidence.find((x) => x.label === 'city in your bio')?.value).toBe('Chicago')
  })
  it('B3 a bio not found says it looked only at the pages it read, and limits say how many', () => {
    const r = b(onPage('Nothing about the bio here at all, just other words.'))
    expect(r.sentence).toMatch(/pages? we read/)
    expect(r.limits).toMatch(/pages/)
  })
  it('B4 a Chinese bio half shown counts the half', () => {
    const zh = '我是一名来自芝加哥的音乐制作人和唱片骑师，专注于浩室音乐和科技浩室。我拍摄自己从零开始建立舞曲事业的全部过程和每一场演出。'
    const e = evidence({ home: homeHtml({ ld: [] }), about: `<html><body><p>${zh.split('。')[0]}。</p></body></html>`, known: known({}, { bio: zh }) })
    expect(b(e).value).toMatch(/^[1-9]\d* words/)
  })
  it('B5 one sentence pasted 45 times counts once', () => {
    const s = 'I am a Chicago DJ and producer who plays house music all night.'
    const e = evidence({ home: homeHtml({ ld: [] }), about: `<html><body><p>${s}</p></body></html>`, known: known({}, { bio: Array(45).fill(s).join(' ') }) })
    const r = b(e)
    expect(r.status).toBe('fail')
    expect(r.value).toMatch(/^13 words/)
  })
  it('B6 "no bio" is said about Tapir, not the site', () => {
    const r = b(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ description: undefined })])] }), known: known({}, { bio: null }) }))
    expect(r.sentence).toMatch(/in Tapir/)
  })
})

/* ── mb ── */
describe('mb', () => {
  const m = WHO_TESTS.mb
  it('M1 a MusicBrainz page under another name is not "a page for you"', () => {
    const r = m(evidence({ musicbrainz: { looked: true, artistUrl: 'https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711', matchedOn: 'https://open.spotify.com/artist/x', artistName: 'Radiohead' } }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/Radiohead/)
  })
  it('M2 a Connections link MusicBrainz says doesn’t exist is a fail, not a pass', () => {
    const r = m(evidence({ musicbrainz: { looked: true, artistUrl: null, matchedOn: 'your MusicBrainz link in Connections', fromConnections: true } as SeoEvidence['musicbrainz'] }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/Connections/)
  })
})

/* ── title / desc ── */
describe('title', () => {
  const t = WHO_TESTS.title
  it.each(['Skeen | Page not found', 'Skeen | Coming soon', 'Skeen - Just another WordPress site', 'Skeen | 404'])('T1 "%s" does not say who you are', (title) => {
    expect(t(evidence({ home: homeHtml({ title }) })).status).toBe('fail')
  })
  it('T1 name + a word that is not your city or sound fails softly when Tapir has them', () => {
    const r = t(evidence({ home: homeHtml({ title: 'Skeen | Tickets' }) }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
  })
  it('T2 a title Tapir built from the facts is never called "written on the SEO page"', () => {
    // known.ts fills seoTitle from resolveSeo, so with nothing written it holds the built default.
    const built = 'Skeen · Chicago house musician'
    const r = t(evidence({ home: homeHtml({ title: built }), known: known({}, { seoTitle: built, location: 'Chicago', genre: 'House' }) }))
    expect(r.evidence.map((x) => x.value).join(' ')).not.toMatch(/written on the SEO page/)
    expect(ev(r, /in Tapir/)).toMatch(/built from your facts/)
  })
  it('T3 counts characters, not code units, and never cuts one in half', () => {
    const title = `Skeen · Chicago ${'🎧'.repeat(33)}`
    const r = t(evidence({ home: homeHtml({ title }) }))
    expect(ev(r, /^length$/)).toBe(`${Array.from(title).length} of 70`)
    expect(JSON.stringify(r)).not.toMatch(/\\ud83c(?!\\udfa7)/i)
  })
  it('T4 a name in a script without spaces is found', () => {
    const r = t(evidence({ home: homeHtml({ title: '米津玄師公式サイト · 東京' }), known: known({ artistName: '米津玄師' }, { genre: null, location: null }) }))
    expect(r.status).toBe('pass')
  })
})

describe('desc', () => {
  const d = WHO_TESTS.desc
  it.each([
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.',
    'Taylor Swift is an American singer-songwriter based in Nashville.',
    'house house house house house house house house house house house',
  ])('D1 "%s" is not about you', (description) => {
    expect(d(evidence({ home: homeHtml({ description }) })).status).toBe('fail')
  })
  it('D1 a description naming your city and sound passes without your name', () => {
    expect(d(evidence({ home: homeHtml({ description: 'Chicago DJ and producer playing house and tech house across the Midwest.' }) })).status).toBe('pass')
  })
})

/* ── genre / place / profiles: whose card ── */
describe('genre, place, profiles', () => {
  const other = (over: Record<string, unknown>) => evidence({ home: homeHtml({ ld: [ldScript({ '@context': 'https://schema.org', '@type': 'MusicGroup', name: 'Other Band', ...over })] }) })
  it('G1 another band’s card is not read as yours', () => {
    const r = WHO_TESTS.genre(other({ genre: 'Polka' }))
    expect(r.status).not.toBe('pass')
    expect(r.sentence).toMatch(/Other Band/)
  })
  it('G1 a card with the artist’s own url is the artist, even under another name', () => {
    expect(WHO_TESTS.genre(other({ genre: 'House', url: `${ORIGIN}/` })).status).toBe('pass')
  })
  it('PR2 another band’s profiles are not yours', () => {
    expect(FACTS_TESTS.profiles(other({ sameAs: PROFILES })).status).not.toBe('pass')
  })
  it('G2 the card’s sound must be the one in Tapir', () => {
    const r = WHO_TESTS.genre(withGraph([artistNode({ genre: 'Country' })]))
    expect(r.status).toBe('fail')
    expect(ev(r, /in Tapir/)).toMatch(/House/)
  })
  it.each(['N/A', 'unknown', 'none', '-', 'https://en.wikipedia.org/wiki/House_music'])('G3 "%s" is not a sound', (g) => {
    expect(WHO_TESTS.genre(withGraph([artistNode({ genre: g })])).status).toBe('fail')
  })
  it('P1 a one-line place is said plainly, without contradicting itself', () => {
    const r = WHO_TESTS.place(withGraph([artistNode({ foundingLocation: { '@type': 'Place', name: 'Chicago, IL' } })]))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/one line/)
    expect(r.sentence).not.toMatch(/but not/)
  })
  it('P2 a place that differs from Tapir’s, or a country nobody knows, fails', () => {
    const austin = { '@type': 'Place', address: { addressLocality: 'Austin', addressRegion: 'Texas', addressCountry: 'US' } }
    expect(WHO_TESTS.place(withGraph([artistNode({ foundingLocation: austin })])).status).toBe('fail')
    const earth = { '@type': 'Place', address: { addressLocality: 'Chicago', addressRegion: 'n/a', addressCountry: 'Earth' } }
    expect(WHO_TESTS.place(withGraph([artistNode({ foundingLocation: earth })])).status).toBe('fail')
  })
  it('PR3 links that are none of them profiles are named as such', () => {
    const k = known({}, { links: [{ label: null, url: 'https://open.spotify.com/playlist/abc', onSite: true }], spotifyArtistId: null })
    const r = FACTS_TESTS.profiles(withGraph([artistNode({ sameAs: undefined })], { known: k }))
    expect(r.sentence).toMatch(/none of your links is a profile/)
  })
  it('PR4 sameAs written as {"@id": url} is read', () => {
    const sameAs = [...PROFILES.map((u) => ({ '@id': u }))]
    expect(FACTS_TESTS.profiles(withGraph([artistNode({ sameAs })])).status).toBe('pass')
  })
  it('PR5 the same tracking list as the bridge: gclid is not dropped', () => {
    expect(linkKey('https://instagram.com/x?gclid=1')).not.toBe(linkKey('https://instagram.com/x'))
  })
})

/* ── share / preview ── */
describe('share', () => {
  const s = SHARED_TESTS.share
  type Img = NonNullable<SeoEvidence['shareImage']>
  const img = (over: Partial<Img>) => s(evidence({ shareImage: { url: 'https://cdn.example-artist.com/og.png', status: 200, contentType: 'image/png', width: 1200, height: 630, bytes: 32_000, format: 'png', ...over } }))
  it('S1 turned away (401/403) or busy (429/5xx) is "couldn’t check"; gone (404/410) is broken', () => {
    for (const status of [401, 403, 429, 500, 503]) expect(img({ status, contentType: 'text/html', format: null, width: null, height: null }).status, String(status)).toBe('unknown')
    for (const status of [404, 410]) expect(img({ status, contentType: 'text/html', format: null, width: null, height: null }).status, String(status)).toBe('fail')
  })
  it('S2 a different picture for X is named in the details, and limits say it isn’t opened', () => {
    const r = s(evidence({ home: homeHtml({ og: { 'twitter:image': 'https://cdn.example-artist.com/missing-404.png' } }) }))
    expect(ev(r, /X picture/)).toMatch(/missing-404/)
    expect(r.limits).toMatch(/X/)
  })
  it('S3 "over" only when the size was not stated', () => {
    expect(img({ bytes: 40 * 1024 * 1024, tooBig: true }).sentence).not.toMatch(/over 40/)
  })
  it('S5 a real picture with the wrong label says so', () => {
    const r = img({ contentType: 'application/octet-stream' })
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/label/)
  })
  it('S6 the pass sentence claims no sharpness it cannot see', () => {
    expect(s(evidence()).sentence).not.toMatch(/sharp/)
  })
})

describe('preview', () => {
  const p = SHARED_TESTS.preview
  const withOg = (og: Record<string, string | null>) => p(evidence({ home: homeHtml({ og }) }))
  it('PV1 X’s own title and summary are read', () => {
    expect(withOg({ 'twitter:title': 'Untitled' }).status).toBe('fail')
    expect(withOg({ 'twitter:description': 'Skeen' }).status).toBe('fail')
  })
  it('PV2 an X card kind that doesn’t exist fails', () => {
    expect(withOg({ 'twitter:card': 'banana' }).status).toBe('fail')
  })
  it('PV3 the pass sentence does not claim "one line"', () => {
    expect(p(evidence()).sentence).not.toMatch(/one-line/)
  })
  it('PV4 a shared title that is only your name fails, as the title test does', () => {
    expect(withOg({ 'og:title': 'Skeen' }).status).toBe('fail')
  })
})

/* ── shows ── */
describe('shows', () => {
  const s = FACTS_TESTS.shows
  const ev1 = (startDate: unknown, more: Record<string, unknown> = {}) => ({ '@type': 'MusicEvent', name: 'Skeen at Smartbar', ...(startDate === undefined ? {} : { startDate }), location: { '@type': 'Place', name: 'Smartbar', address: { addressLocality: 'Chicago' } }, ...more })
  const g = (...events: Record<string, unknown>[]) => withGraph([...healthyGraph().filter((n) => n['@type'] !== 'MusicEvent'), ...events], { known: known({ today: '2026-09-29' }, { tourDates: [] }) })
  it('SH1 tonight’s show (10pm Chicago, the UTC date already tomorrow) is not "past"', () => {
    expect(s(g(ev1('2026-09-28T22:00:00-05:00'))).status).toBe('pass')
  })
  it('SH1 a show two days ago still is', () => {
    expect(s(g(ev1('2026-09-27'))).status).toBe('fail')
  })
  it.each(['08/01/2026', '2026-8-1', 'October 10, 2026', '2026-02-30', undefined])('SH2 a show dated "%s" is not skipped silently', (d) => {
    const r = s(g(ev1(d)))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/date/)
  })
  it('SH4 with a Tour show that has no city, the pass sentence says so', () => {
    const e = g()
    e.known = known({ today: '2026-09-29' }, { tourDates: [{ date: '2026-11-01', venue: 'TBA', city: null, isPast: false }] })
    const r = s(e)
    expect(r.status).toBe('pass')
    expect(r.sentence).toMatch(/no city/)
  })
})

/* ── releases ── */
describe('releases', () => {
  const r = FACTS_TESTS.releases
  const one = (title: string, body: string, releasedOn: string | null = '2026-02-14') => {
    const k = known({}, { releases: [{ title, releasedOn }] })
    const html = homeHtml({ ld: [graphBlock([artistNode(), { '@type': 'MusicAlbum', name: title, byArtist: { '@id': `${ORIGIN}/#artist` } }])], body })
    return evidence({ home: html, about: null, known: k })
  }
  it('R1a a one-word title only seen as a nav word is not "shown": we can’t tell', () => {
    expect(r(one('Home', '<nav><a href="/">Home</a></nav>')).status).toBe('unknown')
  })
  it('R1b a title is never found across word boundaries', () => {
    expect(r(one('Summer Sun', '<p>Summers unlimited</p>')).status).toBe('fail')
    expect(r(one('Summer', '<p>Dim sum merch is here</p>')).status).not.toBe('pass')
  })
  it('R1c "Release Number 1" is not shown by "Release Number 12"', () => {
    expect(r(one('Release Number 1', '<p>Release Number 12</p>')).status).toBe('fail')
  })
  it('R1d a title with no letters can’t be told apart', () => {
    expect(r(one('🔥🔥', '<p>hello</p>')).status).toBe('unknown')
  })
  it('R3 no dates: no "newest" claim; a future date is not "your newest"', () => {
    expect(r(one('Home Again', '<h2>Home Again</h2>', null)).sentence).not.toMatch(/newest/)
    const k = known({}, { releases: [{ title: 'Home Again', releasedOn: '2024-01-01' }, { title: 'Next Year', releasedOn: '2027-06-01' }] })
    const html = homeHtml({ ld: [graphBlock([artistNode(), ...['Home Again', 'Next Year'].map((name) => ({ '@type': 'MusicAlbum', name, byArtist: { '@id': 'x' } }))])], body: '<h2>Home Again</h2><h2>Next Year</h2>' })
    expect(r(evidence({ home: html, about: null, known: k })).sentence).not.toMatch(/newest, “Next Year”/)
  })
  it('R4 a curly apostrophe on the card matches a straight one in Tapir', () => {
    const k = known({}, { releases: [{ title: "Don't Stop", releasedOn: '2026-01-01' }] })
    const html = homeHtml({ ld: [graphBlock([artistNode(), { '@type': 'MusicAlbum', name: 'Don’t Stop', byArtist: { '@id': 'x' } }])], body: '<h2>Don’t Stop</h2>' })
    expect(r(evidence({ home: html, about: null, known: k })).status).toBe('pass')
  })
  it('R6 the title is quoted trimmed', () => {
    expect(r(one('  Home   Again ', '<h2>Home Again</h2>')).sentence).toMatch(/“Home Again”/)
  })
})

/* ── card ── */
describe('card', () => {
  const c = FACTS_TESTS.card
  it('C1 values of the wrong kind fail', () => {
    expect(c(withGraph([artistNode({ name: 12345 }), ...healthyGraph().slice(1)])).status).toBe('fail')
    expect(c(withGraph([artistNode({ url: 'not a url' }), ...healthyGraph().slice(1)])).status).toBe('fail')
    const bad = healthyGraph()
    bad[2] = { ...bad[2], startDate: '08/01/2026' }
    expect(c(withGraph(bad)).status).toBe('fail')
  })
  it('C2 a plain Event with nothing in it fails', () => {
    expect(c(withGraph([...healthyGraph(), { '@type': 'Event' }])).status).toBe('fail')
  })
  it('C2 a type we don’t know is named in the details', () => {
    expect(ev(c(withGraph([...healthyGraph(), { '@type': 'MusicAlbun', name: 'x' }])), /types we don’t know/)).toMatch(/MusicAlbun/)
  })
  it('C3 a context that only mentions schema.org is not schema.org', () => {
    expect(c(evidence({ home: homeHtml({ ld: [ldScript({ '@context': 'https://example.com/not-schema.org-really', '@graph': healthyGraph() })] }) })).status).toBe('fail')
  })
})

/* ── H2: nothing published yet ── */
describe('H2', () => {
  it.each(['profiles', 'shows', 'releases'] as const)('%s says nothing is published yet, not that we failed to read it', (id) => {
    const r = FACTS_TESTS[id](evidence({ known: known({ published: null }) }))
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/haven’t published/)
  })
})

/* ── the long bio still passes (guard against over-tightening) ── */
describe('healthy fixture still passes every test', () => {
  it('all 14', () => {
    const e = evidence({ musicbrainz: { looked: true, artistUrl: 'https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d', matchedOn: `${ORIGIN}/`, artistName: 'Skeen' } })
    const all = { ...WHO_TESTS, ...SHARED_TESTS, ...FACTS_TESTS }
    const bad = Object.entries(all).map(([id, t]) => [id, t(e)] as const).filter(([, r]) => r.status !== 'pass').map(([id, r]) => `${id}: ${r.status} ${r.sentence}`)
    expect(bad).toEqual([])
    expect(LONG_BIO.split(' ').length).toBeGreaterThan(100)
    expect(aboutHtml()).toContain('Skeen')
  })
})
