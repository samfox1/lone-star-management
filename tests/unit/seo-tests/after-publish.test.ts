// After a publish: settle, skip if a newer publish came, wait until the live site shows it, THEN test through the service role; bursts collapse.
/**
 * src/lib/seo-tests/after-publish.ts. Pinned:
 *   • no site connected: no wait, no claim, no stored run of unknowns;
 *   • a burst collapses: a hook whose publish is no longer the newest stops (after the settle
 *     pause, after the wait, and before every retry), and the database coalesces the rest;
 *   • the wait happens BEFORE the claim, and the claim is a PUBLISH claim for THIS publish, by
 *     THIS manager, through the service-role writer (never the manager's session);
 *   • busy / cool-down / the per-person limit are retried inside a window, using the database's
 *     seconds; "coalesced" stops at once; giving up is quiet;
 *   • a stale or unconfirmed wait is RECORDED on the run (note + site_fresh), never dropped;
 *   • the scheduled callback and `after` itself can fail without anything escaping.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SeoEngine } from '@/lib/seo-tests/run'
import { SEO_TEST_IDS, type SeoKnown } from '@/lib/seo-tests/types'
import { fakeClient, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

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

describe('testAfterPublish', () => {
  it('CRITICAL: no site connected: no wait, no claim, nothing stored', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    const wait = vi.fn()
    expect(await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(null), wait, sleep: noSleep })).toEqual({ ran: false, reason: 'no-site' })
    expect(wait).not.toHaveBeenCalled()
    expect(claims(w)).toEqual([])
  })

  it('CRITICAL: settles, waits for the site, THEN claims a PUBLISH run for this publish, by this manager, as the service role', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    const steps: string[] = []
    const out = await testAfterPublish(w.reader.client, A, w.who, {
      engine, readKnown: async () => known(),
      sleep: async (ms) => void steps.push(`sleep:${ms}`),
      wait: async (o) => (steps.push(`wait:${o.publishedAt}`), FRESH()),
    })
    expect(out.ran).toBe(true)
    expect(steps).toEqual(['sleep:10000', `wait:${PUBLISHED_AT}`])
    expect(claims(w)).toHaveLength(1)
    expect(claims(w)[0].args).toEqual({ p_artist_id: A, p_trigger: 'publish', p_user_id: U, p_published_at: PUBLISHED_AT })
    // The manager's session wrote nothing.
    expect(w.reader.calls.filter((c) => c.table.startsWith('seo_test'))).toEqual([])
    expect(finish(w)?.p_site_fresh).toBe(true)
  })

  it('CRITICAL: a burst collapses: a newer publish after the settle pause means this hook stops, no wait, no claim', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world([{ outcome: 'claimed' }], () => [NEWER, PUBLISHED_AT])
    const wait = vi.fn(FRESH)
    expect(await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), wait, sleep: noSleep })).toEqual({ ran: false, reason: 'superseded' })
    expect(wait).not.toHaveBeenCalled()
    expect(claims(w)).toEqual([])
  })

  it('a newer publish that lands DURING the wait also stops it before the claim', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    let newer = false
    const w = world([{ outcome: 'claimed' }], () => (newer ? [NEWER, PUBLISHED_AT] : [PUBLISHED_AT]))
    const out = await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), sleep: noSleep, wait: async () => ((newer = true), FRESH()) })
    expect(out).toEqual({ ran: false, reason: 'superseded' })
    expect(claims(w)).toEqual([])
  })

  it('CRITICAL: "coalesced" (this publish is already covered) stops at once, no retry', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world([{ outcome: 'coalesced' }])
    expect(await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), wait: FRESH, sleep: noSleep })).toEqual({ ran: false, reason: 'coalesced' })
    expect(claims(w)).toHaveLength(1)
  })

  it('CRITICAL: busy, cool-down and the per-person limit are retried, sleeping the database\'s seconds (capped at 15 s)', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world([{ outcome: 'busy', retry_in_s: 10 }, { outcome: 'cooldown', retry_in_s: 42 }, { outcome: 'limit', retry_in_s: 3 }, { outcome: 'claimed' }])
    const sleeps: number[] = []
    const out = await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), wait: FRESH, sleep: async (ms) => void sleeps.push(ms) })
    expect(out.ran && out.outcome.ok).toBe(true)
    expect(w.order).toEqual(['claim:busy', 'claim:cooldown', 'claim:limit', 'claim:claimed'])
    expect(sleeps).toEqual([10_000, 10_000, 15_000, 3_000]) // the settle pause, then each retry's wait
  })

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

  it('CRITICAL: a site still showing the old publish is RECORDED: site_fresh false and a plain note', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), sleep: noSleep, wait: async () => ({ fresh: false, waitedMs: 90_000, marker: 'sitemap' }) })
    expect(finish(w)?.p_site_fresh).toBe(false)
    expect(finish(w)?.p_note).toMatch(/still showed the last publish after 90 seconds/)
  })

  it('a site with no marker: site_fresh null and "couldn\'t confirm", never true', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => known(), sleep: noSleep, wait: async () => ({ fresh: null, waitedMs: 73_000, marker: 'none' }) })
    expect(finish(w)?.p_site_fresh).toBeNull()
    expect(finish(w)?.p_note).toMatch(/couldn’t confirm/)
  })

  it('reading what Tapir knows failing is an outcome, never a throw', async () => {
    const { testAfterPublish } = await import('@/lib/seo-tests/after-publish')
    const w = world()
    expect(await testAfterPublish(w.reader.client, A, w.who, { engine, readKnown: async () => { throw new Error('boom') } })).toMatchObject({ ran: false, reason: 'error' })
  })
})

describe('scheduleSeoTestRun', () => {
  it('CRITICAL: `after` refusing (outside a request) does not throw', async () => {
    const { scheduleSeoTestRun } = await import('@/lib/seo-tests/after-publish')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope.')
    })
    expect(() => scheduleSeoTestRun(world().reader.client, A, U)).not.toThrow()
  })

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
