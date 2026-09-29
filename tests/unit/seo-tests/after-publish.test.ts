// After a publish: wait until the live site shows it, THEN test, and record what the wait found; never throw out of the background.
/**
 * src/lib/seo-tests/after-publish.ts. The stale-site trap: the site caches ~60 s, so a run
 * straight after Publish would read the old page. Pinned:
 *   • no site connected: no wait, no claim, no stored run of unknowns;
 *   • the wait happens BEFORE the claim (so "Test again" is not locked out for 90 s, and the
 *     run's clock starts when the site is ready), with the latest publish and every moment;
 *   • a stale or unconfirmed wait is RECORDED on the run (note + site_fresh), never dropped;
 *   • busy (a manual run going) is retried, not lost; a cool-down never applies to a publish;
 *   • the scheduled callback and `after` itself can fail without anything escaping.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SeoEngine } from '@/lib/seo-tests/run'
import { SEO_TEST_IDS, type SeoKnown } from '@/lib/seo-tests/types'
import { fakeClient, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

const h = vi.hoisted(() => ({ after: vi.fn() }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: h.after }))

const A = 'a1'
const ORIGIN = 'https://www.example-artist.com'
const PUBLISHED_AT = '2026-09-28T21:14:03.123456+00:00'
const known = (siteUrl: string | null = ORIGIN): SeoKnown => ({
  artistName: 'Example', siteUrl, today: '2026-09-28',
  published: { bio: null, genre: null, location: null, seoTitle: null, seoDescription: null, ogImage: null, links: [], tourDates: [], releases: [], photos: [], publishedAt: PUBLISHED_AT },
})

const engine: SeoEngine = {
  gatherSiteEvidence: async () => ({ origin: ORIGIN, gatheredAt: '', paths: ['/'], plain: [], byBot: {}, robots: { status: 200, body: '' }, sitemap: null }),
  fetchShareImage: async () => null,
  lookupMusicBrainz: async () => ({ looked: false, artistUrl: null, matchedOn: null }),
  tests: Object.fromEntries(SEO_TEST_IDS.map((id) => [id, () => ({ id, status: 'pass', value: '', sentence: '', evidence: [] })])),
  appleStorefrontFix: () => null,
}

function world(claimErrors: { message: string }[] = []) {
  const order: string[] = []
  const f = fakeClient((c: Call): Reply => {
    if (c.table === 'seo_test_runs' && c.op === 'insert') {
      order.push('claim')
      const err = claimErrors.shift()
      return err ? { error: { code: '23514', ...err } } : { data: { id: 'run-1', ran_at: 'now' } }
    }
    if (c.table === 'seo_test_runs' && c.op === 'update') return { data: { id: 'run-1' } }
    if (c.op === 'rpc' && c.table === 'publish_moments') return { data: [{ published_at: PUBLISHED_AT, entities: 1 }] }
    return { data: null }
  })
  return { ...f, order }
}
const finish = (f: ReturnType<typeof world>) => f.calls.find((c) => c.table === 'seo_test_runs' && c.op === 'update')?.payload as { site_fresh: boolean | null; note: string | null } | undefined

afterEach(() => {
  h.after.mockReset()
  vi.restoreAllMocks()
})

describe('testAfterPublish', () => {
  it('CRITICAL: no site connected: no wait, no claim, nothing stored', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const f = world()
    const wait = vi.fn()
    expect(await testAfterPublish(f.client, A, { engine, readKnown: async () => known(null), wait })).toEqual({ ran: false, reason: 'no-site' })
    expect(wait).not.toHaveBeenCalled()
    expect(f.calls.filter((c) => c.table === 'seo_test_runs')).toEqual([])
  })

  it('CRITICAL: waits for the site FIRST (with the latest publish and every moment), then claims a PUBLISH run', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const f = world()
    const wait = vi.fn(async (o: { publishedAt: string | null | undefined; moments?: readonly string[] }) => {
      f.order.push(`wait:${o.publishedAt}:${o.moments?.length}`)
      return { fresh: true, waitedMs: 20_000, marker: 'sitemap' as const }
    })
    const out = await testAfterPublish(f.client, A, { engine, readKnown: async () => known(), wait })
    expect(out.ran).toBe(true)
    expect(f.order).toEqual([`wait:${PUBLISHED_AT}:1`, 'claim'])
    expect(f.calls.find((c) => c.table === 'seo_test_runs' && c.op === 'insert')?.payload).toEqual({ artist_id: A, trigger: 'publish' })
    expect(finish(f)?.site_fresh).toBe(true)
  })

  it('CRITICAL: a site still showing the old publish is RECORDED: site_fresh false and a plain note', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const f = world()
    await testAfterPublish(f.client, A, { engine, readKnown: async () => known(), wait: async () => ({ fresh: false, waitedMs: 90_000, marker: 'sitemap' }) })
    expect(finish(f)?.site_fresh).toBe(false)
    expect(finish(f)?.note).toMatch(/still showed the last publish after 90 seconds/)
  })

  it('a site with no marker: site_fresh null and "couldn\'t confirm", never true', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const f = world()
    await testAfterPublish(f.client, A, { engine, readKnown: async () => known(), wait: async () => ({ fresh: null, waitedMs: 73_000, marker: 'none' }) })
    expect(finish(f)?.site_fresh).toBeNull()
    expect(finish(f)?.note).toMatch(/couldn’t confirm/)
  })

  it('busy (a manual run is going) is retried, not lost', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const f = world([{ message: 'seo_test_busy: a test is already running' }, { message: 'seo_test_busy: a test is already running' }])
    const sleep = vi.fn(async () => {})
    const out = await testAfterPublish(f.client, A, { engine, readKnown: async () => known(), wait: async () => ({ fresh: true, waitedMs: 0, marker: 'sitemap' }), sleep })
    expect(out.ran && out.outcome.ok).toBe(true)
    expect(f.order).toEqual(['claim', 'claim', 'claim'])
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('busy for good gives up after the retries, quietly', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const f = world(Array.from({ length: 10 }, () => ({ message: 'seo_test_busy: a test is already running' })))
    const out = await testAfterPublish(f.client, A, { engine, readKnown: async () => known(), wait: async () => ({ fresh: true, waitedMs: 0, marker: 'sitemap' }), sleep: async () => {}, busyRetries: 2 })
    expect(out).toEqual({ ran: false, reason: 'busy' })
    expect(f.order).toHaveLength(3)
  })

  it('reading what Tapir knows failing is an outcome, never a throw', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const out = await testAfterPublish(world().client, A, { engine, readKnown: async () => { throw new Error('boom') } })
    expect(out).toMatchObject({ ran: false, reason: 'error' })
  })
})

describe('scheduleSeoTestRun', () => {
  it('CRITICAL: `after` refusing (outside a request) does not throw', async () => {
    const { scheduleSeoTestRun } = await import('@/lib/seo-tests/after-publish')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope.')
    })
    expect(() => scheduleSeoTestRun(world().client, A)).not.toThrow()
  })

  it('the scheduled callback resolves even when everything under it fails', async () => {
    const { scheduleSeoTestRun } = await import('@/lib/seo-tests/after-publish')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = fakeClient(() => {
      throw new Error('socket hang up')
    })
    scheduleSeoTestRun(broken.client, A)
    expect(h.after).toHaveBeenCalledTimes(1)
    await expect((h.after.mock.calls[0][0] as () => Promise<void>)()).resolves.toBeUndefined()
  })
})
