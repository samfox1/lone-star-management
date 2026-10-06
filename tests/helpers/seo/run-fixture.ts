/**
 * Stored SEO / GEO runs for the page's tests, made by the REAL engine over made-up sites, so the
 * page is tested against results the engine really gives.
 *
 * Code:     src/lib/seo-tests/engine.ts (SEO_ENGINE), run.ts (runAllTests), store.ts (capResults)
 * Feature:  SEO / GEO page · the AI test tab, which shows a run
 * Tier:     STRICT (AGENTS.md "Test depth"): the page's counts and states are asserted from these
 *           results, so a hand-written result the engine never gives would test nothing real
 *           (the UI review, 2026-09-29: the first fixture had a Bing FAIL the engine can't give,
 *           so "All pass" went untested).
 * What it provides:
 *           • engineResults(scenario): one real result per test (SEO_TEST_IDS) for a made-up site,
 *             capped as stored
 *           • fixtureResults(over, scenario): the same with some tests forced (only to a status
 *             the engine can really give that test)
 *           • fixtureRun: a stored run around those results (a publish run, or a
 *             manual one)
 *           • the scenarios: healthy, needsWork (Skeen-like), siteDown (timed out), site500,
 *             trainingBlocked, visualArtist (some tests `na`), hostile (html in the title)
 * Not here: the engine's own tests (tests/unit/seo-tests/).
 * Fixtures: each scenario is a made-up site built with the engine's own page fixture
 *           (tests/helpers/seo/page-fixture.ts). It RUNS the engine on import, so when a
 *           test's words change the page's tests read the new words: tests built on it assert
 *           states and counts, never a sentence copied from here.
 */
import { SEO_ENGINE } from '@/lib/seo-tests/engine'
import { runAllTests } from '@/lib/seo-tests/run'
import { FETCHING_BOTS } from '@/lib/seo-tests/bots'
import { capResults, type StoredSeoRun } from '@/lib/seo-tests/store'
import type { SeoEvidence, SeoPageFetch, SeoTestId, SeoTestResult } from '@/lib/seo-tests/types'
import { LONG_BIO, ORIGIN, aboutHtml, artistNode, evidence, graphBlock, healthyGraph, homeHtml, known } from '@tests/helpers/seo/page-fixture'

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
  youtube?: SeoEvidence['youtube']
}

/** The artist's YouTube channel (youtube.ts's answer): healthy, it names the site and the city. */
const YOUTUBE_OK: NonNullable<SeoEvidence['youtube']> = {
  link: 'https://www.youtube.com/@skeenmusic',
  looked: true,
  channel: { id: 'UCpa4vYE3su6wUjHg_ck33zw', title: 'Skeen', handle: '@skeenmusic', description: 'Chicago house DJ and producer. Shows and music: example-artist.com' },
}
/** Skeen's real channel description (tests/fixtures/youtube-channels.json): neither. */
const YOUTUBE_SKEEN: NonNullable<SeoEvidence['youtube']> = { ...YOUTUBE_OK, channel: { ...YOUTUBE_OK.channel!, description: 'skeeeeeeen\n' } }

/** A whole site's evidence: every fetching bot sees what a person sees unless told otherwise. */
function site(o: Over = {}): SeoEvidence {
  const base = evidence({ home: o.home, about: o.about, pages: o.plain, known: o.known, shareImage: o.shareImage, musicbrainz: o.musicbrainz, youtube: o.youtube ?? YOUTUBE_OK })
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
   *  Music link tied to Norway, his real YouTube description. */
  needsWork: () =>
    site({
      youtube: YOUTUBE_SKEEN,
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

/** The engine's real results for a made-up site, as the store would keep them (a fresh copy each call). */
export function engineResults(s: Scenario): SeoTestResult[] {
  if (!cache.has(s)) cache.set(s, capResults(runAllTests(SEO_ENGINE.tests, SCENARIOS[s]())))
  return structuredClone(cache.get(s)!)
}

/** A scenario's results with some tests forced (only to statuses the engine can give them). */
export function fixtureResults(over: Partial<Record<SeoTestId, Partial<SeoTestResult>>> = {}, s: Scenario = 'needsWork'): SeoTestResult[] {
  return engineResults(s).map((r) => ({ ...r, ...over[r.id] }))
}

const RAN_AT = '2026-09-28T21:14:00.000Z'

/** A PUBLISH run (id `run-1`) around `results`, the needsWork scenario by default. */
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
