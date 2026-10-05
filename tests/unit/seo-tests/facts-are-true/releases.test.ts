/**
 * Proves the "Your latest releases are listed" test passes only when every release published in
 * Music is on the fact card, the card lists nothing Music lacks, and every release the card
 * lists is shown on a page.
 *
 * Code:     src/lib/seo-tests/facts.ts (`releases`), finding titles on pages with
 *           src/lib/seo-tests/match.ts (`titleShown`)
 * Feature:  SEO test `releases` · Test tab "Facts are true" (source: Music)
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD and page words from the
 *           live site and compares them with Music.
 * Covers:   • every release on the card and shown passes, naming the newest (never an undated
 *             or future one)
 *           • the newest or an older release missing fails, naming it as Tapir's; a release
 *             Music lacks fails; the same title twice counts twice
 *           • a release on the card that no page shows fails; a cover's description counts
 *           • titles match whole words (not "Summers", "Up" in "upcoming", "Number 12"), any
 *             case, spacing or apostrophe; a menu word or a title with no letters is "can't tell"
 *           • no releases anywhere fails, or is `na` for a visual artist
 *           • "What we saw" names the releases the card lists: newest first, undated last, a
 *             name listed twice once, "none" for none, 8 at most then "and N more", long
 *             titles shortened so the whole row survives being stored
 * Not here: nothing published, a home page cut at the read cap, or unreachable (../honesty.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy site whose card and music section list the same 3
 *           releases Music has, newest first); `one` builds a page with one release. Nothing
 *           is fetched.
 */
import { describe, expect, it } from 'vitest'
import { FACTS_TESTS } from '@/lib/seo-tests/facts'
import { capResult } from '@/lib/seo-tests/store'
import { ORIGIN, artistNode, evidence, expectPlainWords, graphBlock, healthyGraph, homeHtml, known, page, rowOf, type Graph } from '@tests/helpers/seo/page-fixture'

const r = FACTS_TESTS.releases
const withGraph = (graph: Graph, more: Parameters<typeof evidence>[0] = {}) => evidence({ home: homeHtml({ ld: [graphBlock(graph)] }), ...more })
/** The healthy card with node `i` removed. */
const without = (i: number): Graph => healthyGraph().filter((_, j) => j !== i)
const album = (name: string, more: Record<string, unknown> = {}) => ({ '@type': 'MusicAlbum', name, byArtist: { '@id': `${ORIGIN}/#artist` }, ...more })
/** Music has one release, `title`; the card lists it; the home page body is `body`; no About page. */
const one = (title: string, body: string, releasedOn: string | null = '2026-02-14') =>
  evidence({ home: homeHtml({ ld: [graphBlock([artistNode(), album(title)])], body }), about: null, known: known({}, { releases: [{ title, releasedOn }] }) })
/** Music's 3 releases plus "Home Again". */
const plusHomeAgain = () => known({}, { releases: [...known().published!.releases, { title: 'Home Again', releasedOn: '2025-04-18' }] })
/** The healthy card's release nodes, as the fixture lists them (newest first). */
const albumNodes = () => healthyGraph().filter((n) => n['@type'] === 'MusicAlbum')
/** A card of `count` dated releases, OLDEST first, named from the fixture's first release. */
const manyAlbums = (count: number, title = (i: number) => `${albumNodes()[0].name} ${i + 1}`) =>
  Array.from({ length: count }, (_, i) => album(title(i), { datePublished: `20${10 + i}-06-01` }))

describe('every release listed and shown passes', () => {
  // The one exact-wording check: the pass sentence counts the releases and names the newest.
  it('passes when every published release is listed, naming the newest', () => {
    const out = r(evidence())
    expect(out.status).toBe('pass')
    expect(out.value).toBe('3 releases')
    expect(out.sentence).toBe('All 3 of your releases are listed, including your newest, “You Were There”.')
    expectPlainWords(out)
  })

  // Titles match whatever their case and spacing ("heatwaves  &  horizons").
  it('matches titles whatever their case and spacing', () => {
    const g = healthyGraph()
    g[4] = { '@type': 'MusicAlbum', name: 'heatwaves  &  horizons', byArtist: { '@id': 'x' } }
    expect(r(withGraph(g)).status).toBe('pass')
  })

  // A curly apostrophe on the card matches a straight one in Music. (verify-found R4)
  it('matches a curly apostrophe to a straight one', () => {
    const k = known({}, { releases: [{ title: "Don't Stop", releasedOn: '2026-01-01' }] })
    const html = homeHtml({ ld: [graphBlock([artistNode(), { '@type': 'MusicAlbum', name: 'Don’t Stop', byArtist: { '@id': 'x' } }])], body: '<h2>Don’t Stop</h2>' })
    expect(r(evidence({ home: html, about: null, known: k })).status).toBe('pass')
  })

  // A page that shows a release only as a cover picture's description (a cover grid) shows it.
  it('counts a release shown only as a cover’s description', () => {
    const out = r(evidence({ home: homeHtml({ ld: [graphBlock([...healthyGraph(), album('Home Again')])], body: '<img src="/c/home-again.jpg" alt="Home Again cover art">' }), known: plusHomeAgain() }))
    expect(out.status).toBe('pass')
  })

  // The title is quoted trimmed, with its spaces collapsed. (verify-found R6)
  it('quotes the title trimmed', () => {
    expect(r(one('  Home   Again ', '<h2>Home Again</h2>')).sentence).toMatch(/“Home Again”/)
  })

  // With no dates, nothing is called "newest"; a release dated next year is never "your newest". (verify-found R3)
  it('claims a newest only among releases dated up to today', () => {
    expect(r(one('Home Again', '<h2>Home Again</h2>', null)).sentence).not.toMatch(/newest/)
    const k = known({}, { releases: [{ title: 'Home Again', releasedOn: '2024-01-01' }, { title: 'Next Year', releasedOn: '2027-06-01' }] })
    const html = homeHtml({ ld: [graphBlock([artistNode(), ...['Home Again', 'Next Year'].map((name) => ({ '@type': 'MusicAlbum', name, byArtist: { '@id': 'x' } }))])], body: '<h2>Home Again</h2><h2>Next Year</h2>' })
    expect(r(evidence({ home: html, about: null, known: k })).sentence).not.toMatch(/newest, “Next Year”/)
  })
})

describe('a release missing from the card, or one Music lacks, fails', () => {
  // The newest release missing from the card fails, naming it, pointing to Music.
  it('fails when the newest release is missing, naming it', () => {
    const out = r(withGraph(without(3)))
    expect(out.status).toBe('fail')
    expect(out.sentence).toMatch(/newest.*You Were There/)
    expect(out.action).toEqual(expect.objectContaining({ target: 'music' }))
    expectPlainWords(out)
  })

  // An older release missing fails too, and the details name it as Tapir's.
  it('fails when an older release is missing, naming it as Digital Tapir’s', () => {
    const out = r(withGraph(without(5)))
    expect(out.status).toBe('fail')
    expect(out.value).toBe('2 of 3')
    expect(rowOf(out, 'in Digital Tapir: not on your site')).toBe('OutWest')
  })

  // A release on the card that Music doesn't have fails, and is named.
  it('fails a release on the card that Music does not have', () => {
    const out = r(withGraph([...healthyGraph(), album('Deleted EP')]))
    expect(out.status).toBe('fail')
    expect(rowOf(out, 'not in Music')).toMatch(/Deleted EP/)
  })

  // Two releases in Music with the same title need two on the card.
  it('counts a repeated title twice', () => {
    const twice = known({}, { releases: [...known().published!.releases, { title: 'OutWest', releasedOn: '2024-02-01' }] })
    expect(r(evidence({ known: twice })).status).toBe('fail')
  })
})

describe('a release the card lists must be shown on a page', () => {
  // CRITICAL: a release the card lists that no page shows fails, naming it (skeen, 2026-09-29: "Home Again" on the card, not on the page).
  it('fails a release on the card that no page shows', () => {
    const out = r(withGraph([...healthyGraph(), album('Home Again', { datePublished: '2025-04-18' })], { known: plusHomeAgain() }))
    expect(out.status).toBe('fail')
    expect(rowOf(out, 'on your fact card, not on your pages')).toBe('Home Again')
    expectPlainWords(out)
  })

  // A short title ("Up") is found only as a whole word: not inside "Upcoming", but yes in "New single: Up.".
  it('matches a short title as a whole word only', () => {
    const g = [...healthyGraph(), album('Up')]
    const k = known({}, { releases: [...known().published!.releases, { title: 'Up', releasedOn: null }] })
    // No /about page: the fixture's bio says "from the ground up", and "up" there IS the word.
    const hidden = r(evidence({ home: homeHtml({ ld: [graphBlock(g)], body: '<p>Upcoming shows soon.</p>' }), about: null, known: k }))
    expect(hidden.status).toBe('fail')
    expect(rowOf(hidden, 'on your fact card, not on your pages')).toBe('Up')
    expect(r(evidence({ home: homeHtml({ ld: [graphBlock(g)], body: '<p>New single: Up.</p>' }), known: k })).status).toBe('pass')
  })

  // A title is never found across word boundaries: "Summer Sun" is not in "Summers unlimited", "Summer" is not in "Dim sum merch". (verify-found R1b)
  it('never finds a title across word boundaries', () => {
    expect(r(one('Summer Sun', '<p>Summers unlimited</p>')).status).toBe('fail')
    expect(r(one('Summer', '<p>Dim sum merch is here</p>')).status).not.toBe('pass')
  })

  // "Release Number 1" is not shown by "Release Number 12". (verify-found R1c)
  it('does not find a title inside a longer number', () => {
    expect(r(one('Release Number 1', '<p>Release Number 12</p>')).status).toBe('fail')
  })

  // A one-word title seen only as a menu word ("Home") can't be told from the menu: "couldn't check". (verify-found R1a)
  it('is unknown for a title seen only as a menu word', () => {
    expect(r(one('Home', '<nav><a href="/">Home</a></nav>')).status).toBe('unknown')
  })

  // A title with no letters ("🔥🔥") can't be looked for: "couldn't check". (verify-found R1d)
  it('is unknown for a title with no letters', () => {
    expect(r(one('🔥🔥', '<p>hello</p>')).status).toBe('unknown')
  })

  // A listed release not on the pages read, while a page could not be read: it may be there, so "couldn't check".
  it('is unknown when a release isn’t shown and a page could not be read', () => {
    const out = r(evidence({ pages: [page('/', homeHtml({ ld: [graphBlock([...healthyGraph(), album('Home Again')])] })), page('/music', null, null, { error: 'timeout' })], known: plusHomeAgain() }))
    expect(out.status).toBe('unknown')
  })
})

describe('no releases anywhere', () => {
  // No releases in Music or on the card: a fail pointing to Music.
  it('fails with no releases anywhere, pointing to Music', () => {
    const out = r(withGraph(healthyGraph().slice(0, 3), { known: known({}, { releases: [] }) }))
    expect(out.status).toBe('fail')
    expect(out.action).toEqual(expect.objectContaining({ target: 'music' }))
  })

  // CRITICAL: a visual artist with no releases anywhere: the test does not apply (`na`), and says why.
  it('does not apply to a visual artist with no releases', () => {
    const out = r(withGraph(healthyGraph().slice(0, 3), { known: known({}, { releases: [], artistType: 'Person' }) }))
    expect(out.status).toBe('na')
    expect(out.sentence).toMatch(/visual artist/)
  })

  // A visual artist whose card lists a release Music doesn't have still fails: the look found something wrong.
  it('still fails a visual artist whose card lists a release Music lacks', () => {
    const out = r(evidence({ known: known({}, { releases: [], artistType: 'Person' }) }))
    expect(out.status).toBe('fail')
    expect(rowOf(out, 'not in Music')).toMatch(/You Were There/)
  })
})

describe('"What we saw" names the releases the card lists', () => {
  const names = () => albumNodes().map((a) => String(a.name))

  // Sam, 2026-09-29 ("list what it sees"): each release the card lists is named, newest first whatever the card's order, one with no date last.
  it('names each release on the card, newest first, undated last', () => {
    const days = albumNodes().map((a) => String(a.datePublished))
    expect(days).toEqual([...days].sort().reverse()) // premise: the fixture lists them newest first
    const shuffled = [...healthyGraph().filter((n) => n['@type'] !== 'MusicAlbum'), album('Home Again'), ...albumNodes().reverse()]
    const out = r(withGraph(shuffled, { known: plusHomeAgain() }))
    expect(rowOf(out, 'on your site')).toBe([...names(), 'Home Again'].join(' · '))
    expectPlainWords(out)
  })

  // A release the card lists twice (in another case, with spaces) is named once; "not in Music" still names the extra one.
  it('names a release listed twice once', () => {
    const last = albumNodes()[2]
    const out = r(withGraph([...healthyGraph(), album(`  ${String(last.name).toUpperCase()} `, { datePublished: last.datePublished })]))
    expect(rowOf(out, 'on your site')).toBe(names().join(' · '))
    expect(rowOf(out, 'not in Music')?.toLowerCase()).toBe(String(last.name).toLowerCase())
  })

  // A card with no releases says "none", not "0 releases".
  it('says none when the card lists no releases', () => {
    const out = r(withGraph(healthyGraph().filter((n) => n['@type'] !== 'MusicAlbum')))
    expect(rowOf(out, 'on your site')).toBe('none')
  })

  // Past 8 names the rest fold into "and N more", and it is the OLDEST that fold, so the latest stay in view.
  it('names 8 at most, folding the oldest into "and N more"', () => {
    const card = manyAlbums(10)
    const newestFirst = card.map((a) => String(a.name)).reverse()
    const out = r(withGraph([artistNode(), ...card]))
    expect(rowOf(out, 'on your site')).toBe(`${newestFirst.slice(0, 8).join(' · ')} · and 2 more`)
  })

  // Long titles are shortened, so 8 names and "and N more" still fit once the run is stored (store.ts cuts each row at 600 bytes).
  it('shortens long titles so the whole row survives being stored', () => {
    const long = (i: number) => `${String(albumNodes()[1].name)} ${i + 1} `.repeat(8)
    const stored = capResult(r(withGraph([artistNode(), ...manyAlbums(10, long)])))
    expect(rowOf(stored, 'on your site')).toMatch(/ · and 2 more$/)
  })
})
