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
    expect(ev(r, 'in Tapir: title')).toMatch(/written on the Listing tab/i)
    expect(ev(r, 'same as your site')).toBe('yes')
    plain(r)
  })
  it('says when the live title is not the one published, and quotes Tapir’s title as Tapir’s', () => {
    const r = t(evidence({ known: known({}, { seoTitle: 'Skeen · Chicago DJ' }) }))
    expect(ev(r, 'same as your site')).toBe('no')
    expect(ev(r, 'in Tapir: title')).toBe('Skeen · Chicago DJ (written on the Listing tab)')
  })
  // known.ts fills seoTitle from resolveSeo, so with nothing written it holds the BUILT title,
  // never null (verify-content.md T2: the old test fed null, a state production never has).
  it('says when no title was written and the live one is built from the facts', () => {
    const built = 'Skeen · Chicago house musician'
    const r = t(evidence({ home: homeHtml({ title: built }), known: known({}, { seoTitle: built }) }))
    expect(r.status).toBe('pass')
    expect(ev(r, 'in Tapir: title')).toMatch(/built from your facts/i)
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
    const seventy = `Skeen · Chicago ${'x'.repeat(54)}`
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
    const r = d(evidence({ home: homeHtml({ description: `Skeen is a Chicago DJ and producer who plays house and tech house in clubs, warehouses and festivals across the Midwest, and films every night of it for his video diary.` }) }))
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
  // Sam, 2026-09-29: the bio test checks KEY FACTS, not length ("a bio of 2500 seems huge"):
  // your genre, your city and one highlight, in at least about 100 words (Tapir's own floor).
  const b = WHO_TESTS.bio
  const words = (s: string) => [...new Intl.Segmenter('und', { granularity: 'word' }).segment(s)].filter((x) => x.isWordLike).length
  const filler = 'He films every night for a video diary about building a career in dance music from the ground up, one small room at a time, with friends.'
  /** A bio made of `facts` plus distinct filler sentences until it has at least `min` words. */
  const bioWith = (facts: string, min = 110) => {
    const parts = [facts]
    for (let i = 1; words(parts.join(' ')) < min; i++) parts.push(filler.replace('small room', `small room number ${i}`))
    return parts.join(' ')
  }
  const run = (text: string, pub: Parameters<typeof known>[1] = {}) =>
    b(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ description: text })])] }), about: aboutHtml(text), known: known({}, { bio: text, ...pub }) }))

  it('passes a bio of 100+ words that names the genre, the city and a highlight, as words on a page', () => {
    const r = b(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe(`${words(LONG_BIO)} words · 3 of 3 facts`)
    expect(ev(r, 'shown on')).toBe('/about')
    expect(ev(r, 'genre in your bio')).toMatch(/house/i)
    expect(ev(r, 'city in your bio')).toBe('Chicago')
    expect(ev(r, 'highlight in your bio')).toMatch(/OutWest|Smartbar|Navy Pier/)
    expect(r.limits).toMatch(/100-word floor is Tapir[’']s own/)
    plain(r)
  })
  it('never mentions a 2,500 or a length goal anywhere', () => {
    for (const e of [evidence(), evidence({ about: aboutHtml('Short bio here about Skeen in Chicago playing house at Smartbar.') })]) {
      expect(JSON.stringify(b(e))).not.toMatch(/2,500|2500|length goal/i)
    }
  })
  it('fails under 100 words even with every fact, saying the count and the floor, with an example from your own data', () => {
    const short = 'Skeen is a Chicago house DJ and producer. His EP OutWest came out in 2024. He has played Smartbar twice.'
    const r = run(short)
    expect(r.status).toBe('fail')
    expect(r.value).toBe(`${words(short)} words · 3 of 3 facts`)
    expect(r.sentence).toMatch(new RegExp(`has ${words(short)} words, under Tapir[’']s 100-word floor`))
    expect(r.todo).toMatch(/100 words/)
    expect(r.action).toEqual(expect.objectContaining({ kind: 'edit', target: 'bio' }))
    plain(r)
  })
  it('fails a long bio with no genre, saying so and suggesting yours', () => {
    const r = run(bioWith('Skeen is a DJ and producer from Chicago. His EP OutWest came out in 2024.'))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/doesn[’']t name your genre\./)
    expect(r.sentence).not.toMatch(/words/)
    expect(r.good).toMatch(/House/)
    expect(r.value).toMatch(/2 of 3 facts/)
  })
  it('fails a long bio with no city', () => {
    const r = run(bioWith('Skeen is a house DJ and producer. His EP OutWest came out in 2024.'))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/doesn[’']t name your city\./)
    expect(r.good).toMatch(/Chicago/)
  })
  it('fails a long bio with no release or show, suggesting one of yours', () => {
    const r = run(bioWith('Skeen is a Chicago house DJ and producer who plays long sets.'))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/doesn[’']t name a release or show\./)
    expect(r.good).toMatch(/Smartbar|Navy Pier|You Were There|OutWest|Heatwaves/)
  })
  it('says everything that is missing at once (the Skeen case: short, city only)', () => {
    const skeen = 'My name is Skeen I am a Chicago DJ, producer, and filmmaker. I\'m documenting what it looks like to build a career in dance music from the ground up. I spend my days in the studio or somewhere with my USB, three cameras, and a ridiculous idea. Hopefully I\'ll see you in your city soon!'
    const r = run(skeen)
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/under Tapir[’']s 100-word floor, and doesn[’']t name your genre or a release or show\./)
    expect(ev(r, 'city in your bio')).toBe('Chicago')
    expect(r.value).toBe(`${words(skeen)} words · 1 of 3 facts`)
    expect(r.sentence.length).toBeLessThan(170)
  })
  it('matches whole words only, in any case and typography', () => {
    // "warehouse" is not "house", "Chicagoland" is not "Chicago".
    const r = run(bioWith('Skeen plays warehouse parties across Chicagoland. His EP OutWest came out in 2024.'))
    expect(ev(r, 'genre in your bio')).toBe('not found')
    expect(ev(r, 'city in your bio')).toBe('not found')
    const caps = run(bioWith('SKEEN IS A CHICAGO HOUSE DJ. HIS EP “OUTWEST” CAME OUT IN 2024.'))
    expect(caps.status).toBe('pass')
  })
  it('counts a show’s venue, or a show’s city other than home, as a highlight; not the home city', () => {
    const k = { releases: [], tourDates: [{ date: '2026-08-15', venue: 'Navy Pier', city: 'Chicago', isPast: true }, { date: '2026-07-01', venue: 'Miramar', city: 'Milwaukee', isPast: true }] }
    expect(run(bioWith('Skeen is a Chicago house DJ who played Navy Pier last summer.'), k).status).toBe('pass')
    expect(run(bioWith('Skeen is a Chicago house DJ who played a packed room in Milwaukee.'), k).status).toBe('pass')
    expect(run(bioWith('Skeen is a Chicago house DJ who plays around town.'), k).status).toBe('fail')
  })
  it('does not count a release title that is a menu word or under 3 letters', () => {
    const k = { releases: [{ title: 'Home', releasedOn: '2025-01-01' }, { title: 'XO', releasedOn: '2025-02-01' }, { title: 'OutWest', releasedOn: '2024-01-26' }], tourDates: [] }
    const r = run(bioWith('Skeen is a Chicago house DJ. XO, he signs every message. He is always happy to be home.'), k)
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/release or show/)
    // With only such titles in Tapir, there is no highlight to look for: skipped, and said.
    const only = run(bioWith('Skeen is a Chicago house DJ.'), { releases: [{ title: 'Home', releasedOn: '2025-01-01' }], tourDates: [] })
    expect(only.status).toBe('pass')
    expect(ev(only, 'highlight in your bio')).toMatch(/not checked/)
  })
  it('skips a fact Tapir doesn’t have, and says so, never failing the bio for it', () => {
    const r = run(bioWith('Skeen is a DJ and producer. His EP OutWest came out in 2024.'), { genre: null, location: null })
    expect(r.status).toBe('pass')
    expect(r.value).toMatch(/1 of 1 fact/)
    expect(ev(r, 'genre in your bio')).toMatch(/not set in Tapir/)
    expect(ev(r, 'city in your bio')).toMatch(/not set in Tapir/)
  })
  it('only counts facts in the part of the bio the page SHOWS', () => {
    const full = bioWith('Skeen started out filming friends at parties and never really stopped. Today he is a Chicago house DJ and producer with a debut EP called OutWest.')
    const shown = full.split(/(?<=\.) /).filter((s) => !/Chicago/.test(s)).join(' ')
    const r = b(evidence({ home: homeHtml({ ld: [] }), about: aboutHtml(shown), known: known({}, { bio: full }) }))
    expect(r.status).toBe('fail')
    expect(ev(r, 'city in your bio')).toBe('not found')
  })
  it('fails a bio that is only in the fact card, not on any page', () => {
    const r = b(evidence({ about: null }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('not on your pages')
    expect(r.sentence).toMatch(/isn[’']t shown/i)
  })
  it('does not count a short sentence that happens to appear on the page', () => {
    const r = b(evidence({ about: aboutHtml('Unrelated words. Hi. I play records sometimes.'), home: homeHtml({ ld: [] }), known: known({}, { bio: 'Hi. I play records.' }) }))
    expect(r.value).toBe('not on your pages')
  })
  it('fails when there is no bio at all, saying so', () => {
    const r = b(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ description: undefined })])] }), known: known({}, { bio: null }) }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/haven[’']t written a bio in Tapir/i)
    expect(ev(r, 'in Tapir: bio')).toBe('none published')
    expect(ev(r, 'fact card')).toMatch(/no bio/)
  })
  it('does not take the summary the fact card falls back to (no bio) as a bio', () => {
    const summary = 'Meet Skeen, a Chicago DJ, producer and filmmaker, building a career in dance music from the ground up.'
    const r = b(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ description: summary })])], body: `<p>${summary}</p>` }), about: null, known: known({}, { bio: null }) }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/haven[’']t written/)
  })
  it('is unknown with nothing published in Tapir: there are no facts to look for', () => {
    const r = b(evidence({ known: known({ published: null }) }))
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/haven[’']t published/)
  })
  it('is unknown when a page with the bio could not be read and no page shows it', () => {
    expect(b(evidence({ pages: [page('/', homeHtml()), page('/about', null, null, { error: 'timeout' })] })).status).toBe('unknown')
  })
  it('is unknown with no readable page', () => {
    expect(b(evidence({ pages: [page('/', null, null)] })).status).toBe('unknown')
  })
  it('counts words in a script written without spaces', () => {
    const zh = '斯基恩是一位来自芝加哥的浩室音乐制作人和唱片骑师。他在芝加哥的俱乐部演出了很多年，每一场都拍成视频日记。'
    const r = run(zh, { genre: '浩室', location: '芝加哥' })
    expect(r.value).toMatch(/^\d+ words/)
    expect(Number(r.value.split(' ')[0])).toBeGreaterThan(10)
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
    expect(g(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ genre: 'Techno' })])] }), known: known({}, { genre: 'Techno' }) })).status).toBe('pass')
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
  it('CRITICAL: does not apply (`na`) to an artist published in Tapir as a visual artist, whatever the card says', () => {
    const person = known({}, { artistType: 'Person', genre: null })
    const r = g(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ '@type': 'Person', genre: undefined })])] }), known: person }))
    expect(r.status).toBe('na')
    expect(r.sentence).toMatch(/visual artist/)
    expect(r.action).toBeUndefined()
    // `na` needs no look: it stands when the home page could not be read too.
    expect(g(evidence({ pages: [], known: person })).status).toBe('na')
    expect(g(evidence({ known: person })).status).toBe('na')
  })
  it('fails a card that calls a musician a person (no place for a style), saying Tapir has them as a musician', () => {
    const r = g(withArtist({ '@type': 'Person', genre: undefined }))
    expect(r.status).toBe('fail')
    expect(ev(r, 'in Tapir: artist type')).toBe('Musician')
    expect(ev(r, 'artist type')).toBe('Person')
    plain(r)
  })
  it('is unknown for a Person card when nothing is published to say what kind of artist this is', () => {
    const r = g(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ '@type': 'Person', genre: undefined })])] }), known: known({ published: null }) }))
    expect(r.status).toBe('unknown')
    expect(r.limits).toBeTruthy()
  })
  it('names the sound Tapir has, as Tapir’s, when the card has none', () => {
    const r = g(withArtist({ genre: undefined }))
    expect(ev(r, 'in Tapir: genre')).toBe('House, Tech House')
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
    const oslo = known({}, { location: 'Oslo', region: 'Oslo', country: 'Norway', countryCode: 'NO' })
    const r = p({ ...withPlace({ '@type': 'Place', address: { addressLocality: 'Oslo', addressRegion: 'Oslo', addressCountry: { '@type': 'Country', name: 'Norway' } } }, 'Person'), known: oslo })
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
  it('CRITICAL: a region and country published in Tapir but missing from the card: publish / update the site, not "add"', () => {
    const r = p(withPlace({ '@type': 'Place', name: 'Chicago' }))
    expect(r.status).toBe('fail')
    expect(r.todo).toMatch(/published in Tapir/)
    expect(r.todo).not.toMatch(/^Add/)
    expect(ev(r, 'in Tapir: place')).toBe('city Chicago, IL · region IL · country United States')
    plain(r)
  })
  it('says add them on the Facts tab when Tapir has no region or country either', () => {
    const r = p(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ foundingLocation: { '@type': 'Place', name: 'Chicago' } })])] }), known: known({}, { region: null, country: null, countryCode: null }) }))
    expect(r.todo).toMatch(/^Add the state or region and the country on the Facts tab/)
    expect(ev(r, 'in Tapir: place')).toBe('city Chicago, IL · region not set · country not set')
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
  it('CRITICAL: does not apply (`na`) to a visual artist: MusicBrainz lists people who make music', () => {
    const person = known({}, { artistType: 'Person' })
    for (const musicbrainz of [{ looked: true, artistUrl: null, matchedOn: null }, { looked: false, artistUrl: null, matchedOn: null, error: 'x' }]) {
      const r = m(evidence({ known: person, musicbrainz }))
      expect(r.status).toBe('na')
      expect(r.sentence).toMatch(/visual artist/)
      expect(r.action).toBeUndefined() // never "Create the page" for someone MusicBrainz would not list
    }
  })
  it('says when the answer is the link from Connections, not a lookup', () => {
    // lookupMusicBrainz now OPENS a Connections link (verify-content.md M2): the answer is labelled as Tapir's.
    const r = m(evidence({ musicbrainz: { looked: true, artistUrl: 'https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d', matchedOn: 'your MusicBrainz link in Connections', fromConnections: true, artistName: 'Skeen' } }))
    expect(r.status).toBe('pass')
    expect(ev(r, 'in Tapir: found by')).toMatch(/Connections/)
  })
})
