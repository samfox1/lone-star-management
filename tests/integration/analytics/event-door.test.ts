// The `event` door end to end: the deployed Edge Function writes a fully derived row
// through record_site_event, refuses what it should, and its helper RPCs are service-only.
// Step 3 of ANALYTICS_PAGE_PLAN.md; runbook docs/event-endpoint.md.
/**
 * Runs against the hosted project INCLUDING the deployed function
 * (`POST {SUPABASE_URL}/functions/v1/event`): the plumbing in index.ts is exercised only
 * here. derive.ts is pinned DB-free in tests/unit/analytics/event-derive.test.ts — the
 * geo lookup included, via injected stubs, because with IPINFO_TOKEN unset in the project
 * the lookup is disabled and no request from this file can reach it. Deploy before
 * running: a 404 means `npm run fn:deploy:event` has not happened, not that the door is
 * broken.
 *
 * A throwaway artist owns every row (cascade teardown, AGENTS.md rule 6). The per-IP
 * ledger rows the door writes for THIS RUNNER's address expire through prune. The last
 * describe spends the runner's per-(site, IP) budget on purpose (61 requests in a minute)
 * — on a fresh throwaway slug, so the earlier tests' slug is untouched; a rerun inside
 * that minute still passes because every slug has its own budget.
 *
 * Later tests rely on rows written by earlier ones only where noted; `it.only` on a late
 * test may be vacuous. Not pinnable here: the geo-cache 2-day expiry (analytics.* is not
 * exposed, so `fetched_at` cannot be planted) and the 500 path (nothing to break).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, serviceClient, signInAs, SEED } from '@tests/helpers/supabase'
import { expectExecuteDenied } from '@tests/helpers/rls'

const svc = serviceClient()
const anon = anonClient()
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const DOOR = `${URL_}/functions/v1/event`

let artistF: string
const slugF = `t-door-${crypto.randomUUID().slice(0, 8)}`
const SITE = `https://${slugF}.example`

const IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0'
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

async function post(body: unknown, opts: { ua?: string; auth?: boolean; origin?: string | null; slug?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': opts.ua ?? IG_UA }
  if (opts.origin !== null) headers.Origin = opts.origin ?? SITE
  if (opts.auth !== false) {
    headers.Authorization = `Bearer ${ANON_KEY}`
    headers.apikey = ANON_KEY
  }
  return fetch(DOOR, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
}
const byTarget = async (target: string) => {
  const { data } = await svc.from('analytics_events').select('*').eq('target', target)
  return data ?? []
}
const byPath = async (path: string) => {
  const { data } = await svc.from('analytics_events').select('*').eq('artist_id', artistF).eq('path', path)
  return data ?? []
}
const entity = (label: string, kind = 'tour_date') => ({ kind, id: crypto.randomUUID(), label })
const view = (label: string, extra: Record<string, unknown> = {}) => ({ slug: slugF, type: 'view', url: `${SITE}/`, referrer: '', entity: entity(label, 'link'), ...extra })

beforeAll(async () => {
  const { data, error } = await svc.from('artists').insert({ slug: slugF, name: 'Door throwaway' }).select('id').single()
  if (error) throw new Error(error.message)
  artistF = data.id as string
})
afterAll(async () => {
  await svc.from('artists').delete().eq('id', artistF)
})

describe('the deployed door records', () => {
  it('CRITICAL: a fully derived row — path, referrer host, source (UTM wins), UTM, device, browser, entity, visitor hash', async () => {
    const ent = entity(`door-${crypto.randomUUID()}`)
    const res = await post({
      slug: slugF,
      type: 'ticket_click',
      // UTM and referrer DISAGREE on purpose: only the utm_source rule yields 'email'.
      url: `${SITE}/tour?utm_source=newsletter&utm_medium=story&utm_campaign=tour-sep#dates`,
      referrer: 'https://l.instagram.com/?u=x',
      entity: ent,
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE)
    expect(res.headers.get('vary')).toContain('Origin') // the gateway adds Accept-Encoding
    const [row] = await byTarget(ent.label)
    expect(row).toMatchObject({
      artist_id: artistF,
      type: 'ticket_click',
      entity_type: 'tour_date',
      entity_id: ent.id,
      target: ent.label,
      path: '/tour',
      referrer_host: 'l.instagram.com',
      source: 'email',
      utm_source: 'newsletter',
      utm_medium: 'story',
      utm_campaign: 'tour-sep',
      device: 'mobile',
      browser: 'instagram',
      is_bot: false,
    })
    expect(row.visitor_hash).toMatch(/^[0-9a-f]{32}$/)
  })

  it('CRITICAL: a plain page view with no entity — the most common event — lands with the three entity columns null', async () => {
    const path = `/p-${crypto.randomUUID().slice(0, 8)}`
    const res = await post({ slug: slugF, type: 'view', url: `${SITE}${path}`, referrer: 'https://news.ycombinator.com/' })
    expect(res.status).toBe(204)
    const rows = await byPath(path)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'view', target: null, entity_id: null, entity_type: null, referrer_host: 'news.ycombinator.com', source: 'other' })
  })

  it('the visitor hash is the same person for the same UA today, and a different one for another UA', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const a = `vh-${crypto.randomUUID()}`
    const b = `vh-${crypto.randomUUID()}`
    const c = `vh-${crypto.randomUUID()}`
    await post(view(a))
    await post(view(b))
    await post(view(c), { ua: SAFARI_UA })
    if (new Date().toISOString().slice(0, 10) !== day) return // crossed UTC midnight mid-test: the hash legitimately rotated
    const [ra, rb, rc] = await Promise.all([a, b, c].map(byTarget))
    expect(ra[0].visitor_hash).toBe(rb[0].visitor_hash)
    expect(rc[0].visitor_hash).not.toBe(ra[0].visitor_hash)
    expect(rc[0]).toMatchObject({ device: 'desktop', browser: 'safari' })
  })

  it('a same-site referrer is direct; a crawler UA is a bot row', async () => {
    const a = `direct-${crypto.randomUUID()}`
    await post(view(a, { url: `${SITE}/about`, referrer: `${SITE}/` }))
    expect((await byTarget(a))[0]).toMatchObject({ referrer_host: null, source: 'direct', is_bot: false })

    const b = `bot-${crypto.randomUUID()}`
    await post(view(b), { ua: BOT_UA })
    expect((await byTarget(b))[0]).toMatchObject({ is_bot: true, source: 'direct' })
  })

  it('the edit shell is not a visit: 204 and no row', async () => {
    const label = `edit-${crypto.randomUUID()}`
    const res = await post(view(label, { url: `${SITE}/edit/tour` }))
    expect(res.status).toBe(204)
    expect(await byTarget(label)).toHaveLength(0)
  })
})

describe('the deployed door refuses', () => {
  const cors = (res: Response) => res.headers.get('access-control-allow-origin')

  it('no Authorization → 401 from the handler (not the gateway), with CORS and the body', async () => {
    const res = await post(view('x'), { auth: false })
    expect(res.status).toBe(401)
    expect(cors(res)).toBe(SITE)
    expect(await res.json()).toEqual({ ok: false, error: 'unauthorized' })
  })
  it('a bad shape → 400 with the error code and CORS; unparseable JSON is missing_field', async () => {
    const bad = await post({ slug: slugF, type: 'pageview', url: `${SITE}/` })
    expect(bad.status).toBe(400)
    expect(cors(bad)).toBe(SITE)
    expect(await bad.json()).toEqual({ ok: false, error: 'bad_type' })
    const junk = await post('not json')
    expect(junk.status).toBe(400)
    expect(await junk.json()).toEqual({ ok: false, error: 'missing_field' })
  })
  it('CRITICAL: a page that does not live on the Origin → 403 and no row (a beacon embedded elsewhere)', async () => {
    const label = `xorigin-${crypto.randomUUID()}`
    const res = await post(view(label), { origin: 'https://some-other-site.example' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, error: 'origin_mismatch' })
    expect(await byTarget(label)).toHaveLength(0)
    // No Origin at all (a scripted caller): nothing to compare, the caps are the control.
    const ok = await post(view(`noorigin-${crypto.randomUUID()}`), { origin: null })
    expect(ok.status).toBe(204)
  })
  it('an unknown slug → 204 and nothing written; GET → 405; an oversized body → 413', async () => {
    const label = `ghost-${crypto.randomUUID()}`
    const res = await post({ ...view(label), slug: `${slugF}-missing` })
    expect(res.status).toBe(204)
    expect(await byTarget(label)).toHaveLength(0)

    const get = await fetch(DOOR, { headers: { Origin: SITE, Authorization: `Bearer ${ANON_KEY}` } })
    expect(get.status).toBe(405)
    expect(cors(get)).toBe(SITE)

    const big = await post({ ...view('big'), referrer: 'x'.repeat(9000) })
    expect(big.status).toBe(413)
  })
  it('answers the preflight unauthenticated with the CORS headers a browser needs', async () => {
    const res = await fetch(DOOR, { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, apikey, content-type' } })
    expect(res.status).toBe(204)
    expect(cors(res)).toBe(SITE)
    expect(res.headers.get('access-control-allow-headers')).toContain('apikey')
  })
})

describe('the helper RPCs', () => {
  const HELPERS = {
    bump_event_attempt: { p_ip_hash: 'x' },
    lookup_geo_cache: { p_ip_hash: 'x' },
    cache_geo: { p_ip_hash: 'x', p_country: 'US', p_region: null, p_city: null },
  } as const

  it('CRITICAL: are service-only — anon and a signed-in manager are refused', async () => {
    const asA = await signInAs(SEED.managerA)
    for (const [fn, args] of Object.entries(HELPERS)) {
      expectExecuteDenied((await anon.rpc(fn, args)).error, fn)
      expectExecuteDenied((await asA.rpc(fn, args)).error, fn)
    }
  })

  it('bump_event_attempt counts per key per minute and trips exactly at the limit', async () => {
    const key = `t-${crypto.randomUUID().replaceAll('-', '')}`
    const results: boolean[] = []
    for (let i = 0; i < 4; i++) results.push((await svc.rpc('bump_event_attempt', { p_ip_hash: key, p_limit: 3 })).data as boolean)
    expect(results).toEqual([true, true, true, false])
    expect((await svc.rpc('bump_event_attempt', { p_ip_hash: `${key}b`, p_limit: 3 })).data).toBe(true)
    expect((await svc.rpc('bump_event_attempt', { p_ip_hash: '', p_limit: 3 })).data).toBe(false)
  })

  it('the geo cache round-trips and overwrites', async () => {
    const key = `t-${crypto.randomUUID().replaceAll('-', '')}`
    expect((await svc.rpc('lookup_geo_cache', { p_ip_hash: key })).data).toEqual([])
    await svc.rpc('cache_geo', { p_ip_hash: key, p_country: 'US', p_region: 'TX', p_city: 'Austin' })
    expect((await svc.rpc('lookup_geo_cache', { p_ip_hash: key })).data).toEqual([{ country: 'US', region: 'TX', city: 'Austin' }])
    await svc.rpc('cache_geo', { p_ip_hash: key, p_country: 'GB', p_region: null, p_city: 'London' })
    expect((await svc.rpc('lookup_geo_cache', { p_ip_hash: key })).data).toEqual([{ country: 'GB', region: null, city: 'London' }])
  })
})

describe('the per-(site, IP) cap through the deployed door — LAST, it spends this runner\'s budget', () => {
  it('CRITICAL: within one minute the 61st request from one address to one site is a 429 with Retry-After and CORS', async () => {
    // A second throwaway slug: the cap is per (site, IP), so the tests above are untouched
    // and a rerun of this file inside the same minute is not starved by this one.
    const slugCap = `t-cap-${crypto.randomUUID().slice(0, 8)}`
    const { data: cap } = await svc.from('artists').insert({ slug: slugCap, name: 'Cap throwaway' }).select('id').single()
    try {
      const site = `https://${slugCap}.example`
      const body = (i: number) => ({ slug: slugCap, type: 'view', url: `${site}/cap-${i}`, referrer: '' })
      const statuses: number[] = []
      for (let i = 0; i < 64; i++) {
        const r = await post(body(i), { origin: site, slug: slugCap })
        statuses.push(r.status)
        if (r.status === 429) {
          expect(r.headers.get('retry-after')).toBe('60')
          expect(r.headers.get('access-control-allow-origin')).toBe(site)
          expect(await r.json()).toEqual({ ok: false, error: 'rate_limited' })
          break
        }
      }
      const accepted = statuses.filter((s) => s === 204).length
      expect(statuses.at(-1)).toBe(429)
      expect(accepted).toBeLessThanOrEqual(60)
      expect(accepted).toBeGreaterThanOrEqual(55) // the minute may have started before this test
    } finally {
      await svc.from('artists').delete().eq('id', (cap as { id: string }).id)
    }
  })
})
