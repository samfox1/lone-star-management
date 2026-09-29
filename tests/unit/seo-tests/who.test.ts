/**
 * "Says who you are": title, desc, bio, genre, place, mb. Each is read off the LIVE html in
 * `evidence.plain`, never off what Tapir holds (types.ts honesty rule 3). Every describe
 * starts from the healthy fixture and breaks one thing.
 */
import { describe, expect, it } from 'vitest'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import type { SeoTestResult } from '@/lib/seo-tests/types'
import { ORIGIN, LONG_BIO, aboutHtml, artistNode, evidence, graphBlock, healthyGraph, homeHtml, known, ldScript, page } from './_page-fixture'

const ev = (r: SeoTestResult, label: string) => r.evidence.find((e) => e.label === label)?.value
const JARGON = /json-ld|\bmeta\b|og:|canonical|schema|@type|sameAs/i

/** Every result, whatever it says, keeps the contract's shape and plain words. */
function plain(r: SeoTestResult) {
  expect(r.value.length).toBeLessThanOrEqual(28)
  expect(r.sentence).not.toMatch(JARGON)
  // The page writes "Not yet:" in front of a fail, so it starts lower-case (a name keeps its capital).
  if (r.status === 'fail') expect(r.sentence).toMatch(/^(?:[a-z0-9]|MusicBrainz|Apple|Google)/)
  if (r.todo) expect(r.todo).not.toMatch(JARGON)
  for (const e of r.evidence) expect(e.value).not.toMatch(/<[a-z!/]/i)
}

describe('WHO_TESTS: one test per id in the group', () => {
  it('covers exactly the "who" ids in defs.ts', () => {
    const ids = SEO_TEST_DEFS.filter((d) => d.group === 'who').map((d) => d.id).sort()
    expect(Object.keys(WHO_TESTS).sort()).toEqual(ids)
  })
  it('each result carries its own id, and never throws on an empty run', () => {
    const empty = evidence({ pages: [], musicbrainz: { looked: false, artistUrl: null, matchedOn: null, error: 'network' } })
    for (const [id, test] of Object.entries(WHO_TESTS)) {
      const r = test(empty)
      expect(r.id).toBe(id)
      expect(r.status).toBe('unknown')
    }
  })
})

describe('title', () => {
  const t = WHO_TESTS.title
  it('passes a title that names the artist and more, and says it was written in Tapir', () => {
    const r = t(evidence())
    expect(r.status).toBe('pass')
    expect(ev(r, 'title')).toBe('Skeen · Chicago house DJ and producer')
    expect(ev(r, 'length')).toBe('37 of 70')
    expect(ev(r, 'source')).toMatch(/written on the SEO page/i)
    plain(r)
  })
  it('says when the live title is not the one published', () => {
    const r = t(evidence({ known: known({}, { seoTitle: 'Skeen · Chicago DJ' }) }))
    expect(ev(r, 'source')).toMatch(/not the title you published/i)
  })
  it('says when no title was written and the live one is built from the facts', () => {
    const r = t(evidence({ home: homeHtml({ title: 'Skeen · Chicago house musician' }), known: known({}, { seoTitle: null }) }))
    expect(r.status).toBe('pass')
    expect(ev(r, 'source')).toMatch(/built from your facts/i)
  })
  it('fails the bare name, in any case', () => {
    const r = t(evidence({ home: homeHtml({ title: 'SKEEN' }) }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/just/i)
    expect(r.action).toEqual(expect.objectContaining({ kind: 'edit', target: 'listing' }))
    plain(r)
  })
  it('fails the name plus filler ("official site")', () => {
    expect(t(evidence({ home: homeHtml({ title: 'Skeen — Official Website' }) })).status).toBe('fail')
    expect(t(evidence({ home: homeHtml({ title: 'Welcome to the official site of Skeen' }) })).status).toBe('fail')
  })
  it('fails a page with no title at all', () => {
    const r = t(evidence({ home: homeHtml({ title: null }) }))
    expect(r.status).toBe('fail')
    expect(r.value).toMatch(/no title/i)
  })
  it('fails a title that does not name the artist (a whole word, not "Skeens")', () => {
    expect(t(evidence({ home: homeHtml({ title: 'Chicago house DJ and producer' }) })).status).toBe('fail')
    expect(t(evidence({ home: homeHtml({ title: 'Skeens · Chicago house DJ' }) })).status).toBe('fail')
  })
  it('fails a title over 70 characters, softly', () => {
    const long = 'Skeen · Chicago house DJ, producer, filmmaker, radio host and label owner'
    expect(long.length).toBeGreaterThan(70)
    const r = t(evidence({ home: homeHtml({ title: long }) }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
    expect(ev(r, 'length')).toBe(`${long.length} of 70`)
  })
  it('passes exactly 70 characters', () => {
    const seventy = `Skeen · ${'x'.repeat(62)}`
    expect(seventy.length).toBe(70)
    expect(t(evidence({ home: homeHtml({ title: seventy }) })).status).toBe('pass')
  })
  it('reads the page title, never an svg <title> before it', () => {
    const svg = '<svg><title>SKEEN</title><path d="M0 0"/></svg>'
    const html = homeHtml().replace('<head>', `<head>${svg}`)
    expect(t(evidence({ home: html })).status).toBe('pass')
    // With only an svg title, the page has none.
    const onlySvg = homeHtml({ title: null, body: svg })
    expect(t(evidence({ home: onlySvg })).value).toMatch(/no title/i)
  })
  it('reads a title React wrote in the body (streamed metadata)', () => {
    const html = homeHtml({ title: null, body: '<title>Skeen · Chicago house DJ</title>' })
    expect(t(evidence({ home: html })).status).toBe('pass')
  })
  it('decodes entities before judging and reporting', () => {
    const r = t(evidence({ home: homeHtml({ title: 'Skeen & Friends · Chicago' }) }))
    expect(ev(r, 'title')).toBe('Skeen & Friends · Chicago')
    expect(r.status).toBe('pass')
  })
  it('notes a second title', () => {
    const r = t(evidence({ home: homeHtml({ body: '<title>Other</title>' }) }))
    expect(ev(r, 'titles on the page')).toBe('2')
  })
  it('is unknown when the home page did not answer, answered with an error, or was not visited', () => {
    expect(t(evidence({ pages: [page('/', null, null, { error: 'timeout' })] })).status).toBe('unknown')
    expect(t(evidence({ pages: [page('/', null, 500)] })).status).toBe('unknown')
    expect(t(evidence({ pages: [] })).status).toBe('unknown')
    expect(t(evidence({ pages: [page('/', null, null, { error: 'timeout' })] })).sentence).toMatch(/timed out/)
  })
  it('reads a 5 MB page quickly', () => {
    const huge = homeHtml({ body: `<div>${'<p>word word word</p>'.repeat(260_000)}</div>` })
    expect(huge.length).toBeGreaterThan(5_000_000)
    const start = Date.now()
    expect(t(evidence({ home: huge })).status).toBe('pass')
    expect(Date.now() - start).toBeLessThan(3000)
  })
  it('survives an unclosed script and an unclosed quote without hanging', () => {
    const html = `<html><head><title>Skeen · Chicago</title></head><body><img alt="oops src=x>${'<script>'.repeat(20_000)}`
    expect(t(evidence({ home: html })).status).toBe('pass')
  })
})

describe('desc', () => {
  const d = WHO_TESTS.desc
  it('passes a summary of 50–160 characters', () => {
    const r = d(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('102 of 160')
    plain(r)
  })
  it('fails no summary', () => {
    const r = d(evidence({ home: homeHtml({ description: null }) }))
    expect(r.status).toBe('fail')
    expect(r.action).toEqual(expect.objectContaining({ target: 'listing' }))
    plain(r)
  })
  it('fails the "official site" fallback the bridge writes when there is nothing else', () => {
    const r = d(evidence({ home: homeHtml({ description: 'Skeen — official site' }) }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/just/i)
  })
  it('fails a summary under 50 characters, softly', () => {
    const r = d(evidence({ home: homeHtml({ description: 'Chicago DJ and producer.' }) }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
  })
  it('fails a summary over 160 characters, softly', () => {
    const r = d(evidence({ home: homeHtml({ description: `Skeen is ${'a Chicago DJ '.repeat(20)}` }) }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
  })
  it('passes 50 and 160 exactly, fails 49 and 161', () => {
    const of = (n: number) => d(evidence({ home: homeHtml({ description: `Skeen ${'x'.repeat(n - 6)}` }) })).status
    expect([of(49), of(50), of(160), of(161)]).toEqual(['fail', 'pass', 'pass', 'fail'])
  })
  it('counts characters after decoding entities', () => {
    const text = 'Skeen & friends play Chicago house records every weekend, all night long.'
    const r = d(evidence({ home: homeHtml({ description: text }) }))
    expect(r.value).toBe(`${text.length} of 160`)
  })
  it('is unknown without a home page', () => {
    expect(d(evidence({ pages: [page('/', null, 503)] })).status).toBe('unknown')
  })
})

describe('bio', () => {
  const b = WHO_TESTS.bio
  it('passes a bio of 2,500+ characters that shows as words on a page', () => {
    const r = b(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('2,600 of 2,500')
    expect(ev(r, 'shown on')).toBe('/about')
    expect(r.limits).toMatch(/Tapir[’']s own/i)
    plain(r)
  })
  it('fails a short bio, counting only what the page shows', () => {
    const short = 'My name is Skeen. I am a Chicago DJ, producer, and filmmaker. I spend my days in the studio.'
    const r = b(evidence({ about: aboutHtml(short), home: homeHtml({ ld: [graphBlock([artistNode({ description: short })])] }), known: known({}, { bio: short }) }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe(`${short.length} of 2,500`)
    expect(r.action).toEqual(expect.objectContaining({ kind: 'edit', target: 'bio' }))
    expect(r.good).toBeUndefined() // the goal is Tapir's own, not grounded: no "what good looks like"
    plain(r)
  })
  it('fails a bio that is only in the fact card, not on any page', () => {
    const r = b(evidence({ about: null }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('0 of 2,500')
    expect(r.sentence).toMatch(/isn[’']t shown/i)
  })
  it('counts the part of the bio a page shows, sentence by sentence', () => {
    const shown = LONG_BIO.split(/(?<=\.) /).slice(0, 10).join(' ')
    const r = b(evidence({ about: aboutHtml(shown) }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe(`${shown.length.toLocaleString('en-US')} of 2,500`)
  })
  it('does not count a short sentence that happens to appear on the page', () => {
    const bio = 'Hi. I play records.'
    const r = b(evidence({ about: aboutHtml('Unrelated words. Hi. I play records sometimes.'), home: homeHtml({ ld: [] }), known: known({}, { bio }) }))
    expect(r.value).toBe('0 of 2,500')
  })
  it("fails when there is no bio at all, saying so", () => {
    const r = b(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ description: undefined })])] }), known: known({}, { bio: null }) }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/haven[’']t written/i)
  })
  it('does not take the summary the fact card falls back to (no bio) as a bio', () => {
    const summary = 'Meet Skeen, a Chicago DJ, producer and filmmaker, building a career in dance music from the ground up.'
    const r = b(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ description: summary })])], body: `<p>${summary}</p>` }), about: null, known: known({}, { bio: null }) }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/haven[’']t written/)
  })
  it('reads the bio off the live fact card when Tapir has nothing published', () => {
    expect(b(evidence({ known: known({ published: null }) })).status).toBe('pass')
  })
  it('is unknown with no published data and no fact card', () => {
    expect(b(evidence({ known: known({ published: null }), home: homeHtml({ ld: [] }) })).status).toBe('unknown')
  })
  it('is unknown when a page with the bio could not be read and no page shows it', () => {
    const r = b(evidence({ pages: [page('/', homeHtml()), page('/about', null, null, { error: 'timeout' })] }))
    expect(r.status).toBe('unknown')
  })
  it('is unknown with no readable page', () => {
    expect(b(evidence({ pages: [page('/', null, null)] })).status).toBe('unknown')
  })
})

describe('genre', () => {
  const g = WHO_TESTS.genre
  const withArtist = (over: Record<string, unknown>) => evidence({ home: homeHtml({ ld: [graphBlock([artistNode(over)])] }) })
  it('passes when the fact card names a style', () => {
    const r = g(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('House, Tech House')
    expect(r.sentence).toMatch(/House and Tech House/)
    plain(r)
  })
  it('passes a single string genre', () => {
    expect(g(withArtist({ genre: 'Techno' })).status).toBe('pass')
  })
  it('reads the card as @graph, as an array, or as one object', () => {
    const node = { '@context': 'https://schema.org', ...artistNode() }
    expect(g(evidence({ home: homeHtml({ ld: [ldScript([node])] }) })).status).toBe('pass')
    expect(g(evidence({ home: homeHtml({ ld: [ldScript(node)] }) })).status).toBe('pass')
    expect(g(evidence({ home: homeHtml({ ld: [ldScript({ '@context': 'https://schema.org', '@graph': node })] }) })).status).toBe('pass')
  })
  it('finds the artist in the second of several blocks', () => {
    const html = homeHtml({ ld: [ldScript({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'x', url: ORIGIN }), graphBlock(healthyGraph())] })
    expect(g(evidence({ home: html })).status).toBe('pass')
  })
  it('never reads a support act (a nested MusicGroup) as the artist', () => {
    const graph = healthyGraph()
    graph[0] = artistNode({ genre: undefined })
    ;(graph[2].performer as Record<string, unknown>[])[1] = { '@type': 'MusicGroup', name: 'Support', genre: 'Rock' }
    expect(g(evidence({ home: homeHtml({ ld: [graphBlock(graph)] }) })).status).toBe('fail')
  })
  it('fails with no genre, and says publish when Tapir already has one', () => {
    const r = g(withArtist({ genre: undefined }))
    expect(r.status).toBe('fail')
    expect(r.todo).toMatch(/publish/i)
    expect(r.action).toEqual(expect.objectContaining({ target: 'facts' }))
    plain(r)
  })
  it('fails with no genre, and says add it when Tapir has none', () => {
    const r = g(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ genre: [] })])] }), known: known({}, { genre: null }) }))
    expect(r.status).toBe('fail')
    expect(r.todo).toMatch(/add/i)
  })
  it('fails when there is no fact card, or it cannot be read', () => {
    expect(g(evidence({ home: homeHtml({ ld: [] }) })).status).toBe('fail')
    expect(g(evidence({ home: homeHtml({ ld: ['<script type="application/ld+json">{"@graph": [</script>'] }) })).status).toBe('fail')
  })
  it('is unknown for a Person card, which has no place for a style', () => {
    const r = g(withArtist({ '@type': 'Person', genre: undefined }))
    expect(r.status).toBe('unknown')
    expect(r.limits).toBeTruthy()
  })
  it('is unknown without a home page', () => {
    expect(g(evidence({ pages: [] })).status).toBe('unknown')
  })
})

describe('place', () => {
  const p = WHO_TESTS.place
  const withPlace = (loc: unknown, type = 'MusicGroup') =>
    evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ '@type': type, foundingLocation: undefined, [type === 'Person' ? 'homeLocation' : 'foundingLocation']: loc })])] }) })
  it('passes city + region + country', () => {
    const r = p(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('Chicago, IL, US')
    plain(r)
  })
  it('passes a Person with a homeLocation, and a Country object', () => {
    const r = p(withPlace({ '@type': 'Place', address: { addressLocality: 'Oslo', addressRegion: 'Oslo', addressCountry: { '@type': 'Country', name: 'Norway' } } }, 'Person'))
    expect(r.status).toBe('pass')
  })
  it('fails a city only, softly: the shape skeen ships today', () => {
    const r = p(withPlace({ '@type': 'Place', name: 'Chicago' }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
    expect(r.sentence).toMatch(/Chicago/)
    expect(r.sentence).toMatch(/state or region/)
    expect(r.action).toEqual(expect.objectContaining({ target: 'facts' }))
    plain(r)
  })
  it('does not read a region out of a free-text name ("Chicago, IL")', () => {
    expect(p(withPlace({ '@type': 'Place', name: 'Chicago, IL' })).status).toBe('fail')
  })
  it('fails city + country with no region', () => {
    const r = p(withPlace({ '@type': 'Place', address: { addressLocality: 'Chicago', addressCountry: 'US' } }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/state or region/)
  })
  it('fails city + region with no country', () => {
    const r = p(withPlace({ '@type': 'Place', address: { addressLocality: 'Chicago', addressRegion: 'IL' } }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/country/)
  })
  it('fails a place given as a bare string, and no place at all', () => {
    expect(p(withPlace('Chicago')).status).toBe('fail')
    const r = p(withPlace(undefined))
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
  })
  it('fails blank strings as missing', () => {
    expect(p(withPlace({ '@type': 'Place', address: { addressLocality: 'Chicago', addressRegion: '  ', addressCountry: 'US' } })).status).toBe('fail')
  })
  it('is unknown without a home page', () => {
    expect(p(evidence({ pages: [page('/', null, 404)] })).status).toBe('unknown')
  })
})

describe('mb', () => {
  const m = WHO_TESTS.mb
  it('passes when MusicBrainz names an artist, with where it came from', () => {
    const r = m(evidence({ musicbrainz: { looked: true, artistUrl: 'https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d', matchedOn: 'https://www.example-artist.com/', artistName: 'Skeen' } }))
    expect(r.status).toBe('pass')
    expect(ev(r, 'MusicBrainz page')).toMatch(/musicbrainz\.org\/artist\/b10bbbfc/)
    expect(ev(r, 'found by')).toMatch(/example-artist\.com/)
    plain(r)
  })
  it('fails when MusicBrainz answered and knows no artist, with a pre-filled create link', () => {
    const r = m(evidence({ musicbrainz: { looked: true, artistUrl: null, matchedOn: null, asked: ['https://www.example-artist.com/'] } }))
    expect(r.status).toBe('fail')
    expect(r.action?.kind).toBe('outside')
    const href = r.action && r.action.kind === 'outside' ? r.action.href : ''
    expect(href).toMatch(/^https:\/\/musicbrainz\.org\/artist\/create\?/)
    expect(new URL(href).searchParams.get('edit-artist.name')).toBe('Skeen')
    plain(r)
  })
  it('is unknown when we could not ask, never a fail', () => {
    const r = m(evidence({ musicbrainz: { looked: false, artistUrl: null, matchedOn: null, error: 'MusicBrainz was busy (503)' } }))
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/busy/)
  })
  it('says when the answer is the link from Connections, not a lookup', () => {
    const r = m(evidence({ musicbrainz: { looked: true, artistUrl: 'https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d', matchedOn: 'your MusicBrainz link in Connections' } }))
    expect(r.status).toBe('pass')
    expect(r.limits).toMatch(/as given/i)
  })
})
