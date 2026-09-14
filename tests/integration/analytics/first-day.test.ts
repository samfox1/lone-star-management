// `firstAnalyticsDay` — where "All time" starts, and why it must read the tallies.
/**
 * The nightly prune deletes raw `analytics_events` older than 90 days once they
 * are rolled into `analytics.daily_*`. The tallies keep every day; only the raw
 * table forgets. So an "all time" that starts at the raw table's oldest row
 * shrinks by a day every night after the first 90 — silently, with the total
 * dropping and nothing on screen to say so. The reader behind `firstAnalyticsDay`
 * unions tallies with raw, so the first day survives the prune.
 *
 * Proof, in the shape `type-timeline.test.ts` uses: plant an early day and a
 * late one on a THROWAWAY artist, roll the early day up, delete its raw rows,
 * and the first day must still be the early one. Everything goes through public
 * readers (PostgREST does not expose the `analytics` schema) and the artist's
 * cascade takes the tallies away on teardown. One date per run is left in
 * `analytics.rolled_days`, the same known leftover the other suites document.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { firstAnalyticsDay } from '@/lib/analytics'

const svc = serviceClient()
let asA: SupabaseClient
let artistF: string
let EARLY: string
const LATE = new Date().toISOString().slice(0, 10)
const slugF = `t-firstday-${crypto.randomUUID().slice(0, 8)}`
const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`

async function plant(day: string, hour: number): Promise<void> {
  const { error } = await svc.from('analytics_events').insert({
    artist_id: artistF, type: 'view', is_bot: false, created_at: at(day, hour),
  })
  if (error) throw new Error(error.message)
}

/** A day in 2017–2024 the ledger has NOT rolled, probed through a public reader. */
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
  const { data, error } = await svc.from('artists')
    .insert({ slug: slugF, name: 'First day throwaway' }).select('id').single()
  if (error) throw new Error(error.message)
  artistF = data.id as string
  const userA = (await asA.auth.getUser()).data.user!.id
  const { error: e2 } = await svc.from('artist_managers').insert({ artist_id: artistF, user_id: userA })
  if (e2) throw new Error(e2.message)
  EARLY = await unrolledDay()
})

afterAll(async () => {
  if (artistF) await svc.from('artists').delete().eq('id', artistF)
})

describe('firstAnalyticsDay', () => {
  it('is null before any traffic', async () => {
    expect(await firstAnalyticsDay(asA, artistF)).toBeNull()
  })

  it('CRITICAL: survives the prune — the first day is read off the tallies once the raw rows are gone', async () => {
    await plant(EARLY, 6)
    await plant(LATE, 6)
    expect(await firstAnalyticsDay(asA, artistF), 'raw arm').toBe(EARLY)

    const { error } = await svc.rpc('roll_up_analytics', { p_day: EARLY })
    expect(error, error?.message).toBeNull()
    // What the prune does: the rolled day's raw rows go, the tally stays.
    const { error: del } = await svc.from('analytics_events').delete().eq('artist_id', artistF).lt('created_at', at(LATE, 0))
    expect(del).toBeNull()
    const { data: left } = await svc.from('analytics_events').select('created_at').eq('artist_id', artistF)
    expect(left?.map((r) => String(r.created_at).slice(0, 10)), 'only the late day is raw now').toEqual([LATE])

    expect(await firstAnalyticsDay(asA, artistF), 'tally arm').toBe(EARLY)
  })
})
