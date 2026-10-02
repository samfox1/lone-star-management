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
import { createThrowawayArtist, deleteThrowawayArtist } from '@tests/helpers/artist'
import { at, unrolledDays } from '@tests/integration/analytics/_days'

const svc = serviceClient()
let asA: SupabaseClient
let artistF: string
let EARLY: string
const LATE = new Date().toISOString().slice(0, 10)

async function plant(day: string, hour: number): Promise<void> {
  const { error } = await svc.from('analytics_events').insert({
    artist_id: artistF, type: 'view', is_bot: false, created_at: at(day, hour),
  })
  if (error) throw new Error(error.message)
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artistF = (await createThrowawayArtist(svc, 'First day', asA)).id
  EARLY = (await unrolledDays(svc, artistF, (first, last) => svc.rpc('analytics_timeline', { p_artist_id: artistF, p_since: first, p_until: last })))[0]
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artistF)
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
