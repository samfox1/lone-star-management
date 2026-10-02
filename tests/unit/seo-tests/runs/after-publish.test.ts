/**
 * After a publish, Tapir waits until the live site shows it, then tests the site once in the
 * background; a burst of publishes collapses to one run, and nothing here can fail the publish.
 *
 * Code:     src/lib/seo-tests/after-publish.ts (testAfterPublish, scheduleSeoTestRun),
 *           src/lib/seo-tests/fresh.ts (siteFreshness, sitemapLastmods, sameSite, waitForFreshSite)
 * Feature:  Test runs · the run after a publish, and "is the site showing the latest publish?"
 * Tier:     STRICT (AGENTS.md "Test depth"): it runs on Publish, and a wrong "fresh" would store
 *           an old site's verdict as today's truth.
 * Covers:   • fresh ONLY when some lastmod names the latest publish, the last CONTENT change, or a
 *             publish after it (µs vs ms tolerated; a Brand-only publish moves no 0.45 date; on
 *             tour the homepage carries a passed show and /about still names the change);
 *             stale ONLY when the newest names a publish of ours before that change; else null
 *           • the wait polls the sitemap and "/", returns as soon as the site turns, gives up at
 *             the cap, waits a fixed time when there is no marker, stops when told to, and every
 *             poll stays on the site (its www twin allowed)
 *           • no site: no wait, no claim, nothing stored
 *           • the settle pause and the wait come BEFORE the claim; the claim is a PUBLISH run for
 *             this publish, by this manager, through the service role
 *           • a newer publish (after the pause, or during the wait) stops this hook; "coalesced"
 *             stops at once; busy / cool-down / limit are retried on the database's seconds
 *           • a stale or unconfirmed site is RECORDED on the run (site_fresh + a plain note)
 *           • `after` refusing, and everything under the scheduled callback failing, never throw
 * Not here: which publishes schedule a run (runs/publish-hook.test.ts); the run itself
 *           (runs/running.test.ts); the stale-site verdict of a manual run (runs/running.test.ts).
 * Fixtures: a fake site whose sitemap names a given publish on each poll; a clock that only moves
 *           when the code sleeps; a reader fake (the manager's session) and a writer fake (the
 *           service role) kept apart; next/server's `after` and the admin client are mocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SeoEngine } from '@/lib/seo-tests/run'
import { sameSite, siteFreshness, sitemapLastmods, waitForFreshSite } from '@/lib/seo-tests/fresh'
import { contentChangedAt, sitemapEntries } from '@samfox1/site-bridge/seo'
import type { PublicSitePayload } from '@samfox1/site-bridge/payload'
import { SEO_TEST_IDS, type SeoKnown } from '@/lib/seo-tests/types'
import { fakeClient, type Call, type Reply } from '@tests/helpers/fake-client'

const h = vi.hoisted(() => ({ after: vi.fn(), admin: null as unknown }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: h.after }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }))

const A = 'a1'
const U = 'user-1'
const ORIGIN = 'https://www.example-artist.com'
const PUBLISHED_AT = '2026-09-28T21:14:03.123456+00:00'
const NEWER = '2026-09-28T21:14:30.000001+00:00'
const known = (siteUrl: string | null = ORIGIN): SeoKnown => ({
  artistName: 'Example', siteUrl, today: '2026-09-28',
  published: { bio: null, genre: null, location: null, seoTitle: null, seoDescription: null, ogImage: null, links: [], tourDates: [], releases: [], photos: [], publishedAt: PUBLISHED_AT, region: null, country: null, countryCode: null, artistType: 'MusicGroup', spotifyArtistId: null },
})

const engine: SeoEngine = {
  gatherSiteEvidence: async () => ({ origin: ORIGIN, gatheredAt: '', paths: ['/'], plain: [], byBot: {}, robots: { status: 200, body: '' }, sitemap: null }),
  fetchShareImage: async () => null,
  lookupMusicBrainz: async () => ({ looked: false, artistUrl: null, matchedOn: null }),
  tests: Object.fromEntries(SEO_TEST_IDS.map((id) => [id, () => ({ id, status: 'pass', value: '', sentence: '', evidence: [] })])),
  appleStorefrontFix: () => null,
}

/** A reader (the manager's session: moments) and a writer (the service role: claim, finish),
 *  kept apart so a test sees which client did what. `answers` are the claim's outcomes in turn. */
function world(answers: { outcome: string; retry_in_s?: number | null }[] = [{ outcome: 'claimed' }], moments: () => string[] = () => [PUBLISHED_AT]) {
  const order: string[] = []
  const reader = fakeClient((c: Call): Reply => {
    if (c.op === 'rpc' && c.table === 'publish_moments') return { data: moments().map((m) => ({ published_at: m, entities: 1 })) }
    return { data: null }
  })
  const writer = fakeClient((c: Call): Reply => {
    if (c.op === 'rpc' && c.table === 'seo_test_claim') {
      const a = answers.shift() ?? { outcome: 'claimed' }
      order.push(`claim:${a.outcome}`)
      return { data: [{ run_id: a.outcome === 'claimed' ? 'run-1' : null, ran_at: 'now', retry_in_s: null, ...a }] }
    }
    if (c.op === 'rpc' && c.table === 'seo_test_finish') return { data: true }
    return { data: null }
  })
  return { reader, writer, order, who: { writer: writer.client, userId: U } }
}
const finish = (w: ReturnType<typeof world>) => w.writer.calls.find((c) => c.table === 'seo_test_finish')?.args as { p_site_fresh: boolean | null; p_note: string | null } | undefined
const claims = (w: ReturnType<typeof world>) => w.writer.calls.filter((c) => c.table === 'seo_test_claim')
const FRESH = async () => ({ fresh: true, waitedMs: 20_000, marker: 'sitemap' as const })
const noSleep = async () => {}

afterEach(() => {
  h.after.mockReset()
  vi.restoreAllMocks()
})

const LATEST = '2026-09-28T21:14:03.123456+00:00'
const OLDER = '2026-09-20T10:00:00.5+00:00'
const MOMENTS = [LATEST, OLDER]

describe('is the live site showing the latest publish? (siteFreshness)', () => {
  // Fresh: the sitemap's stamp is this publish, even though Postgres keeps µs and a site writes ms or whole seconds.
  it('CRITICAL: fresh when the newest lastmod is the latest publish (Postgres µs vs JS ms)', () => {
    expect(siteFreshness(['2026-09-28T21:14:03.123Z'], LATEST, MOMENTS)).toBe(true)
    // …and a site that writes whole seconds still names the same publish.
    expect(siteFreshness(['2026-09-28T21:14:03Z'], LATEST, MOMENTS)).toBe(true)
  })

  // Stale: the stamp is an older publish we made, so the site hasn't updated yet.
  it('CRITICAL: stale when the newest lastmod is an OLDER publish we made', () => {
    expect(siteFreshness(['2026-09-20T10:00:00.500Z'], LATEST, MOMENTS)).toBe(false)
  })

  // Not ours: a request-time stamp or a show's midnight names no publish, so "couldn't tell", never fresh.
  it('CRITICAL: a stamp that is no publish of ours is "couldn\'t tell", never fresh', () => {
    // A site that stamps the time of the request: newer than the publish, but not it.
    expect(siteFreshness(['2026-09-28T21:30:00.000Z'], LATEST, MOMENTS)).toBeNull()
    // A past show's midnight (lastModifiedFrom's other candidate).
    expect(siteFreshness(['2026-09-25T00:00:00.000Z'], LATEST, MOMENTS)).toBeNull()
  })

  // Nothing to judge by (no sitemap, dates without times, nothing published): null.
  it('no sitemap, no lastmods, date-only lastmods, or nothing published: null', () => {
    expect(siteFreshness(null, LATEST, MOMENTS)).toBeNull()
    expect(siteFreshness([], LATEST, MOMENTS)).toBeNull()
    expect(siteFreshness(['2026-09-28'], LATEST, MOMENTS)).toBeNull()
    // Even when a publish happened to land just after midnight: a date alone names no publish.
    expect(siteFreshness(['2026-09-28'], '2026-09-28T00:00:00.4+00:00', ['2026-09-28T00:00:00.4+00:00'])).toBeNull()
    expect(siteFreshness([null, '2026-09-28T21:14:03.123Z'], null, MOMENTS)).toBeNull()
  })

  // One stamp naming the publish is enough: a stray old page date doesn't make the site look stale.
  it('any lastmod naming the publish makes it fresh; a stray old one does not make it stale', () => {
    expect(siteFreshness(['2026-09-20T10:00:00.500Z', '2026-09-28T21:14:03.123Z'], LATEST, MOMENTS)).toBe(true)
  })

  // The line is the last CONTENT change (bridge 0.45 dates the homepage by it). LATEST is a
  // Brand-only publish; MID another look-only one; CONTENT the last content change.
  const CONTENT = '2026-09-28T21:00:00.000001+00:00'
  const MID = '2026-09-28T21:05:00.000001+00:00'
  const ALL = [LATEST, MID, CONTENT, OLDER]

  // A restyle moves no sitemap date on a 0.45 site, so its homepage still names CONTENT: that is fresh.
  it('CRITICAL: a Brand-only publish does not make a 0.45 site stale; one still on older content is', () => {
    expect(siteFreshness(['2026-09-28T21:00:00.000Z'], LATEST, ALL, CONTENT)).toBe(true)
    expect(siteFreshness(['2026-09-20T10:00:00.500Z'], LATEST, ALL, CONTENT)).toBe(false)
  })

  // A 0.44 site stamps published_at: any publish at or after the content change has all the content.
  it('a 0.44 site: the latest publish, or any publish at or after the last content change, is fresh', () => {
    // publish_moments unreadable: the latest publish still counts on its own.
    expect(siteFreshness(['2026-09-28T21:14:03.123Z'], LATEST, [], CONTENT)).toBe(true)
    // An earlier look-only publish: behind on the look, current on everything a test reads.
    expect(siteFreshness(['2026-09-28T21:05:00.000Z'], LATEST, ALL, CONTENT)).toBe(true)
  })

  // One reading: the sitemap a 0.45 site builds and the marker come from the same bridge function.
  it('CRITICAL: a 0.45 sitemap built from the payload reads fresh against contentChangedAt; a passed show never proves fresh', () => {
    type Wire = Pick<PublicSitePayload, 'published_at' | 'tour_dates' | 'changed_at'>
    const payload: Wire = { published_at: LATEST, tour_dates: [], changed_at: { artist: CONTENT, site_content: OLDER, site_styles: LATEST } }
    const lastmods = (p: Wire) =>
      sitemapEntries(p, { origin: ORIGIN, pages: [{ path: '/about', shows: ['site_content'] }], today: '2026-09-28' }).map((e) => e.lastModified?.toISOString())
    expect(siteFreshness(lastmods(payload), LATEST, ALL, contentChangedAt(payload)?.toISOString())).toBe(true)
    // A show that passed after the last content change outranks it on the homepage. A stale
    // site shows that same midnight, so it says nothing either way.
    const show: Wire = { ...payload, changed_at: { artist: OLDER, site_styles: LATEST }, tour_dates: [{ id: 's', date: '2026-09-25', venue: 'V', city: 'C', country: null, ticket_url: null }] }
    expect(lastmods(show)[0]).toBe('2026-09-25T00:00:00.000Z')
    expect(siteFreshness(lastmods(show), LATEST, ALL, contentChangedAt(show)?.toISOString())).toBeNull()
  })

  // On tour: a show that passed after the last content change dates the HOMEPAGE, but /about
  // (the bio, no shows) still names that change. Any stamp naming it proves fresh; the homepage's
  // midnight, which a stale site shows too, proves nothing either way.
  it('CRITICAL: on tour, a passed show dates the homepage and /about names the last content change: fresh; its stale twin never is', () => {
    type Wire = Pick<PublicSitePayload, 'published_at' | 'tour_dates' | 'changed_at'>
    const BIO = '2026-09-22T10:00:00.000001+00:00'
    const show = { id: 's', date: '2026-09-25', venue: 'V', city: 'C', country: null, ticket_url: null }
    const lastmods = (p: Wire) =>
      sitemapEntries(p, { origin: ORIGIN, pages: [{ path: '/about', shows: ['artist'] }], today: '2026-09-28' }).map((e) => e.lastModified?.toISOString())
    const fresh: Wire = { published_at: LATEST, tour_dates: [show], changed_at: { artist: BIO, site_content: OLDER, site_styles: LATEST } }
    const line = contentChangedAt(fresh)?.toISOString()
    const moments = [LATEST, BIO, OLDER]
    expect(lastmods(fresh)[0]).toBe('2026-09-25T00:00:00.000Z') // the show outranks the bio on home
    expect(siteFreshness(lastmods(fresh), LATEST, moments, line)).toBe(true)
    // The same site still on the publish before the bio: home shows the same midnight, /about the older bio.
    const stale: Wire = { published_at: OLDER, tour_dates: [show], changed_at: { artist: OLDER, site_content: OLDER } }
    expect(siteFreshness(lastmods(stale), LATEST, moments, line)).not.toBe(true)
  })
})

describe('reading the sitemap, and staying on the site', () => {
  // Reading lastmods: from a page list, never from a sitemap index (those dates aren't pages).
  it('reads <lastmod>s, and none from a sitemap index', () => {
    expect(sitemapLastmods('<urlset><url><loc>x</loc><lastmod> 2026-09-28T21:14:03.123Z </lastmod></url></urlset>')).toEqual(['2026-09-28T21:14:03.123Z'])
    expect(sitemapLastmods('<sitemapindex><sitemap><lastmod>2026-09-28T21:14:03.123Z</lastmod></sitemap></sitemapindex>')).toEqual([])
  })

  // Staying on the site: a redirect may go to the www twin, never elsewhere and never down to http.
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

describe('waiting for the site to update (waitForFreshSite)', () => {
  // Stop when told: a newer publish supersedes this hook mid-wait, so it must stop polling.
  it('stops early when told to: shouldStop() is asked before every poll, and only then says stopped', async () => {
    // A publish hook superseded by a newer publish must stop polling mid-wait.
    const s = site(['2026-09-20T10:00:00.500Z'])
    const c = clock()
    let asked = 0
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s.fetcher, sleep: c.sleep, now: c.now, shouldStop: () => ++asked > 2 })
    expect(out).toMatchObject({ stopped: true, fresh: null })
    expect(s.seen.filter((u) => u.endsWith('/sitemap.xml'))).toHaveLength(2)
    expect(c.elapsed()).toBeLessThan(30_000)
    // Never told to stop: nothing says stopped.
    const s2 = site(['2026-09-28T21:14:03.123Z'])
    const c2 = clock()
    const out2 = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s2.fetcher, sleep: c2.sleep, now: c2.now, shouldStop: () => false })
    expect(out2).toMatchObject({ fresh: true })
    expect(out2.stopped).toBeUndefined()
  })

  // Stop on abort: before the first poll, and during a pause between polls.
  it('stops early on an aborted signal, before the first poll, and during a wait', async () => {
    const s = site(['2026-09-20T10:00:00.500Z'])
    const gone = new AbortController()
    gone.abort()
    const first = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s.fetcher, sleep: clock().sleep, now: clock().now, signal: gone.signal })
    expect(first).toMatchObject({ stopped: true, waitedMs: 0 })
    expect(s.seen).toHaveLength(0)

    // Real time: a 10 s pause between polls is cut short when the signal fires.
    const later = new AbortController()
    setTimeout(() => later.abort(), 50)
    const t = Date.now()
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s.fetcher, signal: later.signal })
    expect(out).toMatchObject({ stopped: true })
    expect(Date.now() - t).toBeLessThan(2000)
  })

  // After a Brand-only publish a 0.45 site keeps naming the last content change: fresh at once, no 90 s wait.
  it('CRITICAL: after a Brand-only publish, a site naming the last content change is fresh at once', async () => {
    const s = site(['2026-09-28T21:00:00.000Z'])
    const c = clock()
    const content = '2026-09-28T21:00:00.000001+00:00'
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, contentAt: content, moments: [LATEST, content, OLDER], fetcher: s.fetcher, sleep: c.sleep, now: c.now })
    expect(out).toMatchObject({ fresh: true, marker: 'sitemap' })
    expect(c.elapsed()).toBeLessThan(10_000)
  })

  // Early return: test as soon as the site shows the publish, poking "/" each time to wake a cached site.
  it('CRITICAL: returns fresh as soon as the sitemap names this publish, poking "/" each time', async () => {
    const s = site(['2026-09-20T10:00:00.500Z', '2026-09-20T10:00:00.500Z', '2026-09-28T21:14:03.123Z'])
    const c = clock()
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s.fetcher, sleep: c.sleep, now: c.now })
    expect(out).toMatchObject({ fresh: true, marker: 'sitemap' })
    expect(c.elapsed()).toBeLessThan(40_000) // two 10 s waits + the settle, not the whole 90 s
    expect(s.seen.filter((u) => u === 'https://www.site.example/').length).toBe(3)
  })

  // The cap: give up in time and report stale, so the run can say the site hadn't updated.
  it('CRITICAL: gives up at the cap and reports STALE when the site still names the older publish', async () => {
    const s = site(['2026-09-20T10:00:00.500Z'])
    const c = clock()
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s.fetcher, sleep: c.sleep, now: c.now })
    expect(out).toMatchObject({ fresh: false, marker: 'sitemap' })
    expect(c.elapsed()).toBeLessThanOrEqual(90_000)
  })

  // No marker: wait a fixed time, then say we couldn't confirm (null), never "fresh".
  it('no marker at all: waits the fixed ~70 s and says it could not confirm (null, not true)', async () => {
    const s = site([null])
    const c = clock()
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, moments: MOMENTS, fetcher: s.fetcher, sleep: c.sleep, now: c.now })
    expect(out).toMatchObject({ fresh: null, marker: 'none' })
    expect(c.elapsed()).toBeGreaterThanOrEqual(70_000)
  })

  // Nothing published: nothing to wait for, and no request is made.
  it('nothing published yet: nothing to wait for, no request made', async () => {
    const s = site([null])
    const out = await waitForFreshSite({ origin: 'https://www.site.example', publishedAt: null, fetcher: s.fetcher, sleep: async () => {}, now: () => 0 })
    expect(out).toEqual({ fresh: null, waitedMs: 0, marker: 'none' })
    expect(s.seen).toEqual([])
  })

  // A broken site never throws out of the wait (it runs in the background after Publish).
  it('a site that throws on every request never throws out of the wait', async () => {
    const c = clock()
    const fetcher = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    await expect(waitForFreshSite({ origin: 'https://www.site.example', publishedAt: LATEST, fetcher, sleep: c.sleep, now: c.now })).resolves.toMatchObject({ fresh: null })
  })
})

describe('the test after a publish (testAfterPublish)', () => {
  // No site: nothing to wait for or test, and no run of 24 unknowns is stored.
  it('CRITICAL: no site connected: no wait, no claim, nothing stored', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    const wait = vi.fn()
    expect(await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(null), wait, sleep: noSleep })).toEqual({ ran: false, reason: 'no-site' })
    expect(wait).not.toHaveBeenCalled()
    expect(claims(w)).toEqual([])
  })

  // The order: pause, wait for the site, then claim a publish run in this manager's name, as the service role.
  it('CRITICAL: settles, waits for the site, THEN claims a PUBLISH run for this publish, by this manager, as the service role', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    const steps: string[] = []
    const CONTENT_AT = '2026-09-28T21:00:00.000Z'
    const k = known()
    const out = await testAfterPublish(w.reader.client, A, w.who, {
      engine, readKnown: async () => ({ ...k, published: { ...k.published!, contentAt: CONTENT_AT } }),
      sleep: async (ms) => void steps.push(`sleep:${ms}`),
      wait: async (o) => (steps.push(`wait:${o.publishedAt}:${o.contentAt}`), FRESH()),
    })
    expect(out.ran).toBe(true)
    // The wait judges by the last CONTENT change too (a Brand-only publish moves no sitemap date).
    expect(steps).toEqual(['sleep:10000', `wait:${PUBLISHED_AT}:${CONTENT_AT}`])
    expect(claims(w)).toHaveLength(1)
    expect(claims(w)[0].args).toEqual({ p_artist_id: A, p_trigger: 'publish', p_user_id: U, p_published_at: PUBLISHED_AT })
    // The manager's session wrote nothing.
    expect(w.reader.calls.filter((c) => c.table.startsWith('seo_test'))).toEqual([])
    expect(finish(w)?.p_site_fresh).toBe(true)
  })

  // A burst: a newer publish after the pause means this hook stops; the newer one will test.
  it('CRITICAL: a burst collapses: a newer publish after the settle pause means this hook stops, no wait, no claim', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world([{ outcome: 'claimed' }], () => [NEWER, PUBLISHED_AT])
    const wait = vi.fn(FRESH)
    expect(await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), wait, sleep: noSleep })).toEqual({ ran: false, reason: 'superseded' })
    expect(wait).not.toHaveBeenCalled()
    expect(claims(w)).toEqual([])
  })

  // A newer publish during the wait also stops this hook before it claims.
  it('a newer publish that lands DURING the wait also stops it before the claim', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    let newer = false
    const w = world([{ outcome: 'claimed' }], () => (newer ? [NEWER, PUBLISHED_AT] : [PUBLISHED_AT]))
    const out = await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), sleep: noSleep, wait: async () => ((newer = true), FRESH()) })
    expect(out).toEqual({ ran: false, reason: 'superseded' })
    expect(claims(w)).toEqual([])
  })

  // Coalesced: this publish is already covered, so stop at once, no retry.
  it('CRITICAL: "coalesced" (this publish is already covered) stops at once, no retry', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world([{ outcome: 'coalesced' }])
    expect(await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), wait: FRESH, sleep: noSleep })).toEqual({ ran: false, reason: 'coalesced' })
    expect(claims(w)).toHaveLength(1)
  })

  // Retries: busy, cool-down and the limit are retried on the database's own seconds (capped at 15 s).
  it('CRITICAL: busy, cool-down and the per-person limit are retried, sleeping the database\'s seconds (capped at 15 s)', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world([{ outcome: 'busy', retry_in_s: 10 }, { outcome: 'cooldown', retry_in_s: 42 }, { outcome: 'limit', retry_in_s: 3 }, { outcome: 'claimed' }])
    const sleeps: number[] = []
    const out = await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), wait: FRESH, sleep: async (ms) => void sleeps.push(ms) })
    expect(out.ran && out.outcome.ok).toBe(true)
    expect(w.order).toEqual(['claim:busy', 'claim:cooldown', 'claim:limit', 'claim:claimed'])
    expect(sleeps).toEqual([10_000, 10_000, 15_000, 3_000]) // the settle pause, then each retry's wait
  })

  // Giving up: after the retry window, quietly (the publish already succeeded).
  it('gives up quietly when the retry window runs out', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world(Array.from({ length: 50 }, () => ({ outcome: 'busy', retry_in_s: 10 })))
    let t = 0
    const out = await testAfterPublish(w.reader.client, A, w.who, {
      engine, readKnown: async () => known(), wait: FRESH, now: () => t, sleep: async (ms) => void (t += ms), retryWindowMs: 45_000,
    })
    expect(out).toEqual({ ran: false, reason: 'gave-up' })
    expect(claims(w).length).toBeGreaterThanOrEqual(4)
    expect(claims(w).length).toBeLessThanOrEqual(6)
  })

  // A stale site is recorded on the run (site_fresh false + a plain note), never dropped.
  it('CRITICAL: a site still showing the old publish is RECORDED: site_fresh false and a plain note', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), sleep: noSleep, wait: async () => ({ fresh: false, waitedMs: 90_000, marker: 'sitemap' }) })
    expect(finish(w)?.p_site_fresh).toBe(false)
    expect(finish(w)?.p_note).toMatch(/still showed the last publish after 90 seconds/)
  })

  // No marker: recorded as "couldn't confirm" (null), never as fresh.
  it('a site with no marker: site_fresh null and "couldn\'t confirm", never true', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), sleep: noSleep, wait: async () => ({ fresh: null, waitedMs: 73_000, marker: 'none' }) })
    expect(finish(w)?.p_site_fresh).toBeNull()
    expect(finish(w)?.p_note).toMatch(/couldn’t confirm/)
  })

  // A failed read is an outcome, never a throw out of the background job.
  it('reading what Tapir knows failing is an outcome, never a throw', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    expect(await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => { throw new Error('boom') } })).toMatchObject({ ran: false, reason: 'error' })
  })
})

describe('scheduling it in the background (scheduleSeoTestRun)', () => {
  // `after` refusing (outside a request) must not throw into the publish.
  it('CRITICAL: `after` refusing (outside a request) does not throw', async () => {
    const { scheduleSeoTestRun } = await import('@/lib/seo-tests/after-publish')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope.')
    })
    expect(() => scheduleSeoTestRun(world().reader.client, A, U)).not.toThrow()
  })

  // The background job resolves even when everything under it fails.
  it('the scheduled callback resolves even when everything under it fails', async () => {
    const { scheduleSeoTestRun } = await import('@/lib/seo-tests/after-publish')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = fakeClient(() => {
      throw new Error('socket hang up')
    })
    h.admin = broken.client
    scheduleSeoTestRun(broken.client, A, U)
    expect(h.after).toHaveBeenCalledTimes(1)
    await expect((h.after.mock.calls[0][0] as () => Promise<void>)()).resolves.toBeUndefined()
  })
})
