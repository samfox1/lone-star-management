/**
 * Stored runs made by the REAL engine (lib/seo-tests `SEO_ENGINE` over the page fixture), not
 * hand-written results (the UI review, 2026-09-29, P3/T1: the hand fixture had `bingwm` failing,
 * which the engine never does, so "All 24 pass" went untested). Tests built on these assert
 * STATES and COUNTS only, never a sentence: the engine's words are being reworded.
 *
 *   healthy       a site that answers and says who it is
 *   down          every page times out
 *   error500      every page answers error 500
 *   visualArtist  a Person: the genre and MusicBrainz tests don't apply (`na`)
 */
import { SEO_ENGINE } from '@/lib/seo-tests/engine'
import { runAllTests } from '@/lib/seo-tests/run'
import { FETCHING_BOTS } from '@/lib/seo-tests/bots'
import { capResults, type StoredSeoRun } from '@/lib/seo-tests/store'
import type { SeoEvidence, SeoPageFetch, SeoTestResult } from '@/lib/seo-tests/types'
import { ORIGIN, artistNode, evidence, graphBlock, homeHtml, known } from '@tests/unit/seo-tests/_page-fixture'

type Over = { plain?: SeoPageFetch[]; bots?: (p: SeoPageFetch) => SeoPageFetch; robots?: SeoEvidence['robots']; sitemap?: SeoEvidence['sitemap']; known?: SeoEvidence['known']; shareImage?: SeoEvidence['shareImage']; musicbrainz?: SeoEvidence['musicbrainz']; home?: string | null }

function full(o: Over = {}): SeoEvidence {
  const base = evidence({ home: o.home, pages: o.plain, known: o.known, shareImage: o.shareImage, musicbrainz: o.musicbrainz })
  return {
    ...base,
    byBot: Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, base.plain.map((p) => (o.bots ? o.bots({ ...p }) : { ...p }))])),
    robots: o.robots ?? { status: 200, body: `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n` },
    sitemap:
      o.sitemap === undefined
        ? { status: 200, urls: [`${ORIGIN}/`, `${ORIGIN}/about`], lastmods: ['2026-09-28T12:00:00.000Z', '2026-09-28T12:00:00.000Z'], url: `${ORIGIN}/sitemap.xml`, parsed: true, namedInRobots: true, total: 2, offSite: { count: 0, examples: [] } } as SeoEvidence['sitemap']
        : o.sitemap,
    bing: { siteAuth: { status: 404, hasUser: false } },
  } as SeoEvidence
}

const down = (path: string): SeoPageFetch => ({ path, finalUrl: null, status: null, headers: {}, html: null, error: 'timeout' })
const err500 = (path: string): SeoPageFetch => ({ path, finalUrl: `${ORIGIN}${path}`, status: 500, headers: {}, html: null })

const SCENARIOS = {
  healthy: () => full({ musicbrainz: { looked: true, artistUrl: 'https://musicbrainz.org/artist/abc', matchedOn: ORIGIN } as SeoEvidence['musicbrainz'] }),
  down: () =>
    full({
      plain: [down('/'), down('/about')],
      bots: (p) => down(p.path),
      robots: { status: null, body: null },
      sitemap: { status: null, urls: [], lastmods: [], error: 'timeout' } as SeoEvidence['sitemap'],
      shareImage: null,
      musicbrainz: { looked: true, artistUrl: null, matchedOn: null } as SeoEvidence['musicbrainz'],
    }),
  error500: () =>
    full({
      plain: [err500('/'), err500('/about')],
      bots: (p) => err500(p.path),
      robots: { status: 500, body: null },
      sitemap: { status: 500, urls: [], lastmods: [] } as SeoEvidence['sitemap'],
      shareImage: null,
    }),
  visualArtist: () =>
    full({
      known: known({}, { artistType: 'Person', genre: null, releases: [], tourDates: [] }),
      home: homeHtml({
        ld: [graphBlock([artistNode({ '@type': 'Person', genre: undefined, foundingLocation: undefined, homeLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'IL', addressCountry: 'US' } } })])],
        music: '',
      }),
    }),
} as const

export type Scenario = keyof typeof SCENARIOS

export function engineResults(name: Scenario): SeoTestResult[] {
  return capResults(runAllTests(SEO_ENGINE.tests, SCENARIOS[name]()))
}

export function engineRun(name: Scenario, over: Partial<StoredSeoRun> = {}): StoredSeoRun {
  const results = engineResults(name)
  return {
    id: `run-${name}`,
    artistId: 'a1',
    ranAt: '2026-09-28T21:14:00.000Z',
    trigger: 'manual',
    siteUrl: ORIGIN,
    results,
    finishedAt: '2026-09-28T21:14:00.000Z',
    passed: results.filter((r) => r.status === 'pass').length,
    total: results.filter((r) => r.status !== 'na').length,
    siteFresh: true,
    publishedAt: null,
    note: null,
    ...over,
  }
}

export { ORIGIN as ENGINE_ORIGIN }
