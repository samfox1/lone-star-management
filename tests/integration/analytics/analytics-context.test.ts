// The event carries WHERE the fan came from; bots are stored, flagged, counted as bots and
// never as views; the roll-up keeps the page fast without losing a number.
// ANALYTICS_PAGE_PLAN.md step 2 + REVIEW_2026-09-11_ANALYTICS.md.
/**
 * Runs against the hosted project. Three choices keep it honest there:
 *
 * - A THROWAWAY ARTIST, not the shared seed. Artist-wide readers count every row for the
 *   artist and other suites plant rows for `lone-pine`; on the throwaway artist every
 *   count is exact. Manager A is linked to it (so the POSITIVE half of RLS is exercised),
 *   manager B is the outsider. Deleting the artist cascades its events, its manager link
 *   and its tallies (AGENTS.md rule 6: teardown scoped by owning the artist).
 *
 * - A PROBED DAY in 2017–2024, years before the first real row (2026-07-01), so roll-up
 *   and prune here can only touch what this file plants. Probed, not merely random: the
 *   `rolled_days` ledger persists across runs and a day already in it reads from tallies,
 *   so the raw-path assertions need a day that is provably NOT rolled. Each run leaves
 *   one date row in the ledger (a known leftover — it names no artist and cannot be
 *   removed through PostgREST, which does not expose the schema).
 *
 * - `analytics.*` is not exposed, so tally state is asserted through the public readers,
 *   where the values are used. A reader that fell back to raw would fail the post-prune
 *   assertions, because prune removes the raw rows.
 *
 * The describes run in file order and later ones use rows planted by earlier ones (the
 * `ctx` view, the roll-up fixture). `it.only` on a late test will not work; run the file.
 *
 * NOT pinned here, on purpose: `event_attempts` / `geo_cache` expiry in prune (nothing can
 * write those tables until the step-3 door exists) and the partial index (not behaviour).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectExecuteDenied } from '@tests/helpers/rls'
import { ENTITY_KINDS, EVENT_TYPES, type EntityKind, type OnSiteEvent } from '@/lib/events'

const svc = serviceClient()
const anon = anonClient()
let asA: SupabaseClient
let asB: SupabaseClient

// Derived, never hand-listed (AGENTS.md rule 4).
const READERS = ['analytics_timeline', 'analytics_sources', 'analytics_places', 'analytics_devices', 'analytics_paths', 'analytics_campaigns'] as const
const SERVICE_ONLY = ['record_site_event', 'roll_up_analytics', 'roll_up_pending', 'prune_analytics'] as const
const view = 'view' satisfies OnSiteEvent
const play = 'play' satisfies OnSiteEvent
const ticket = 'ticket_click' satisfies OnSiteEvent
const track = 'track' satisfies EntityKind
const tourDate = 'tour_date' satisfies EntityKind

let artistF: string
const slugF = `t-analytics-${crypto.randomUUID().slice(0, 8)}`
const HOST = `${slugF}.example`
const entityE = crypto.randomUUID()
let ROLLED_DAY: string
let KEPT_DAY: string
const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`
const utcDay = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => utcDay(new Date(Date.now() - n * 86_400_000))

type Planted = Partial<{
  type: OnSiteEvent
  target: string
  created_at: string
  visitor_hash: string | null
  referrer_host: string
  source: string
  country: string
  region: string
  city: string
  device: string
  browser: string
  path: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  entity_id: string
  entity_type: EntityKind
  is_bot: boolean
}>
async function plant(row: Planted): Promise<{ id: string; created_at: string }> {
  const { data, error } = await svc
    .from('analytics_events')
    .insert({ artist_id: artistF, type: view, ...row })
    .select('id, created_at')
    .single()
  if (error) throw new Error(error.message)
  return data as { id: string; created_at: string }
}
async function plantMany(n: number, row: Planted): Promise<void> {
  if (n <= 0) return
  const { error } = await svc.from('analytics_events').insert(Array.from({ length: n }, () => ({ artist_id: artistF, type: view, ...row })))
  if (error) throw new Error(error.message)
}
const rowsLeft = async (ids: string[]) => {
  const { data } = await svc.from('analytics_events').select('id').in('id', ids)
  return data?.length ?? 0
}
const byTarget = async (target: string) => {
  const { data } = await svc.from('analytics_events').select('*').eq('target', target)
  return data ?? []
}
const reader = (c: SupabaseClient, fn: string, since = ROLLED_DAY, until = ROLLED_DAY) =>
  c.rpc(fn, { p_artist_id: artistF, p_since: since, p_until: until })
const recentCount = async (bot: boolean) => {
  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await svc.from('analytics_events').select('id', { count: 'exact', head: true }).eq('artist_id', artistF).eq('is_bot', bot).gte('created_at', since)
  return count ?? 0
}

/** A day in 2017–2024 that is NOT in the ledger: plant a probe, read the raw path, clean up. */
async function unrolledDay(): Promise<string> {
  for (let tries = 0; tries < 20; tries++) {
    const y = 2017 + Math.floor(Math.random() * 8)
    const m = 1 + Math.floor(Math.random() * 12)
    const d = 1 + Math.floor(Math.random() * 26) // 1..26, so d + 1 <= 27 stays in every month
    const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const next = `${y}-${String(m).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`
    const probes = [await plant({ created_at: at(day, 1), visitor_hash: 'probe' }), await plant({ created_at: at(next, 1), visitor_hash: 'probe' })]
    const { data } = await svc.rpc('analytics_timeline', { p_artist_id: artistF, p_since: day, p_until: next })
    await svc.from('analytics_events').delete().in('id', probes.map((p) => p.id))
    if ((data as unknown[]).length === 2) {
      KEPT_DAY = next
      return day
    }
  }
  throw new Error('could not find an unrolled day in 20 tries')
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  const { data, error } = await svc.from('artists').insert({ slug: slugF, name: 'Analytics throwaway' }).select('id').single()
  if (error) throw new Error(error.message)
  artistF = data.id as string
  const userA = (await asA.auth.getUser()).data.user!.id
  const { error: e2 } = await svc.from('artist_managers').insert({ artist_id: artistF, user_id: userA })
  if (e2) throw new Error(e2.message)
  ROLLED_DAY = await unrolledDay()
})
afterAll(async () => {
  await svc.from('artists').delete().eq('id', artistF)
})

let ctxCreatedAt: string

describe('record_site_event — the door\'s write path', () => {
  it('CRITICAL: the service-only functions refuse anon AND a signed-in manager', async () => {
    for (const fn of SERVICE_ONLY) {
      const args = fn === 'record_site_event' ? { p_slug: slugF, p_type: view } : fn === 'roll_up_analytics' ? { p_day: '2017-01-01' } : fn === 'prune_analytics' ? { p_keep: '90 days' } : {}
      const { error: e1 } = await anon.rpc(fn, args)
      expectExecuteDenied(e1, fn)
      const { error: e2 } = await asA.rpc(fn, args)
      expectExecuteDenied(e2, fn)
    }
  })

  it('stores the context and normalises it: host + browser lower-cased, country upper-cased, UTMs verbatim', async () => {
    const target = `ctx-${crypto.randomUUID()}`
    const { error } = await svc.rpc('record_site_event', {
      p_slug: slugF, p_type: view, p_target: target, p_path: '/about',
      p_referrer_host: 'L.Instagram.com', p_source: 'Instagram',
      p_utm_source: 'Instagram', p_utm_medium: 'Story', p_utm_campaign: 'tour-sep',
      p_country: 'us', p_region: 'Texas', p_city: 'Austin',
      p_device: 'mobile', p_browser: 'Instagram', p_visitor_hash: 'abc123',
    })
    expect(error).toBeNull()
    const [row] = await byTarget(target)
    ctxCreatedAt = row.created_at
    expect(row).toMatchObject({
      artist_id: artistF, path: '/about', referrer_host: 'l.instagram.com', source: 'instagram',
      utm_source: 'Instagram', utm_medium: 'Story', utm_campaign: 'tour-sep',
      country: 'US', region: 'Texas', city: 'Austin', device: 'mobile', browser: 'instagram',
      visitor_hash: 'abc123', is_bot: false,
    })
  })

  it('drops values off the allowlists, truncates long ones, keeps the bot flag, treats a null flag as false', async () => {
    const junk = `junk-${crypto.randomUUID()}`
    await svc.rpc('record_site_event', { p_slug: slugF, p_type: view, p_target: junk, p_country: 'usa', p_device: 'fridge', p_is_bot: true })
    expect((await byTarget(junk))[0]).toMatchObject({ country: null, device: null, is_bot: true })

    const long = `long-${crypto.randomUUID()}`
    const x = (n: number) => 'x'.repeat(n)
    await svc.rpc('record_site_event', { p_slug: slugF, p_type: view, p_target: long, p_path: x(300), p_browser: x(100), p_visitor_hash: x(100), p_utm_campaign: x(300), p_is_bot: null, })
    const [row] = await byTarget(long)
    expect([row.path.length, row.browser.length, row.visitor_hash.length, row.utm_campaign.length, row.is_bot]).toEqual([200, 40, 64, 100, false])
  })

  it('returns silently on an unknown type or slug, and strips an off-list entity kind', async () => {
    const t1 = `nope-${crypto.randomUUID()}`
    const { error: e1 } = await svc.rpc('record_site_event', { p_slug: slugF, p_type: 'nope', p_target: t1 })
    expect(e1).toBeNull()
    expect(await byTarget(t1)).toHaveLength(0)

    const t2 = `noslug-${crypto.randomUUID()}`
    const { error: e2 } = await svc.rpc('record_site_event', { p_slug: `${slugF}-missing`, p_type: view, p_target: t2 })
    expect(e2).toBeNull()
    expect(await byTarget(t2)).toHaveLength(0)

    const t3 = `kind-${crypto.randomUUID()}`
    await svc.rpc('record_site_event', { p_slug: slugF, p_type: play, p_target: t3, p_entity_id: crypto.randomUUID(), p_entity_type: 'artist' })
    expect((await byTarget(t3))[0]).toMatchObject({ entity_id: null, entity_type: null })
  })

  it('accepts every registered event type and entity kind — the SQL allowlists mirror src/lib/events.ts', async () => {
    for (const { type } of EVENT_TYPES) {
      const target = `type-${type}-${crypto.randomUUID()}`
      await svc.rpc('record_site_event', { p_slug: slugF, p_type: type, p_target: target })
      expect((await byTarget(target))[0]?.type, `event type ${type} was not stored`).toBe(type)
    }
    for (const kind of ENTITY_KINDS) {
      const target = `kind-${kind}-${crypto.randomUUID()}`
      await svc.rpc('record_site_event', { p_slug: slugF, p_type: play, p_target: target, p_entity_id: crypto.randomUUID(), p_entity_type: kind })
      expect((await byTarget(target))[0]?.entity_type, `entity kind ${kind} was not stored`).toBe(kind)
    }
  })
})

describe('bots are stored, flagged, and never counted as traffic', () => {
  it('CRITICAL: every pre-existing reader skips flagged rows', async () => {
    // Window from the DB clock (the ctx row), this artist only. Real views so far: ctx,
    // long, and the registry's `view`. Real plays: the registry's `play`, one per entity
    // kind, the stripped-kind one, plus the one planted here. Bot rows: junk + two here.
    const since = ctxCreatedAt
    const REAL_VIEWS = 3
    const REAL_PLAYS = 1 + ENTITY_KINDS.length + 1 + 1
    await plant({ type: play, entity_id: entityE, entity_type: track })
    await plant({ type: play, entity_id: entityE, entity_type: track, is_bot: true })
    await plant({ type: view, is_bot: true })

    const { data: summary } = await svc.rpc('analytics_summary', { p_artist_id: artistF, p_since: since })
    const byType = Object.fromEntries((summary as { type: string; count: number }[]).map((r) => [r.type, Number(r.count)]))
    expect(byType.view).toBe(REAL_VIEWS)
    expect(byType.play).toBe(REAL_PLAYS)

    const { data: byEntity } = await svc.rpc('analytics_by_entity', { p_artist_id: artistF, p_since: since })
    const e = (byEntity as { entity_id: string; count: number }[]).find((r) => r.entity_id === entityE)
    expect(Number(e?.count)).toBe(1)

    const { data: daily } = await svc.rpc('analytics_entity_daily', { p_artist_id: artistF, p_entity_ids: [entityE], p_since: since })
    expect((daily as { count: number }[]).reduce((n, r) => n + Number(r.count), 0)).toBe(1)

    const { data: views } = await svc.rpc('analytics_daily', { p_since: since, p_artist_id: artistF })
    expect((views as { views: number }[]).reduce((n, r) => n + Number(r.views), 0)).toBe(REAL_VIEWS)
  })
})

describe('roll-up: tallies answer exactly what raw answered, then raw can go', () => {
  const planted: string[] = []
  let keptRow: string

  beforeAll(async () => {
    // ROLLED_DAY: four real views (two visitors, one with no hash), one bot view, one click.
    const common = { referrer_host: HOST, source: 'instagram', country: 'US', region: 'TX', city: 'Austin', device: 'mobile', browser: 'instagram' }
    for (const row of [
      { created_at: at(ROLLED_DAY, 9), visitor_hash: 'v1', ...common, path: '/', utm_source: 'instagram', utm_medium: 'story', utm_campaign: 'tour-sep' },
      { created_at: at(ROLLED_DAY, 10), visitor_hash: 'v1', ...common, path: '/about' },
      { created_at: at(ROLLED_DAY, 11), visitor_hash: 'v2', source: 'direct', device: 'desktop', browser: 'safari', path: '/' },
      { created_at: at(ROLLED_DAY, 12), visitor_hash: null, source: 'direct', device: 'desktop', browser: 'safari', path: '/' }, // pre-migration shape: no hash
      { created_at: at(ROLLED_DAY, 13), visitor_hash: 'bot', ...common, is_bot: true },
      { created_at: at(ROLLED_DAY, 14), type: ticket, entity_id: entityE, entity_type: tourDate, visitor_hash: 'v2' },
    ] as Planted[]) planted.push((await plant(row)).id)
    keptRow = (await plant({ created_at: at(KEPT_DAY, 9), visitor_hash: 'v3' })).id
  })

  const EXPECTED = {
    analytics_timeline: [{ day: () => ROLLED_DAY, views: 4, visitors: 2, bots: 1 }],
    analytics_sources: [{ source: 'direct', referrer_host: '', views: 2, visitors: 1 }, { source: 'instagram', referrer_host: HOST, views: 2, visitors: 1 }],
    analytics_places: [{ country: '', region: '', city: '', views: 2, visitors: 1 }, { country: 'US', region: 'TX', city: 'Austin', views: 2, visitors: 1 }],
    analytics_devices: [{ device: 'desktop', browser: 'safari', views: 2, visitors: 1 }, { device: 'mobile', browser: 'instagram', views: 2, visitors: 1 }],
    analytics_paths: [{ path: '/', views: 3, visitors: 2 }, { path: '/about', views: 1, visitors: 1 }],
    analytics_campaigns: [{ utm_source: 'instagram', utm_medium: 'story', utm_campaign: 'tour-sep', views: 1, visitors: 1 }],
  } satisfies Record<(typeof READERS)[number], unknown[]>
  const expected = (fn: (typeof READERS)[number]) =>
    (EXPECTED[fn] as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'function' ? (v as () => string)() : v])))
  const expectAllReaders = async (c: SupabaseClient) => {
    for (const fn of READERS) {
      const { data, error } = await reader(c, fn)
      expect(error, fn).toBeNull()
      expect(data, fn).toEqual(expected(fn))
    }
  }

  it('CRITICAL: every reader answers the same from raw (before) and from tallies (after)', async () => {
    await expectAllReaders(svc) // raw path: the probed day is not in the ledger
    const { error } = await svc.rpc('roll_up_analytics', { p_day: ROLLED_DAY })
    expect(error).toBeNull()
    await expectAllReaders(svc) // tally path
  })

  it('is idempotent: rolling the same day twice does not double anything', async () => {
    const { error } = await svc.rpc('roll_up_analytics', { p_day: ROLLED_DAY })
    expect(error).toBeNull()
    await expectAllReaders(svc)
  })

  it('a window straddling a rolled day and a raw day is exact and ordered', async () => {
    const { data } = await reader(svc, 'analytics_timeline', ROLLED_DAY, KEPT_DAY)
    expect(data).toEqual([
      { day: ROLLED_DAY, views: 4, visitors: 2, bots: 1 },
      { day: KEPT_DAY, views: 1, visitors: 1, bots: 0 },
    ])
  })

  it('CRITICAL: the manager of THIS artist sees the exact numbers; a manager of another artist sees nothing', async () => {
    await expectAllReaders(asA)
    for (const fn of READERS) {
      const { data, error } = await reader(asB, fn)
      expect(error, fn).toBeNull()
      expect(data, fn).toEqual([])
    }
  })

  it('refuses to roll up today: a row recorded after the call still counts', async () => {
    const today = daysAgo(0)
    const { data: before } = await reader(svc, 'analytics_timeline', today, today)
    const b = (before as { views: number; visitors: number }[])[0] ?? { views: 0, visitors: 0 }
    const { error } = await svc.rpc('roll_up_analytics', { p_day: today })
    expect(error).toBeNull()
    await plant({ visitor_hash: `late-${crypto.randomUUID()}` })
    const { data: after } = await reader(svc, 'analytics_timeline', today, today)
    const a = (after as { views: number; visitors: number }[])[0]
    // Had today been rolled, the tally would be frozen and both deltas would be 0.
    expect([a.views - b.views, a.visitors - b.visitors]).toEqual([1, 1])
  })

  it('roll_up_pending re-rolls the last two days, so a late arrival for yesterday is counted', async () => {
    // Touches every artist's yesterday + day-before, as the nightly job will. Idempotent.
    const yesterday = daysAgo(1)
    await plant({ created_at: `${yesterday}T12:00:00Z`, visitor_hash: 'y1' })
    await svc.rpc('roll_up_analytics', { p_day: yesterday })
    await plant({ created_at: `${yesterday}T12:30:00Z`, visitor_hash: 'y2' }) // late arrival
    const { data: frozen } = await reader(svc, 'analytics_timeline', yesterday, yesterday)
    expect((frozen as { views: number }[])[0].views).toBe(1) // the reason the rule exists
    const { error } = await svc.rpc('roll_up_pending', { p_max_days: 1 })
    expect(error).toBeNull()
    const { data: fresh } = await reader(svc, 'analytics_timeline', yesterday, yesterday)
    expect((fresh as { views: number }[])[0].views).toBe(2)
  })

  it('CRITICAL: prune respects the keep window, deletes raw only for rolled days, and the tallies still answer', async () => {
    expect(await rowsLeft(planted)).toBe(planted.length) // witness
    const { error: e0 } = await svc.rpc('prune_analytics', { p_keep: '10 years' })
    expect(e0).toBeNull()
    expect(await rowsLeft(planted)).toBe(planted.length) // inside the window: kept

    const { data: n, error } = await svc.rpc('prune_analytics', { p_keep: '365 days' })
    expect(error).toBeNull()
    expect(Number(n)).toBeGreaterThanOrEqual(planted.length)
    expect(await rowsLeft(planted)).toBe(0) // rolled day, past the window: gone, bot row included
    expect(await rowsLeft([keptRow])).toBe(1) // un-rolled day, past the window: kept
    await expectAllReaders(svc) // the page still has every number

    // The per-entity readers survive prune too, since 20260912120000 pointed them at
    // analytics.daily_entity for rolled days (this assertion used to record the opposite as
    // an honest gap — step 4's prerequisite closed it).
    const { data: byEntity } = await svc.rpc('analytics_by_entity', { p_artist_id: artistF, p_since: at(ROLLED_DAY, 0) })
    expect((byEntity as { entity_id: string; type: string }[]).some((r) => r.entity_id === entityE && r.type === ticket)).toBe(true)
  })

  it('CRITICAL: re-rolling a pruned day keeps its tallies instead of rebuilding them from nothing', async () => {
    const { error } = await svc.rpc('roll_up_analytics', { p_day: ROLLED_DAY })
    expect(error).toBeNull()
    await expectAllReaders(svc)
  })

  it('the readers refuse anon; the older readers too', async () => {
    for (const fn of READERS) {
      const { error } = await reader(anon, fn)
      expectExecuteDenied(error, fn)
    }
    // Older readers kept an anon EXECUTE grant since 20260714140000 (Supabase's default
    // privileges grant by role; a revoke from PUBLIC leaves them). Closed in 20260911171000.
    const OLD: Record<string, Record<string, unknown>> = {
      analytics_summary: { p_artist_id: artistF, p_since: at(ROLLED_DAY, 0) },
      analytics_daily: { p_since: at(ROLLED_DAY, 0), p_artist_id: artistF },
      analytics_by_entity: { p_artist_id: artistF, p_since: at(ROLLED_DAY, 0) },
      analytics_entity_daily: { p_artist_id: artistF, p_entity_ids: [entityE], p_since: at(ROLLED_DAY, 0) },
    }
    for (const [fn, args] of Object.entries(OLD)) {
      const { error } = await anon.rpc(fn, args)
      expectExecuteDenied(error, fn)
    }
  })
})

describe('burst caps in record_site_event — real and bot traffic capped separately', () => {
  // Last in the file: it fills this artist's one-minute window, which would skew the
  // count assertions above.
  it('CRITICAL: the 120th real event lands, the 121st is dropped, and a bot still lands', async () => {
    await plantMany(119 - (await recentCount(false)), { visitor_hash: 'flood' })
    const x = `cap-${crypto.randomUUID()}`
    await svc.rpc('record_site_event', { p_slug: slugF, p_type: view, p_target: x })
    expect(await byTarget(x)).toHaveLength(1) // the 120th

    const y = `cap-${crypto.randomUUID()}`
    const { error } = await svc.rpc('record_site_event', { p_slug: slugF, p_type: view, p_target: y })
    expect(error).toBeNull()
    expect(await byTarget(y)).toHaveLength(0) // the 121st: dropped, silently

    const z = `bot-${crypto.randomUUID()}`
    await svc.rpc('record_site_event', { p_slug: slugF, p_type: view, p_target: z, p_is_bot: true })
    expect(await byTarget(z)).toHaveLength(1) // bots have their own cap
  })

  it('CRITICAL: the 60th bot lands, the 61st is dropped', async () => {
    await plantMany(59 - (await recentCount(true)), { visitor_hash: 'botflood', is_bot: true })
    const z = `bot-${crypto.randomUUID()}`
    await svc.rpc('record_site_event', { p_slug: slugF, p_type: view, p_target: z, p_is_bot: true })
    expect(await byTarget(z)).toHaveLength(1)
    const w = `bot-${crypto.randomUUID()}`
    await svc.rpc('record_site_event', { p_slug: slugF, p_type: view, p_target: w, p_is_bot: true })
    expect(await byTarget(w)).toHaveLength(0)
  })
})
