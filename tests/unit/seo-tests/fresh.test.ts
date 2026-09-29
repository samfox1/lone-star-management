// Is the live site showing the latest publish? The stale-site trap after Publish, judged from the sitemap's lastmod.
/**
 * src/lib/seo-tests/fresh.ts. STRICT: a wrong "fresh" stores a stale verdict as today's truth,
 * which is exactly the dishonesty the Test tab exists to avoid. Pinned:
 *   • fresh ONLY when the sitemap names the latest publish moment (µs vs ms tolerated);
 *   • stale ONLY when it names an OLDER publish we made;
 *   • anything else (no sitemap, date-only, a past show's midnight, a request-time stamp) is null;
 *   • the wait polls sitemap + "/" and returns as soon as the marker turns, gives up at the cap,
 *     and with no marker waits a fixed time and says it could not confirm;
 *   • every poll stays on the site (www/apex twin allowed), never elsewhere.
 */
import { describe, expect, it } from 'vitest'
import { sameSite, siteFreshness, sitemapLastmods, waitForFreshSite } from '@/lib/seo-tests/fresh'

const LATEST = '2026-09-28T21:14:03.123456+00:00'
const OLDER = '2026-09-20T10:00:00.5+00:00'
const MOMENTS = [LATEST, OLDER]

describe('siteFreshness', () => {
  it('CRITICAL: fresh when the newest lastmod is the latest publish (Postgres µs vs JS ms)', () => {
    expect(siteFreshness(['2026-09-28T21:14:03.123Z'], LATEST, MOMENTS)).toBe(true)
    // …and a site that writes whole seconds still names the same publish.
    expect(siteFreshness(['2026-09-28T21:14:03Z'], LATEST, MOMENTS)).toBe(true)
  })

  it('CRITICAL: stale when the newest lastmod is an OLDER publish we made', () => {
    expect(siteFreshness(['2026-09-20T10:00:00.500Z'], LATEST, MOMENTS)).toBe(false)
  })

  it('CRITICAL: a stamp that is no publish of ours is "couldn\'t tell", never fresh', () => {
    // A site that stamps the time of the request: newer than the publish, but not it.
    expect(siteFreshness(['2026-09-28T21:30:00.000Z'], LATEST, MOMENTS)).toBeNull()
    // A past show's midnight (lastModifiedFrom's other candidate).
    expect(siteFreshness(['2026-09-25T00:00:00.000Z'], LATEST, MOMENTS)).toBeNull()
  })

  it('no sitemap, no lastmods, date-only lastmods, or nothing published: null', () => {
    expect(siteFreshness(null, LATEST, MOMENTS)).toBeNull()
    expect(siteFreshness([], LATEST, MOMENTS)).toBeNull()
    expect(siteFreshness(['2026-09-28'], LATEST, MOMENTS)).toBeNull()
    // Even when a publish happened to land just after midnight: a date alone names no publish.
    expect(siteFreshness(['2026-09-28'], '2026-09-28T00:00:00.4+00:00', ['2026-09-28T00:00:00.4+00:00'])).toBeNull()
    expect(siteFreshness([null, '2026-09-28T21:14:03.123Z'], null, MOMENTS)).toBeNull()
  })

  it('the NEWEST lastmod decides (pages share one stamp; a stray old one does not)', () => {
    expect(siteFreshness(['2026-09-20T10:00:00.500Z', '2026-09-28T21:14:03.123Z'], LATEST, MOMENTS)).toBe(true)
  })
})

describe('sitemapLastmods / sameSite', () => {
  it('reads <lastmod>s, and none from a sitemap index', () => {
    expect(sitemapLastmods('<urlset><url><loc>x</loc><lastmod> 2026-09-28T21:14:03.123Z </lastmod></url></urlset>')).toEqual(['2026-09-28T21:14:03.123Z'])
    expect(sitemapLastmods('<sitemapindex><sitemap><lastmod>2026-09-28T21:14:03.123Z</lastmod></sitemap></sitemapindex>')).toEqual([])
  })

  it('a hop may stay on the host or its www twin, and go nowhere else', () => {
    const ok = sameSite('https://skeenmusic.com')
    expect(ok('https://www.skeenmusic.com/sitemap.xml')).toBe(true)
    expect(ok('https://skeenmusic.com/')).toBe(true)
    expect(ok('https://evil.example/')).toBe(false)
    expect(ok('https://skeenmusic.com.evil.example/')).toBe(false)
    expect(ok('http://skeenmusic.com/')).toBe(false) // https → http is a downgrade
  })
})

/** A site whose sitemap shows `lastmods[i]` on the i-th poll (the last one repeats). */
function site(lastmodsByPoll: (string | null)[]) {
  const seen: string[] = []
  let polls = 0
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    seen.push(url)
    if (url.endsWith('/sitemap.xml')) {
      const lm = lastmodsByPoll[Math.min(polls++, lastmodsByPoll.length - 1)]
      const body = lm ? `<urlset><url><loc>https://www.site.example/</loc><lastmod>${lm}</lastmod></url></urlset>` : '<urlset></urlset>'
      return new Response(body, { status: 200 })
    }
    return new Response('<html></html>', { status: 200 })
  }) as typeof fetch
  return { fetcher, seen }
}

/** A clock that only moves when the code sleeps. */
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms), elapsed: () => t }
}

describe('waitForFreshSite', () => {
  it('CRITICAL: returns fresh as soon as the sitemap names this publish, poking "/" each time', async () => {
    const s = site(['2026-09-20T10:00:00.500Z', '2026-09-20T10:00:00.500Z', '2026-09-28T21:14:03.123Z'])
    const c = clock()
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s.fetcher, sleep: c.sleep, now: c.now })
    expect(out).toMatchObject({ fresh: true, marker: 'sitemap' })
    expect(c.elapsed()).toBeLessThan(40_000) // two 10 s waits + the settle, not the whole 90 s
    expect(s.seen.filter((u) => u === 'https://www.site.example/').length).toBe(3)
  })

  it('CRITICAL: gives up at the cap and reports STALE when the site still names the older publish', async () => {
    const s = site(['2026-09-20T10:00:00.500Z'])
    const c = clock()
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s.fetcher, sleep: c.sleep, now: c.now })
    expect(out).toMatchObject({ fresh: false, marker: 'sitemap' })
    expect(c.elapsed()).toBeLessThanOrEqual(90_000)
  })

  it('no marker at all: waits the fixed ~70 s and says it could not confirm (null, not true)', async () => {
    const s = site([null])
    const c = clock()
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s.fetcher, sleep: c.sleep, now: c.now })
    expect(out).toMatchObject({ fresh: null, marker: 'none' })
    expect(c.elapsed()).toBeGreaterThanOrEqual(70_000)
  })

  it('nothing published yet: nothing to wait for, no request made', async () => {
    const s = site([null])
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: null, fetcher: s.fetcher, sleep: async () => {}, now: () => 0 })
    expect(out).toEqual({ fresh: null, waitedMs: 0, marker: 'none' })
    expect(s.seen).toEqual([])
  })

  it('a site that throws on every request never throws out of the wait', async () => {
    const c = clock()
    const fetcher = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    await expect(waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, fetcher, sleep: c.sleep, now: c.now })).resolves.toMatchObject({ fresh: null })
  })
})
