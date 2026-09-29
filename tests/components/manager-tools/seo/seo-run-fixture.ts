/**
 * A stored SEO / GEO run shaped like round 2's mock (prototypes/seo_variants_20260928_r2.html):
 * 19 pass, 5 need you. Built over SEO_TEST_IDS (never a hand-list of ids), so every test has a
 * result; `RESULTS` only says how a test DIFFERS from a plain pass. Hostile evidence rides on
 * two tests on purpose: what a run observed is whatever the site sent.
 */
import { SEO_TEST_IDS, type SeoTestHistory, type SeoTestId, type SeoTestResult } from '@/lib/seo-tests/types'
import type { StoredSeoRun } from '@/lib/seo-tests/store'

export const HOSTILE_IMG = '<img src=x onerror=alert(1)>'
export const HOSTILE_SCRIPT = '</script><script>alert(2)</script>'

const pages = (bot: string) => [
  { label: 'visited as', value: bot },
  { label: '/', value: '200 OK · 0.4 s' },
  { label: '/about', value: '200 OK' },
]

const RESULTS: Partial<Record<SeoTestId, Partial<SeoTestResult>>> = {
  google: { value: '3 of 3 pages', sentence: 'Google can open all 3 of your pages.', evidence: pages('Googlebot/2.1'), limits: 'We can’t see Google’s own index, only what your site sends.' },
  bingwm: {
    status: 'fail',
    value: 'not set up',
    sentence: 'your site isn’t linked to Bing Webmaster Tools yet.',
    todo: 'Add your site in Bing Webmaster Tools. About 5 minutes.',
    action: { kind: 'outside', href: 'https://www.bing.com/webmasters', label: 'Open Bing Webmaster Tools' },
  },
  title: { value: 'Skeen · Chicago house DJ…', sentence: 'Your site’s title is “Skeen · Chicago house DJ and producer”.', evidence: [{ label: 'title', value: HOSTILE_IMG }, { label: 'raw', value: HOSTILE_SCRIPT }] },
  bio: {
    status: 'fail',
    value: '288 of 2,500',
    sentence: 'your bio shows 288 characters on your site. Tapir’s goal is 2,500.',
    good: '2,500+ characters that name your big shows and releases.',
    todo: 'Add your big moments: shows you played, releases, press.',
    action: { kind: 'edit', target: 'bio', label: 'Open the bio editor' },
    evidence: [{ label: 'bio', value: '288 characters · 55 words' }],
  },
  place: {
    status: 'fail',
    value: 'city only',
    sentence: 'your site says Chicago, but not your state or country.',
    todo: 'Add your city, state and country on the Facts tab, then publish.',
    action: { kind: 'edit', target: 'facts', label: 'Add where you’re based' },
  },
  mb: {
    status: 'fail',
    value: 'no page yet',
    sentence: 'MusicBrainz has no page linked to your site or profiles.',
    action: { kind: 'outside', href: 'https://musicbrainz.org/artist/create', label: 'Create it on MusicBrainz' },
  },
  apple: {
    status: 'fail',
    lead: 'Almost',
    value: 'Norway store',
    sentence: 'your Apple Music link opens the Norway store.',
    todo: 'Switch it to the US store. One click.',
    action: { kind: 'fix', fix: 'apple-storefront', label: 'Fix the Apple Music link' },
    evidence: [{ label: 'link', value: 'music.apple.com/no/artist/skeen/1754431714' }],
  },
  shows: { value: 'none booked', sentence: 'No shows are booked, and your last two are listed.' },
  releases: { value: '7 releases', sentence: 'Your 7 releases are listed, newest first.' },
}

export function fixtureResults(over: Partial<Record<SeoTestId, Partial<SeoTestResult>>> = {}): SeoTestResult[] {
  return SEO_TEST_IDS.map((id) => ({
    id,
    status: 'pass',
    value: 'ok',
    sentence: 'All good here.',
    evidence: [],
    ...RESULTS[id],
    ...over[id],
  }))
}

export const RAN_AT = '2026-09-28T21:14:00.000Z'

export function fixtureRun(over: Partial<StoredSeoRun> = {}, results?: SeoTestResult[]): StoredSeoRun {
  const rs = results ?? fixtureResults()
  return {
    id: 'run-1',
    artistId: 'a1',
    ranAt: RAN_AT,
    trigger: 'publish',
    siteUrl: 'https://www.skeenmusic.com',
    results: rs,
    finishedAt: RAN_AT,
    passed: rs.filter((r) => r.status === 'pass').length,
    total: rs.length,
    siteFresh: true,
    publishedAt: '2026-09-28T21:12:00.000Z',
    note: null,
    ...over,
  }
}

/** Each test's last `n` statuses, oldest first, ending in the fixture run's own. */
export function fixtureHistory(results: SeoTestResult[] = fixtureResults(), n = 8): Record<SeoTestId, SeoTestHistory> {
  const day = (i: number) => new Date(Date.parse(RAN_AT) - (n - 1 - i) * 7 * 86_400_000).toISOString()
  return Object.fromEntries(
    SEO_TEST_IDS.map((id) => {
      const status = results.find((r) => r.id === id)?.status ?? 'pass'
      return [id, Array.from({ length: n }, (_, i) => ({ ranAt: day(i), status }))]
    }),
  ) as Record<SeoTestId, SeoTestHistory>
}
