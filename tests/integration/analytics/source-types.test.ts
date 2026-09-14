// `analytics_source_types` — what each source's visitors went on to do.
/**
 * Two arms, one rule: a day's numbers must not move when the roll-up reaches it.
 * The tally arm reads `analytics.daily_source_type`, the raw arm reads
 * `analytics_events` for unrolled days, and both must exclude views (those are
 * `daily_source`'s), exclude bots, and count DISTINCT visitors per action — the
 * sentence on the card is "1 in 4 plays", and a person playing twice is one.
 *
 * Same shape as type-timeline.test.ts: a throwaway artist (cascade takes the
 * tallies on teardown), an unrolled day probed through a public reader, and
 * every assertion through the reader because PostgREST does not expose the
 * `analytics` schema. One date per run is left in `rolled_days`, as documented.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectExecuteDenied } from '@tests/helpers/rls'

const svc = serviceClient()
let asA: SupabaseClient
let artistF: string
let DAY: string
const slugF = `t-srctype-${crypto.randomUUID().slice(0, 8)}`
const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`

/** Planted rows. Visitor A plays twice from Instagram: two plays, ONE visitor. */
const PLANTED = [
  { type: 'view', source: 'instagram', visitor: 'A', bot: false },
  { type: 'view', source: 'instagram', visitor: 'B', bot: false },
  { type: 'play', source: 'instagram', visitor: 'A', bot: false },
  { type: 'play', source: 'instagram', visitor: 'A', bot: false },
  { type: 'link_click', source: 'instagram', visitor: 'B', bot: false },
  { type: 'play', source: 'youtube', visitor: 'C', bot: false },
  { type: 'play', source: 'instagram', visitor: 'Z', bot: true },
] as const

/** Derived from the fixture: non-view, non-bot, per source × type, count + distinct visitors. */
const EXPECTED = (() => {
  const m = new Map<string, { count: number; v: Set<string> }>()
  for (const e of PLANTED) {
    if (e.bot || e.type === 'view') continue
    const k = `${e.source}|${e.type}`
    const g = m.get(k) ?? { count: 0, v: new Set<string>() }
    g.count++; g.v.add(e.visitor); m.set(k, g)
  }
  return Object.fromEntries([...m].map(([k, g]) => [k, { count: g.count, visitors: g.v.size }]))
})()

async function readDay(c: SupabaseClient = svc): Promise<Record<string, { count: number; visitors: number }>> {
  const { data, error } = await c.rpc('analytics_source_types', { p_artist_id: artistF, p_since: DAY, p_until: DAY })
  expect(error, error?.message).toBeNull()
  const out: Record<string, { count: number; visitors: number }> = {}
  for (const r of (data ?? []) as { source: string; type: string; count: number; visitors: number }[]) {
    out[`${r.source}|${r.type}`] = { count: Number(r.count), visitors: Number(r.visitors) }
  }
  return out
}

async function unrolledDay(): Promise<string> {
  for (let tries = 0; tries < 20; tries++) {
    const y = 2017 + Math.floor(Math.random() * 8)
    const m = 1 + Math.floor(Math.random() * 12)
    const d = 1 + Math.floor(Math.random() * 27)
    const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const { data: probe } = await svc.from('analytics_events')
      .insert({ artist_id: artistF, type: 'view', created_at: at(day, 1) }).select('id').single()
    const { data, error } = await svc.rpc('analytics_timeline', { p_artist_id: artistF, p_since: day, p_until: day })
    await svc.from('analytics_events').delete().eq('id', (probe as { id: string }).id)
    if (error) throw new Error(error.message)
    if (((data ?? []) as unknown[]).length === 1) return day
  }
  throw new Error('could not find an unrolled day in 20 tries')
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  const { data, error } = await svc.from('artists').insert({ slug: slugF, name: 'Source types throwaway' }).select('id').single()
  if (error) throw new Error(error.message)
  artistF = data.id as string
  const userA = (await asA.auth.getUser()).data.user!.id
  const { error: e2 } = await svc.from('artist_managers').insert({ artist_id: artistF, user_id: userA })
  if (e2) throw new Error(e2.message)
  DAY = await unrolledDay()
  let hour = 6
  for (const e of PLANTED) {
    const { error: e3 } = await svc.from('analytics_events').insert({
      artist_id: artistF, type: e.type, source: e.source, visitor_hash: `h-${e.visitor}`, is_bot: e.bot, created_at: at(DAY, hour++),
    })
    if (e3) throw new Error(e3.message)
  }
})

afterAll(async () => {
  if (artistF) await svc.from('artists').delete().eq('id', artistF)
})

describe('analytics_source_types', () => {
  it('CRITICAL: a day reads the same before and after the roll-up touches it, with DISTINCT visitors per action', async () => {
    const raw = await readDay()
    expect(raw, 'the raw arm').toEqual(EXPECTED)
    expect(raw['instagram|play'], 'two plays by one person').toEqual({ count: 2, visitors: 1 })
    expect(Object.keys(raw).some((k) => k.endsWith('|view')), 'views are not actions').toBe(false)

    const { error } = await svc.rpc('roll_up_analytics', { p_day: DAY })
    expect(error, error?.message).toBeNull()
    expect(await readDay(), 'the tally arm').toEqual(raw)

    await svc.from('analytics_events').delete().eq('artist_id', artistF)
    expect(await readDay(), 'still served after the raw rows are gone').toEqual(raw)
  })

  it('never counts a bot', async () => {
    expect(PLANTED.some((e) => e.bot), 'a bot really was planted').toBe(true)
    const total = Object.values(await readDay()).reduce((n, v) => n + v.count, 0)
    expect(total).toBe(PLANTED.filter((e) => !e.bot && e.type !== 'view').length)
  })

  it('CRITICAL: anon cannot call it — the default grant is revoked, not just PUBLIC', async () => {
    expect(Object.keys(await readDay()).length, 'the witness').toBeGreaterThan(0)
    const { error } = await anonClient().rpc('analytics_source_types', { p_artist_id: artistF, p_since: DAY, p_until: DAY })
    expectExecuteDenied(error, 'analytics_source_types')
  })

  it('a signed-in manager reads the artist they manage; another manager sees nothing', async () => {
    // The first test rolled the day up and deleted the raw rows, so what A reads and
    // B is denied here is the TALLY arm — the new table's own RLS policy. Run alone,
    // this would quietly test analytics_events instead; the witness says which.
    const { data: raw } = await svc.from('analytics_events').select('id').eq('artist_id', artistF)
    expect(raw, 'the tally arm is what B is denied').toHaveLength(0)
    expect(await readDay(asA)).toEqual(EXPECTED)
    const asB = await signInAs(SEED.managerB)
    const { data, error } = await asB.rpc('analytics_source_types', { p_artist_id: artistF, p_since: DAY, p_until: DAY })
    expect(error, error?.message).toBeNull()
    expect(data ?? [], 'B must not see A rows').toHaveLength(0)
  })
})
