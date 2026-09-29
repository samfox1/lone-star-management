/**
 * STORED SEO / GEO RUNS FOR THE PAGE'S TESTS, MADE BY THE REAL ENGINE (review 2026-09-29, P3:
 * the first fixture hand-wrote results the engine never produces: "ok" values, a Bing FAIL the
 * engine can only answer `unknown`, sentences it never says). Each scenario is a made-up SITE
 * (tests/unit/seo-tests/_page-fixture.ts, the engine's own fixture), run through the 24 real tests
 * (`runAllTests(SEO_ENGINE.tests, …)`) and capped exactly as the store caps them (`capResults`).
 *
 * It RUNS the engine every time it is imported: when the tests' words change, the page's tests
 * read the new words, and there is no snapshot to go stale. So the page's tests assert what they
 * DERIVE from these results (counts, which rows fail), never a sentence copied from here.
 *
 * `fixtureResults(over)` still lets a test force one status (`na` for the counts, say); use it
 * only for a status the engine can really give that test.
 */
import { SEO_ENGINE } from '@/lib/seo-tests/engine'
import { runAllTests } from '@/lib/seo-tests/run'
import { FETCHING_BOTS } from '@/lib/seo-tests/bots'
import { capResults, type StoredSeoRun } from '@/lib/seo-tests/store'
import { SEO_TEST_IDS, type SeoEvidence, type SeoPageFetch, type SeoTestHistory, type SeoTestId, type SeoTestResult } from '@/lib/seo-tests/types'
import { LONG_BIO, ORIGIN, aboutHtml, artistNode, evidence, graphBlock, healthyGraph, homeHtml, known } from '@tests/unit/seo-tests/_page-fixture'

export { ORIGIN }

export const HOSTILE_IMG = '<img src=x onerror=alert(1)>'
export const HOSTILE_SCRIPT = '</script><script>alert(2)</script>'

type Over = {
  home?: string | null
  about?: string | null
  plain?: SeoPageFetch[]
  bots?: (key: string, p: SeoPageFetch) => SeoPageFetch
  robots?: SeoEvidence['robots']
  sitemap?: SeoEvidence['sitemap']
  known?: SeoEvidence['known']
  shareImage?: SeoEvidence['shareImage']
  musicbrainz?: SeoEvidence['musicbrainz']
}

/** A whole site's evidence: every fetching bot sees what a person sees unless told otherwise. */
function site(o: Over = {}): SeoEvidence {
  const base = evidence({ home: o.home, about: o.about, pages: o.plain, known: o.known, shareImage: o.shareImage, musicbrainz: o.musicbrainz })
  return {
    ...base,
    byBot: Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, base.plain.map((p) => (o.bots ? o.bots(b.key, { ...p }) : { ...p }))])),
    robots: o.robots ?? { status: 200, body: `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n` },
    sitemap:
      o.sitemap === undefined
        ? { status: 200, urls: [`${ORIGIN}/`, `${ORIGIN}/about`], lastmods: ['2026-09-28T12:00:00.000Z', '2026-09-28T12:00:00.000Z'], url: `${ORIGIN}/sitemap.xml`, parsed: true, namedInRobots: true, total: 2, offSite: { count: 0, examples: [] } }
        : o.sitemap,
    bing: { siteAuth: { status: 404, hasUser: false } },
  }
}

const noAnswer = (path: string): SeoPageFetch => ({ path, finalUrl: null, status: null, headers: {}, html: null, error: 'timeout' })
const error500 = (path: string): SeoPageFetch => ({ path, finalUrl: `${ORIGIN}${path}`, status: 500, headers: {}, html: null })
const SHORT_BIO = 'My name is Skeen. I am a Chicago DJ, producer, and filmmaker, building a career in dance music from the ground up.'
const WRONG_STORE = 'https://music.apple.com/no/artist/skeen/1754431714'

const SCENARIOS = {
  /** Everything right, MusicBrainz knows the artist. */
  healthy: () => site({ musicbrainz: { looked: true, artistUrl: 'https://musicbrainz.org/artist/abc', matchedOn: ORIGIN, artistName: 'Skeen', asked: [ORIGIN] } }),
  /** Skeen-like: a short bio, a city with no region or country, no MusicBrainz page, an Apple
   *  Music link tied to Norway. */
  needsWork: () =>
    site({
      known: known({}, { bio: SHORT_BIO, links: [{ label: 'Apple Music', url: WRONG_STORE, onSite: true }] }),
      about: aboutHtml(SHORT_BIO),
      home: homeHtml({
        body: `<a href="${WRONG_STORE}">Apple Music</a>`,
        ld: [graphBlock([artistNode({ homeLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Chicago' } }, foundingLocation: undefined, sameAs: [WRONG_STORE] }), ...healthyGraph().slice(1)])],
      }),
    }),
  /** Every page timed out. */
  siteDown: () =>
    site({
      plain: [noAnswer('/'), noAnswer('/about')],
      bots: (_k, p) => noAnswer(p.path),
      robots: { status: null, body: null },
      sitemap: { status: null, urls: [], lastmods: [], error: 'timeout' },
      shareImage: null,
      musicbrainz: { looked: true, artistUrl: null, matchedOn: null, asked: [ORIGIN] },
    }),
  /** Every page answered error 500. */
  site500: () => site({ plain: [error500('/'), error500('/about')], bots: (_k, p) => error500(p.path), robots: { status: 500, body: null }, sitemap: { status: 500, urls: [], lastmods: [] }, shareImage: null }),
  /** The site asks AI training bots to stay away. */
  trainingBlocked: () => site({ robots: { status: 200, body: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n' } }),
  /** A healthy visual artist: some tests don't apply (`na`). Their home page has words (a
   *  statement), not a music section: a page with none is a real miss the engine reports. */
  visualArtist: () =>
    site({
      known: known({}, { artistType: 'Person', genre: null, releases: [], tourDates: [] }),
      home: homeHtml({
        ld: [graphBlock([artistNode({ '@type': 'Person', genre: undefined, foundingLocation: undefined, homeLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'IL', addressCountry: 'US' } } })])],
        music: '',
        body: `<section>${LONG_BIO.split(/(?<=\.) /).map((p) => `<p>${p.replace(/&/g, '&amp;')}</p>`).join('')}</section>`,
      }),
    }),
  /** A hostile site: its title and summary carry html. */
  hostile: () => site({ home: homeHtml({ title: `Skeen ${HOSTILE_IMG}`, description: `Skeen ${HOSTILE_SCRIPT}` }) }),
} satisfies Record<string, () => SeoEvidence>

export type Scenario = keyof typeof SCENARIOS
export const SCENARIO_NAMES = Object.keys(SCENARIOS) as Scenario[]

const cache = new Map<Scenario, SeoTestResult[]>()

/** The engine's real results for a made-up site, as the store would keep them. */
export function engineResults(s: Scenario): SeoTestResult[] {
  if (!cache.has(s)) cache.set(s, capResults(runAllTests(SEO_ENGINE.tests, SCENARIOS[s]())))
  return structuredClone(cache.get(s)!)
}

/** A scenario's results with some tests forced (only to statuses the engine can give them). */
export function fixtureResults(over: Partial<Record<SeoTestId, Partial<SeoTestResult>>> = {}, s: Scenario = 'needsWork'): SeoTestResult[] {
  return engineResults(s).map((r) => ({ ...r, ...over[r.id] }))
}

export const RAN_AT = '2026-09-28T21:14:00.000Z'

export function fixtureRun(over: Partial<StoredSeoRun> = {}, results?: SeoTestResult[]): StoredSeoRun {
  const rs = results ?? fixtureResults()
  return {
    id: 'run-1',
    artistId: 'a1',
    ranAt: RAN_AT,
    trigger: 'publish',
    siteUrl: ORIGIN,
    results: rs,
    finishedAt: RAN_AT,
    passed: rs.filter((r) => r.status === 'pass').length,
    total: rs.filter((r) => r.status !== 'na').length,
    siteFresh: true,
    publishedAt: '2026-09-28T21:12:00.000Z',
    note: null,
    ...over,
  }
}

/** Each test's last `n` statuses, oldest first, ending in the run's own. */
export function fixtureHistory(results: SeoTestResult[] = fixtureResults(), n = 8): Record<SeoTestId, SeoTestHistory> {
  const day = (i: number) => new Date(Date.parse(RAN_AT) - (n - 1 - i) * 7 * 86_400_000).toISOString()
  return Object.fromEntries(
    SEO_TEST_IDS.map((id) => {
      const status = results.find((r) => r.id === id)?.status ?? 'pass'
      return [id, Array.from({ length: n }, (_, i) => ({ ranAt: day(i), status }))]
    }),
  ) as Record<SeoTestId, SeoTestHistory>
}
