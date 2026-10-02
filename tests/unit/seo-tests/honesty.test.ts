/**
 * Proves the honesty rules hold across every test at once: a test that could not look says
 * "couldn't check" (never a pass, a fail or "doesn't apply"), says why, and a detail that
 * states what Tapir holds is labelled "in Tapir".
 *
 * Code:     src/lib/seo-tests/who.ts, shared.ts, facts.ts (and found.ts for the "in Tapir" sweep)
 * Feature:  the honesty rules in src/lib/seo-tests/types.ts (1: unknown is never a pass;
 *           3: Tapir's values are labelled as Tapir's; 4: `na` only when a test can't apply),
 *           across the Test tab groups "Says who you are", "Looks right when shared" and
 *           "Facts are true" (all four groups for rule 3)
 * Tier:     STRICT (AGENTS.md "Test depth"): these rules are what makes a result trustworthy
 *           (Sam, 2026-09-28: "These tests should be verified to accurately detect what they say").
 * Covers:   • a home page not visited, silent, timed out, or answering 404 / 503: every test in the
 *             three groups is unknown, each says why (the site-free tests, MusicBrainz and
 *             YouTube: when they couldn't be asked either)
 *           • a home page cut at the read cap: every test whose answer could sit past the cut
 *             is unknown and says so; a card read whole before the cut is still judged
 *           • nothing published from Tapir: the tests that compare with Tapir say so, never
 *             "we failed to read it"
 *           • every detail row quoting a value only Tapir holds is labelled "in Tapir: …", and
 *             no such row quotes a value only the site holds (every test in SEO_TEST_IDS)
 * Not here: each test's own `na` case and its "couldn't check" twin, in the test's file:
 *           genre and musicbrainz (says-who-you-are/), photo-descriptions
 *           (looks-right-when-shared/), apple-music and releases (facts-are-true/).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy site); each sweep changes one thing for every test.
 *           The "in Tapir" sweep builds one site where Tapir and the site each hold values the
 *           other doesn't, spelled as markers that appear nowhere else. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { SEO_TEST_DEFS, SITE_FREE_TESTS } from '@/lib/seo-tests/defs'
import { FACTS_TESTS } from '@/lib/seo-tests/facts'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import { SHARED_TESTS } from '@/lib/seo-tests/shared'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import { SEO_TEST_IDS, type SeoEvidence, type SeoTest, type SeoTestGroup, type SeoTestId } from '@/lib/seo-tests/types'
import { ORIGIN, PROFILES, artistNode, evidence, graphBlock, healthyGraph, homeHtml, known, page } from '@tests/helpers/seo/page-fixture'

/** The tests of the three groups this file sweeps, read from their registries. */
const THESE: Record<string, SeoTest> = { ...WHO_TESTS, ...SHARED_TESTS, ...FACTS_TESTS }
const ALL: Record<SeoTestId, SeoTest> = { ...FOUND_TESTS, ...WHO_TESTS, ...SHARED_TESTS, ...FACTS_TESTS }

describe('the sweeps cover every test', () => {
  // Each group's registry holds exactly its tests from defs.ts, so a sweep over the registries misses none, and a new test joins every sweep.
  it.each([
    ['who', WHO_TESTS],
    ['shared', SHARED_TESTS],
    ['facts', FACTS_TESTS],
  ] as [SeoTestGroup, Record<string, SeoTest>][])('the "%s" registry matches defs.ts', (group, tests) => {
    const ids = SEO_TEST_DEFS.filter((d) => d.group === group).map((d) => d.id).sort()
    expect(Object.keys(tests).sort()).toEqual(ids)
  })
})

describe('a test that could not look says "couldn’t check"', () => {
  /** A run that reached no home page this way, and could not ask MusicBrainz either. */
  const unreached = (pages: ReturnType<typeof page>[]): SeoEvidence =>
    evidence({ pages, shareImage: null, musicbrainz: { looked: false, artistUrl: null, matchedOn: null, error: 'network' } })

  // Rule 1: with no home page (never visited, no answer, timed out, a 404 or a 503) every test is unknown, carries its own id, and all but the site-free ones (MusicBrainz, YouTube) say why in their sentence.
  it.each([
    ['was not visited', [], 'we didn’t visit your home page'],
    ['gave no answer', [page('/', null, null)], 'your home page didn’t answer'],
    ['timed out', [page('/', null, null, { error: 'timeout' })], 'didn’t answer (it timed out)'],
    ['answered 404', [page('/', null, 404)], 'answered with error 404'],
    ['answered 503', [page('/', null, 503)], 'answered with error 503'],
  ] as [string, ReturnType<typeof page>[], string][])('every test is unknown when the home page %s', (_, pages, why) => {
    for (const [id, test] of Object.entries(THESE)) {
      const r = test(unreached(pages))
      expect(r.id).toBe(id)
      expect(r.status, id).toBe('unknown')
      if (!SITE_FREE_TESTS.has(id as SeoTestId)) expect(r.sentence, id).toContain(why)
    }
  })
})

describe('a home page cut at the read cap', () => {
  /** A home page read only in part: no fact card and no Apple link in the part we read. */
  const cut = () => evidence({ pages: [page('/', homeHtml({ ld: [] }).replace(/<a href="https:\/\/music\.apple\.com[^"]*">Apple Music<\/a>/, ''), 200, { truncated: true })] })

  // Rule 1: what wasn't found may be past the cut, so every test that reads the card or links is unknown and says the page was too big, never a pass or "doesn't apply". (verify-found H1)
  it.each(['genre', 'place', 'profiles', 'shows', 'releases', 'card', 'apple'])('%s is unknown, saying the page was too big', (id) => {
    const r = THESE[id](cut())
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/too big|only part/i)
  })

  // Even with Tour empty (nothing expected), a cut page is no proof that no old show is listed. (verify-found H1)
  it('shows is unknown on a cut page even with Tour empty', () => {
    const e = cut()
    e.known = known({}, { tourDates: [] })
    expect(THESE.shows(e).status).toBe('unknown')
  })

  // The control: a card read whole before the cut is still judged, so the rule above isn't "unknown whenever truncated". (verify-found H1)
  it('still judges a card read whole before the cut', () => {
    const e = evidence({ pages: [page('/', homeHtml(), 200, { truncated: true })] })
    for (const id of ['genre', 'place', 'profiles']) expect(THESE[id](e).status, id).toBe('pass')
  })
})

describe('nothing published from Tapir yet', () => {
  // The tests that compare the site with what Tapir published say "you haven't published", not that we failed to read the site. (verify-found H2)
  it.each(['bio', 'profiles', 'shows', 'releases'])('%s says nothing is published yet', (id) => {
    const r = THESE[id](evidence({ known: known({ published: null }) }))
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/haven’t published/)
  })
})

describe('a detail stating what Tapir holds is labelled "in Tapir"', () => {
  /** Only Tapir holds these. */
  const TAPIR = ['Zqtapirrelease', 'zqtapirprofile', 'Zqtapirvenue', 'Zqtapirtitle', 'Zqtapirgenre', 'Zqtapirregion', 'Iceland', 'Zqtapirbio', 'zqtapirchannel']
  /** Only the site holds these. */
  const SITE = ['Zqsiterelease', 'zqsiteprofile', 'Zqsitevenue', 'Zqsitetitle']
  const has = (text: string, markers: string[]) => markers.filter((m) => text.toLowerCase().includes(m.toLowerCase()))

  /** One site where Tapir and the site disagree on everything the tests compare. */
  function mismatched() {
    const graph = healthyGraph()
    graph[0] = artistNode({
      genre: undefined, // so `genre` fails and names the sound Tapir has
      description: undefined,
      foundingLocation: { '@type': 'Place', name: 'Chicago', address: { '@type': 'PostalAddress', addressLocality: 'Chicago' } },
      sameAs: [...PROFILES, 'https://www.instagram.com/zqsiteprofile/'],
    })
    graph.push({ '@type': 'MusicAlbum', name: 'Zqsiterelease', byArtist: { '@id': `${ORIGIN}/#artist` }, datePublished: '2026-03-01' })
    graph.push({ '@type': 'MusicEvent', name: 'Skeen at Zqsitevenue, Chicago', startDate: '2026-11-20', location: { '@type': 'Place', name: 'Zqsitevenue', address: { '@type': 'PostalAddress', addressLocality: 'Chicago' } } })
    const base = known().published!
    return evidence({
      home: homeHtml({ title: 'Zqsitetitle · Skeen', ld: [graphBlock(graph)], body: '<a href="https://music.apple.com/no/artist/skeen/1754431714">Apple Music</a>' }),
      known: known({}, {
        bio: 'Zqtapirbio is a sentence long enough to be looked for on the page.',
        genre: 'Zqtapirgenre',
        seoTitle: 'Zqtapirtitle',
        region: 'Zqtapirregion',
        country: 'Iceland',
        countryCode: 'IS',
        links: [...base.links, { label: 'Instagram 2', url: 'https://www.instagram.com/zqtapirprofile/', onSite: false }],
        tourDates: [...base.tourDates, { date: '2026-11-01', venue: 'Zqtapirvenue', city: 'Zqtapircity', isPast: false }],
        releases: [...base.releases, { title: 'Zqtapirrelease', releasedOn: '2026-06-01' }],
      }),
      // A channel whose description says none of Tapir's facts, so `youtube` quotes what it looked for.
      youtube: { link: 'https://www.youtube.com/@zqtapirchannel', looked: true, channel: { id: 'UCpa4vYE3su6wUjHg_ck33zw', title: 'Skeen', handle: '@skeen', description: 'Videos every week.' } },
    })
  }
  const results = SEO_TEST_IDS.map((id) => ALL[id](mismatched()))

  // The scenario really puts Tapir-only values in front of the tests, in at least 8 tests: otherwise the two checks below would pass on nothing.
  it('puts Tapir-only values into the details of the tests that compare', () => {
    const quoted = results.flatMap((r) => r.evidence).filter((row) => has(row.value, TAPIR).length)
    const ids = new Set(results.filter((r) => r.evidence.some((row) => has(row.value, TAPIR).length)).map((r) => r.id))
    expect(quoted.length).toBeGreaterThanOrEqual(8)
    for (const id of ['title', 'genre', 'place', 'profiles', 'apple', 'shows', 'releases', 'words', 'youtube'] as SeoTestId[]) expect(ids, id).toContain(id)
  })

  // CRITICAL, rule 3: every row quoting a value only Tapir holds is labelled "in Tapir: …", in every test, so Tapir's data is never passed off as the site's.
  it('labels every row quoting a Tapir-only value "in Tapir"', () => {
    const bad = results.flatMap((r) => r.evidence.filter((row) => has(row.value, TAPIR).length && !/^in Tapir: /.test(row.label)).map((row) => `${r.id} · ${row.label}: ${row.value}`))
    expect(bad).toEqual([])
  })

  // CRITICAL, rule 3: no row labelled "in Tapir" quotes a value only the site holds.
  it('never labels a site-only value "in Tapir"', () => {
    const bad = results.flatMap((r) => r.evidence.filter((row) => /^in Tapir/.test(row.label) && has(row.value, SITE).length).map((row) => `${r.id} · ${row.label}: ${row.value}`))
    expect(bad).toEqual([])
  })
})
