// After a publish that changed a page's words, the sitemap is resent to Google: only for a site Tapir registered, never failing the publish.
/**
 * Code:     src/lib/search-engines/resubmit.ts (resubmitSitemap, scheduleSitemapResubmit, the
 *           two real loaders); wired in actions.ts publishGated (pinned in
 *           tests/unit/seo-tests/runs/publish-hook.test.ts)
 * Feature:  VISIBILITY_RECIPE.md · "The sitemap is resent to Google when content changed"
 * Tier:     STRICT (AGENTS.md "Test depth"): it uses the robot key that owns every client site in
 *           Search Console, reads a service-only table, and runs on Publish.
 * Covers:   • no VERIFIED Google row at an https root address: Google is never asked, and the key
 *             is never loaded
 *           • a verified row: exactly one submit, the property and <property>sitemap.xml, read
 *             for this artist through the service client
 *           • nothing throws out: a refusal, a throw anywhere, `after` itself refusing; the log
 *             line carries codes only, never a message
 *           • the real loaders refuse under vitest
 * Not here: Google's request shape for sitemaps.submit (google.test.ts); which publishes schedule
 *           it (publish-hook.test.ts).
 * Fixtures: a PostgREST fake that answers site_verifications for artist A only; a fake Google
 *           client that records every submit; `after` captured so a test runs it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, filterValue, type Call, type Reply } from '@tests/unit/manager-tools/brand/_fake-client'

const h = vi.hoisted(() => ({ after: vi.fn() }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: h.after }))

import { googleFromEnv, resubmitSitemap, scheduleSitemapResubmit, serviceFromEnv, type ResubmitDeps } from '@/lib/search-engines/resubmit'

const A = 'artist-a'
const SITE = 'https://www.skeenmusic.com/'
const VERIFIED = '2026-09-30T12:00:00Z'

type Row = { provider: string; site_url: string; verified_at: string | null }
const google = (over: Partial<Row> = {}): Row => ({ provider: 'google', site_url: SITE, verified_at: VERIFIED, ...over })
const bing = (over: Partial<Row> = {}): Row => ({ provider: 'bing', site_url: SITE, verified_at: VERIFIED, ...over })

/** site_verifications for artist A only; any other artist has none. */
function service(rows: Row[], { error = false } = {}) {
  return fakeClient((c: Call): Reply => {
    if (c.table !== 'site_verifications' || c.op !== 'select') return { data: [] }
    if (error) return { error: { message: 'read refused' } }
    return { data: filterValue(c, 'artist_id') === A ? rows : [] }
  })
}

/** A fake Google: every submit recorded; `made` counts how often the client (the key) was loaded. */
function fakeGoogle(answer: () => Promise<{ ok: true; value: true } | { ok: false; reason: 'google_sitemap'; status?: number; detail?: string }> = async () => ({ ok: true, value: true })) {
  const submits: [string, string][] = []
  let made = 0
  const make: NonNullable<ResubmitDeps['google']> = async () => {
    made++
    return {
      submitSitemap: async (siteUrl: string, sitemapUrl: string) => {
        submits.push([siteUrl, sitemapUrl])
        return answer()
      },
    }
  }
  return { make, submits, made: () => made }
}

// A block body: a hook that RETURNS a function (mockReset returns the mock) has it run as a teardown.
beforeEach(() => {
  h.after.mockReset()
})

describe('resending the sitemap to Google', () => {
  // Only a VERIFIED Google registration at an https root is a Search Console property the robot
  // owns. Anything else: Google is never asked, and the key is never even loaded.
  it('CRITICAL: no verified Google row at an https root: Google is never asked, the key never loaded', async () => {
    const cases: { name: string; rows: Row[]; error?: boolean; artist?: string }[] = [
      { name: 'no rows', rows: [] },
      { name: 'Google not yet verified', rows: [google({ verified_at: null }), bing()] },
      { name: 'Bing only', rows: [bing()] },
      { name: 'an http address', rows: [google({ site_url: 'http://www.skeenmusic.com/' })] },
      { name: 'not the root', rows: [google({ site_url: `${SITE}music/` })] },
      { name: 'the read failed', rows: [google()], error: true },
      { name: "another artist's row", rows: [google()], artist: 'artist-b' },
    ]
    for (const c of cases) {
      const g = fakeGoogle()
      const out = await resubmitSitemap(c.artist ?? A, { service: () => service(c.rows, { error: c.error }).client, google: g.make })
      expect(out, c.name).toEqual({ sent: false, reason: 'not-registered' })
      expect(g.made(), c.name).toBe(0)
      expect(g.submits, c.name).toEqual([])
    }
  })

  // A registered site: ONE submit, of the property exactly as registered and its sitemap, after
  // reading this artist's row through the service client.
  it('CRITICAL: a verified Google row: exactly one submit, the property and its sitemap', async () => {
    const svc = service([bing(), google()])
    const g = fakeGoogle()
    const out = await resubmitSitemap(A, { service: () => svc.client, google: g.make })
    expect(out).toEqual({ sent: true, siteUrl: SITE, sitemapUrl: `${SITE}sitemap.xml` })
    expect(g.submits).toEqual([[SITE, 'https://www.skeenmusic.com/sitemap.xml']])
    const reads = svc.calls.filter((c) => c.table === 'site_verifications')
    expect(reads).toHaveLength(1)
    expect(filterValue(reads[0], 'artist_id')).toBe(A)
    expect(svc.writes()).toEqual([])
  })

  // It runs after a publish that is already live: a refusal or a throw anywhere is an outcome.
  it('CRITICAL: a refusal or a throw anywhere is an outcome, never a throw', async () => {
    const ok = () => service([google()]).client
    const refused = fakeGoogle(async () => ({ ok: false, reason: 'google_sitemap', status: 403, detail: 'User does not have sufficient permission' }))
    expect(await resubmitSitemap(A, { service: ok, google: refused.make })).toEqual({ sent: false, reason: 'rejected', code: 'google_sitemap', status: 403 })
    const exploding = fakeGoogle(async () => {
      throw new Error('socket hang up')
    })
    expect(await resubmitSitemap(A, { service: ok, google: exploding.make })).toEqual({ sent: false, reason: 'error' })
    const boom = () => {
      throw new Error('boom')
    }
    expect(await resubmitSitemap(A, { service: boom, google: fakeGoogle().make })).toEqual({ sent: false, reason: 'error' })
    expect(await resubmitSitemap(A, { service: ok, google: async () => boom() })).toEqual({ sent: false, reason: 'error' })
    expect(await resubmitSitemap(A, { service: ok, google: async () => null })).toEqual({ sent: false, reason: 'no-key' })
  })

  // Scheduled for after the response; `after` refusing (outside a request) never reaches the
  // publish; and what is logged is codes, never Google's words or an error's message.
  it('CRITICAL: the scheduler runs after the response, never throws, and logs codes only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const g = fakeGoogle(async () => ({ ok: false, reason: 'google_sitemap', status: 403, detail: 'PLANTED-GOOGLE-WORDS' }))
    scheduleSitemapResubmit(A, { service: () => service([google()]).client, google: g.make })
    expect(g.submits).toEqual([]) // nothing before the response has gone
    expect(h.after).toHaveBeenCalledTimes(1)
    await (h.after.mock.calls[0][0] as () => Promise<void>)()
    expect(g.submits).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('google_sitemap 403')
    expect(String(warn.mock.calls[0][0])).not.toContain('PLANTED')

    // A throw inside: logged as a bare reason, its message kept out.
    warn.mockClear()
    h.after.mockReset()
    scheduleSitemapResubmit(A, { service: () => { throw new Error('PLANTED-SECRET-MESSAGE') }, google: g.make })
    await (h.after.mock.calls[0][0] as () => Promise<void>)()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).not.toContain('PLANTED')

    // `after` itself refusing: quiet, and no throw into the publish.
    h.after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope')
    })
    expect(() => scheduleSitemapResubmit(A, { service: () => service([google()]).client, google: g.make })).not.toThrow()
  })

  // Tests load .env.local: a test that forgot to inject its own clients must never read the hosted
  // database or send the real key to Google. With no deps at all, the call ends as an outcome.
  it('CRITICAL: the real loaders refuse inside a test', async () => {
    await expect(googleFromEnv()).rejects.toThrow(/not for tests/)
    expect(() => serviceFromEnv()).toThrow(/not for tests/)
    expect(await resubmitSitemap(A)).toEqual({ sent: false, reason: 'error' })
  })
})
