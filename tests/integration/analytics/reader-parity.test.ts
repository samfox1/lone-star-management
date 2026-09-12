// The four dashboard readers answer the SAME number from raw rows, from tallies, and after
// the raw rows are pruned. Step 4's prerequisite (ANALYTICS_PAGE_PLAN.md; review finding S4).
/**
 * This is the one property that matters about the tally layer: rolling a day up, or pruning
 * it afterwards, must not move a single figure on the dashboard. Before this migration
 * `analytics_summary`, `analytics_daily`, `analytics_by_entity` and `analytics_entity_daily`
 * read raw rows only, so the first prune would have started silently shrinking every
 * 30-day card and the roster sparklines.
 *
 * Shape of each test: snapshot all four readers while the day is RAW, roll the day up,
 * assert the identical snapshot, prune the raw rows away, assert it again. A reader that
 * lost a branch fails on the second read; one that double-counts fails there too; one that
 * secretly still needs raw fails on the third.
 *
 * Runs against the hosted project. A throwaway artist owns every row (cascade teardown,
 * AGENTS.md rule 6) and manager A is linked to it so the positive half of RLS is exercised.
 * The day is PROBED, in 2017–2024: the `analytics.rolled_days` ledger persists across runs,
 * so a day already in it would read from tallies and the raw-path snapshot would be
 * meaningless; and being years before the first real row (2026-07-01), the prune here can
 * only ever reach what this file planted. Each run leaves one date in the ledger — a known
 * leftover, it names no artist and PostgREST does not expose the schema to delete it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'

const svc = serviceClient()
let asA: SupabaseClient

let artistF: string
const slugF = `t-parity-${crypto.randomUUID().slice(0, 8)}`
let DAY: string
const entityE = crypto.randomUUID()
const entityF = crypto.randomUUID()
const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`

type Planted = Partial<{ type: string; created_at: string; visitor_hash: string | null; entity_id: string; entity_type: string; is_bot: boolean }>
async function plant(row: Planted): Promise<void> {
  const { error } = await svc.from('analytics_events').insert({ artist_id: artistF, type: 'view', ...row })
  if (error) throw new Error(error.message)
}

/** Every reader, as one comparable object. `p_since` is midnight of the planted day. */
async function readAll(c: SupabaseClient = svc, since = at(DAY, 0)) {
  const [summary, daily, byEntity, entityDaily] = await Promise.all([
    c.rpc('analytics_summary', { p_artist_id: artistF, p_since: since }),
    c.rpc('analytics_daily', { p_since: since, p_artist_id: artistF }),
    c.rpc('analytics_by_entity', { p_artist_id: artistF, p_since: since }),
    c.rpc('analytics_entity_daily', { p_artist_id: artistF, p_entity_ids: [entityE, entityF], p_since: since }),
  ])
  for (const r of [summary, daily, byEntity, entityDaily]) expect(r.error).toBeNull()
  const num = <T extends Record<string, unknown>>(rows: T[] | null, ...keys: string[]) =>
    (rows ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) ? Number(v) : v])))
  const sort = (rows: Record<string, unknown>[]) => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return {
    summary: sort(num(summary.data as Record<string, unknown>[], 'count')),
    daily: sort(num(daily.data as Record<string, unknown>[], 'views')),
    byEntity: sort(num(byEntity.data as Record<string, unknown>[], 'count')),
    entityDaily: sort(num(entityDaily.data as Record<string, unknown>[], 'count')),
  }
}

/** A day in 2017–2024 that is NOT already in the ledger: plant, read the raw path, clean up. */
async function unrolledDay(): Promise<string> {
  for (let tries = 0; tries < 20; tries++) {
    const y = 2017 + Math.floor(Math.random() * 8)
    const m = 1 + Math.floor(Math.random() * 12)
    const d = 1 + Math.floor(Math.random() * 27)
    const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const { data: probe } = await svc.from('analytics_events').insert({ artist_id: artistF, type: 'view', created_at: at(day, 1) }).select('id').single()
    const { data } = await svc.rpc('analytics_daily', { p_since: at(day, 0), p_artist_id: artistF })
    await svc.from('analytics_events').delete().eq('id', (probe as { id: string }).id)
    if ((data as unknown[]).length === 1) return day
  }
  throw new Error('could not find an unrolled day in 20 tries')
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  const { data, error } = await svc.from('artists').insert({ slug: slugF, name: 'Reader parity throwaway' }).select('id').single()
  if (error) throw new Error(error.message)
  artistF = data.id as string
  const userA = (await asA.auth.getUser()).data.user!.id
  const { error: e2 } = await svc.from('artist_managers').insert({ artist_id: artistF, user_id: userA })
  if (e2) throw new Error(e2.message)
  DAY = await unrolledDay()

  // Three real views from two visitors; a play WITH a track id and a play WITHOUT one (the
  // shape no pre-existing tally could hold); a ticket click on a second entity; one bot.
  await plant({ created_at: at(DAY, 9), visitor_hash: 'v1' })
  await plant({ created_at: at(DAY, 10), visitor_hash: 'v1' })
  await plant({ created_at: at(DAY, 11), visitor_hash: 'v2' })
  await plant({ created_at: at(DAY, 12), type: 'play', entity_id: entityE, entity_type: 'track', visitor_hash: 'v1' })
  await plant({ created_at: at(DAY, 13), type: 'play', visitor_hash: 'v2' })
  await plant({ created_at: at(DAY, 14), type: 'ticket_click', entity_id: entityF, entity_type: 'tour_date', visitor_hash: 'v2' })
  await plant({ created_at: at(DAY, 15), type: 'view', visitor_hash: 'bot', is_bot: true })
})
afterAll(async () => {
  await svc.from('artists').delete().eq('id', artistF)
})

const EXPECTED = {
  // Bots counted nowhere. The entity-less `play` is why analytics.daily_type exists.
  summary: [{ type: 'play', count: 2 }, { type: 'ticket_click', count: 1 }, { type: 'view', count: 3 }],
  byEntity: [
    { entity_type: 'track', entity_id: entityE, type: 'play', count: 1 },
    { entity_type: 'tour_date', entity_id: entityF, type: 'ticket_click', count: 1 },
  ],
  entityDaily: [{ count: 2 }],
}
const expectedAll = () => ({
  summary: [...EXPECTED.summary].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  daily: [{ artist_id: artistF, day: DAY, views: 3 }],
  byEntity: [...EXPECTED.byEntity].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  entityDaily: [{ day: DAY, count: 2 }],
})

describe('the four dashboard readers survive roll-up and prune unchanged', () => {
  it('CRITICAL: raw, then tallied, then pruned — the same four answers every time, and whole UTC days throughout', async () => {
    // At every stage, read from midnight AND from late in the same day. Both must give the
    // whole day: a tally is day-granular, so a raw half that honoured the exact timestamp
    // would answer differently once the day was rolled up — the bug, not the feature.
    const bothWindows = async (stage: string) => {
      expect(await readAll(svc, at(DAY, 0)), stage).toEqual(expectedAll())
      expect(await readAll(svc, at(DAY, 23)), `${stage} (p_since late in the day)`).toEqual(expectedAll())
    }

    // 1. RAW. Also the witness that the rows exist, so the later reads are not vacuous.
    await bothWindows('raw')

    // 2. TALLIED.
    expect((await svc.rpc('roll_up_analytics', { p_day: DAY })).error).toBeNull()
    await bothWindows('a reader changed its answer when the day was rolled up')

    // 3. PRUNED — the raw rows are gone, so only the tallies can be answering now.
    const { count: before } = await svc.from('analytics_events').select('id', { count: 'exact', head: true }).eq('artist_id', artistF)
    expect(before).toBe(7)
    expect((await svc.rpc('prune_analytics', { p_keep: '365 days' })).error).toBeNull()
    const { count: after } = await svc.from('analytics_events').select('id', { count: 'exact', head: true }).eq('artist_id', artistF)
    expect(after, 'prune left raw rows behind, so the next read proves nothing').toBe(0)
    await bothWindows('a reader still needed the raw rows')
  })

  it('the manager of this artist reads the same numbers as the service client, through RLS', async () => {
    expect(await readAll(asA)).toEqual(expectedAll())
  })

  it('a manager of another artist reads nothing, with the numbers above as the witness', async () => {
    const asB = await signInAs(SEED.managerB)
    expect(await readAll(asB)).toEqual({ summary: [], daily: [], byEntity: [], entityDaily: [] })
  })

  it('a window that starts after the day excludes it entirely', async () => {
    const next = new Date(`${DAY}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    expect(await readAll(svc, next.toISOString())).toEqual({ summary: [], daily: [], byEntity: [], entityDaily: [] })
  })
})
