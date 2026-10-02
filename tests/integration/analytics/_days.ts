/**
 * Days for the analytics suites: a timestamp on a given day and hour, and a day the nightly
 * roll-up has NOT reached for an artist, so a planted row is read from the raw arm.
 *
 * Code:     support file (not a test): feeds the analytics readers in the hosted database
 *           (analytics_timeline, analytics_type_timeline, analytics_daily, …)
 * Feature:  the Analytics page's numbers: the raw arm and the rolled-up ledger must agree
 * Tier:     STRICT (AGENTS.md "Test depth"): the suites built on it pin what the dashboard counts.
 * What it provides:
 *           • at(day, hour): `day` at `hour`:00 UTC
 *           • unrolledDays(svc, artistId, read, days): a run of `days` days in a row, in 2017–2024,
 *             that the ledger has not rolled for that artist, proved through a reader
 * Not here: the throwaway artist itself (tests/helpers/artist.ts).
 * Fixtures: probes one view per day at 01:00 and deletes each probe before it returns.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** `day` at `hour`:00 UTC, as an ISO timestamp. */
export const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`

type Read = (first: string, last: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>

/**
 * `days` days in a row, in 2017–2024, that the ledger has NOT rolled for this artist. Probed
 * through the reader itself: plant one view per day, and if `read(first, last)` returns one row
 * per day, every day is still on the raw arm (a rolled day reads its tallies, which the probes
 * are not in). The probes are deleted before it returns.
 *
 * Why probe at all: `analytics.rolled_days` is not exposed to PostgREST, and
 * `.schema('analytics')` errors in a way that reads as "no rows" (2026-09-13).
 */
export async function unrolledDays(svc: SupabaseClient, artistId: string, read: Read, days = 1): Promise<string[]> {
  for (let tries = 0; tries < 20; tries++) {
    const y = 2017 + Math.floor(Math.random() * 8)
    const m = 1 + Math.floor(Math.random() * 12)
    const d = 1 + Math.floor(Math.random() * (28 - days)) // the last day stays <= 27, in every month
    const run = Array.from({ length: days }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(d + i).padStart(2, '0')}`)
    const { data: probes, error: plantError } = await svc
      .from('analytics_events')
      .insert(run.map((day) => ({ artist_id: artistId, type: 'view', created_at: at(day, 1) })))
      .select('id')
    if (plantError) throw new Error(plantError.message)
    const { data, error } = await read(run[0], run[days - 1])
    await svc.from('analytics_events').delete().in('id', (probes ?? []).map((p) => p.id as string))
    if (error) throw new Error(error.message)
    if (((data ?? []) as unknown[]).length === days) return run
  }
  throw new Error('could not find an unrolled day in 20 tries')
}
