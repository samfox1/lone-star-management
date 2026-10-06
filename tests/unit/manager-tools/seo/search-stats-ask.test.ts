/**
 * Asking both engines for an artist's search numbers: only where the site is registered, both at
 * once, inside a deadline, and never with the real keys from a test.
 *
 * Code:     src/lib/manager-tools/seo/search-stats-ask.ts
 * Feature:  SEO / GEO page · "How fans find you" (data side, 2026-10-02)
 * Tier:     LIGHT for the asking (the tab isn't designed yet; deps injected), STRICT for the
 *           secret rule: the env-backed deps refuse under vitest, so no test can reach the real
 *           keys (2026-09-30: a test printed part of the real Google key).
 * Covers:   • nothing registered: both engines `not_registered`, no client built, no key read
 *           • registered: Google gets the period's six requests on the REGISTERED address (total
 *             first, the rest only if it answered); Bing its three calls
 *           • no key on the server: `no_key`; an engine that doesn't answer by the deadline: `timeout`
 *             (the other engine's answer still stands); a throw: `error`
 *           • what may be cached: answers and a settled "no key" / one engine not registered;
 *             never a refusal, an error, a timeout, or "nothing registered yet"
 *           • the env-backed deps refuse under vitest
 *           • the answer carries each engine's registration date (the Search tab's "added Sep 30")
 * Not here: the numbers themselves (search-stats.test.ts); the calls (search-stats-calls.test.ts).
 * Fixtures: fake clients answering already-parsed rows; no network, no database.
 */
import { describe, expect, it } from 'vitest'
import { askSearchStats, isCacheable, searchStatsDepsFromEnv, type SearchClients, type SearchStatsDeps } from '@/lib/manager-tools/seo/search-stats-ask'
import { GOOGLE_PARTS, googleRequests, searchPeriod } from '@/lib/manager-tools/seo/search-stats'
import type { GoogleSearchRequest } from '@/lib/search-engines/google'

const ARTIST = 'c6c2ea6e-4135-4ebb-afbe-8c9e21785f57'
const SITE = 'https://www.skeenmusic.com/'
const NOW = Date.UTC(2026, 9, 2, 19)

const answer = (rows: { keys: string[]; clicks: number; impressions: number; position: number | null }[]) => ({ ok: true as const, value: { rows, firstIncompleteDate: null } })
const DAY = { date: '2026-10-01', clicks: 4, impressions: 19 }

function fakes(over: Partial<{ google: SearchClients['google']; bing: SearchClients['bing']; registered: { provider: 'google' | 'bing'; siteUrl: string; verifiedAt?: string }[] }> = {}) {
  const asked: { engine: string; site: string; req?: GoogleSearchRequest }[] = []
  let built = 0
  const google: SearchClients['google'] =
    over.google === undefined
      ? {
          async searchAnalytics(site, req) {
            asked.push({ engine: 'google', site, req })
            return answer(req.dimensions?.length ? [] : [{ keys: [], clicks: 15, impressions: 56, position: 2.4 }])
          },
        }
      : over.google
  const bing: SearchClients['bing'] =
    over.bing === undefined
      ? {
          trafficStats: async (site) => (asked.push({ engine: 'bing:traffic', site }), { ok: true, value: [DAY] }),
          queryStats: async (site) => (asked.push({ engine: 'bing:queries', site }), { ok: true, value: [] }),
          pageStats: async (site) => (asked.push({ engine: 'bing:pages', site }), { ok: true, value: [] }),
        }
      : over.bing
  const deps: SearchStatsDeps = {
    readRegistered: async () => over.registered ?? [{ provider: 'google', siteUrl: SITE }, { provider: 'bing', siteUrl: SITE }],
    clients: async () => {
      built++
      return { google, bing }
    },
    now: () => NOW,
    deadlineMs: 200,
  }
  return { deps, asked, built: () => built }
}

describe('askSearchStats', () => {
  // No registration: nothing is asked and no key is read.
  it('says not_registered for both and builds no client when nothing is registered', async () => {
    const f = fakes({ registered: [] })
    const r = await askSearchStats(ARTIST, '28d', f.deps)
    expect([r.google.state, r.bing.state]).toEqual(['not_registered', 'not_registered'])
    expect(f.built()).toBe(0)
    expect(f.asked).toHaveLength(0)
  })

  // The main path: both engines asked on the registered address, Google with the period's
  // requests exactly (derived, not hand-listed), its total first.
  it('asks both engines on the registered address with the period’s requests', async () => {
    const f = fakes()
    const r = await askSearchStats(ARTIST, '28d', f.deps)
    expect(r.google.state).toBe('ok')
    expect(r.bing.state).toBe('ok')
    expect(r.period).toEqual(searchPeriod('28d', NOW))
    const g = f.asked.filter((a) => a.engine === 'google')
    expect(g.every((a) => a.site === SITE)).toBe(true)
    expect(g[0].req).toEqual(googleRequests(r.period).total)
    expect(g.map((a) => a.req)).toEqual(expect.arrayContaining(GOOGLE_PARTS.map((p) => googleRequests(r.period)[p])))
    expect(g).toHaveLength(GOOGLE_PARTS.length)
    expect(f.asked.filter((a) => a.engine.startsWith('bing')).map((a) => a.engine).sort()).toEqual(['bing:pages', 'bing:queries', 'bing:traffic'])
  })

  // A refused total stops Google there: one request, not six.
  it('asks Google nothing more when the total is refused', async () => {
    const asked: GoogleSearchRequest[] = []
    const f = fakes({ google: { searchAnalytics: async (_s, req) => (asked.push(req), { ok: false, reason: 'google_stats', status: 429 }) } })
    const r = await askSearchStats(ARTIST, '3m', f.deps)
    expect(r.google.state).toBe('quota')
    expect(asked).toHaveLength(1)
  })

  // One engine registered; the other's key missing on the server; one that never answers.
  it('says no_key, timeout and error per engine, and the other engine still stands', async () => {
    const noKey = await askSearchStats(ARTIST, '28d', fakes({ google: null }).deps)
    expect([noKey.google.state, noKey.bing.state]).toEqual(['no_key', 'ok'])
    const onlyBing = await askSearchStats(ARTIST, '28d', fakes({ registered: [{ provider: 'bing', siteUrl: SITE }] }).deps)
    expect([onlyBing.google.state, onlyBing.bing.state]).toEqual(['not_registered', 'ok'])
    const hang = await askSearchStats(ARTIST, '28d', fakes({ google: { searchAnalytics: () => new Promise(() => {}) } }).deps)
    expect([hang.google.state, hang.bing.state]).toEqual(['timeout', 'ok'])
    const boom = await askSearchStats(ARTIST, '28d', fakes({ bing: { trafficStats: async () => Promise.reject(new Error('x')), queryStats: async () => ({ ok: true, value: [] }), pageStats: async () => ({ ok: true, value: [] }) } }).deps)
    expect([boom.google.state, boom.bing.state]).toEqual(['ok', 'error'])
  })

  // The answer carries when each engine was registered (the Search tab's "added Sep 30"), and
  // nothing when that engine isn't registered or the read failed.
  it('carries each engine’s registration date', async () => {
    const at = '2026-09-30T18:20:00.000Z'
    const r = await askSearchStats(ARTIST, '28d', fakes({ registered: [{ provider: 'bing', siteUrl: SITE, verifiedAt: at }] }).deps)
    expect(r.added).toEqual({ google: null, bing: at })
    const none = await askSearchStats(ARTIST, '28d', { ...fakes().deps, readRegistered: async () => Promise.reject(new Error('db')) })
    expect(none.added).toEqual({ google: null, bing: null })
  })

  // A broken registration read or client builder is "couldn't ask", never a throw.
  it('never throws', async () => {
    const f = fakes()
    const r = await askSearchStats(ARTIST, '28d', { ...f.deps, readRegistered: async () => Promise.reject(new Error('db')) })
    expect([r.google.state, r.bing.state]).toEqual(['error', 'error'])
    const c = await askSearchStats(ARTIST, '28d', { ...f.deps, clients: async () => Promise.reject(new Error('env')) })
    expect([c.google.state, c.bing.state]).toEqual(['error', 'error'])
  })
})

describe('what may be cached', () => {
  // Answers (and a settled "no key") are kept for hours; a refusal, an error or a timeout is asked
  // again next time.
  it('never caches a refusal, an error or a timeout', async () => {
    expect(isCacheable(await askSearchStats(ARTIST, '28d', fakes().deps))).toBe(true)
    expect(isCacheable(await askSearchStats(ARTIST, '28d', fakes({ google: null }).deps))).toBe(true)
    expect(isCacheable(await askSearchStats(ARTIST, '28d', fakes({ google: { searchAnalytics: async () => ({ ok: false, reason: 'google_stats', status: 429 }) } }).deps))).toBe(false)
    expect(isCacheable(await askSearchStats(ARTIST, '28d', fakes({ google: { searchAnalytics: () => new Promise(() => {}) } }).deps))).toBe(false)
    expect(isCacheable(await askSearchStats(ARTIST, '28d', { ...fakes().deps, readRegistered: async () => Promise.reject(new Error('db')) }))).toBe(false)
  })

  // Registration runs from the CLI (scripts/site-register.ts), which can't clear the Next cache: a
  // stored "Site not added yet" would outlive the registration by up to 6 hours. Nothing registered
  // asks no engine (one service-role read), so it is never stored. One engine registered still is:
  // otherwise a site with only Google would ask Google six times on every open (its quota is per site).
  it('never caches "nothing registered", but keeps an answer with one engine registered', async () => {
    expect(isCacheable(await askSearchStats(ARTIST, '28d', fakes({ registered: [] }).deps))).toBe(false)
    const onlyGoogle = await askSearchStats(ARTIST, '28d', fakes({ registered: [{ provider: 'google', siteUrl: SITE }] }).deps)
    expect([onlyGoogle.google.state, onlyGoogle.bing.state]).toEqual(['ok', 'not_registered'])
    expect(isCacheable(onlyGoogle)).toBe(true)
  })
})

describe('the real deps', () => {
  // Tests load .env.local: the env-backed deps must refuse here, or a test could reach the real
  // keys. A boolean, so a failure prints nothing of what came back.
  it('refuse under vitest', () => {
    let refused = false
    try {
      searchStatsDepsFromEnv()
    } catch {
      refused = true
    }
    expect(refused).toBe(true)
  })
})
