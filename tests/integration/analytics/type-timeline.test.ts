// `analytics_type_timeline` — the daily series per event type the metric sparklines draw.
/**
 * This reader has two arms and one rule: a day's numbers must not move when the
 * nightly roll-up gets to it. The tally arm reads `analytics.daily_type`, the raw
 * arm reads `analytics_events` for days the ledger has not rolled, and the two
 * filters have to stay identical — or the series grows a step at the boundary
 * between yesterday and the day before, which is the place a reader is least
 * likely to look and most likely to believe. So: plant a day, read it raw, roll
 * it up, read it again, assert the two are identical. Nothing else pins the
 * roll-up's `not is_bot` filter to the reader's copy of it.
 *
 * Two things about the fixture, both learned the hard way on 2026-09-13:
 *
 *   PostgREST does not expose the `analytics` schema, so `.schema('analytics')`
 *   returns `{ data: null, error: 'Invalid schema: analytics' }`. Read as a plain
 *   `.data`, that is indistinguishable from "no rows" — an earlier draft probed
 *   the ledger that way, believed every day was free, and its teardown silently
 *   deleted nothing. Every assertion here goes through a public reader instead.
 *
 *   The rows therefore belong to a THROWAWAY artist (AGENTS.md rule 6): every
 *   tally table is `on delete cascade` from `artists`, so dropping the artist
 *   takes the tallies with it. The same draft planted on the seed artist and left
 *   tallies on it that no test could reach. Each run still leaves ONE date in
 *   `analytics.rolled_days` — it names no artist, it is years before the first
 *   real row, and the schema cannot be reached to delete it. Same known leftover
 *   `reader-parity.test.ts` documents.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectExecuteDenied } from '@tests/helpers/rls'
import { createThrowawayArtist, deleteThrowawayArtist } from '@tests/helpers/artist'
import { at, unrolledDays } from '@tests/integration/analytics/_days'

const svc = serviceClient()
let asA: SupabaseClient
let artistF: string
let DAY: string

/** What gets planted. More than one type, and a bot that must never be counted. */
const PLANTED = [
  { type: 'view', is_bot: false },
  { type: 'view', is_bot: false },
  { type: 'view', is_bot: false },
  { type: 'play', is_bot: false },
  { type: 'play', is_bot: false },
  { type: 'link_click', is_bot: false },
  { type: 'view', is_bot: true },
] as const

/** Derived from the fixture, never hand-listed: a new planted type cannot be silently dropped. */
const EXPECTED = PLANTED.filter((e) => !e.is_bot).reduce<Record<string, number>>(
  (acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }),
  {},
)

async function plant(type: string, hour: number, isBot = false): Promise<void> {
  const { error } = await svc.from('analytics_events').insert({
    artist_id: artistF, type, is_bot: isBot, created_at: at(DAY, hour),
  })
  if (error) throw new Error(error.message)
}

/** The reader for the planted day, as a plain {type: count} map. */
async function readDay(c: SupabaseClient = svc): Promise<Record<string, number>> {
  const { data, error } = await c.rpc('analytics_type_timeline', {
    p_artist_id: artistF, p_since: DAY, p_until: DAY,
  })
  expect(error, error?.message).toBeNull()
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as { day: string; type: string; count: number }[]) {
    expect(r.day).toBe(DAY)
    out[r.type] = Number(r.count)
  }
  return out
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  artistF = (await createThrowawayArtist(svc, 'Type timeline', asA)).id
  // Probed through this reader itself: a day in its ledger reads tallies, not the probe.
  DAY = (await unrolledDays(svc, artistF, (first, last) => svc.rpc('analytics_type_timeline', { p_artist_id: artistF, p_since: first, p_until: last })))[0]
  let hour = 6
  for (const e of PLANTED) await plant(e.type, hour++, e.is_bot)
})

afterAll(async () => {
  // Cascades analytics_events and every analytics.daily_* row for this artist.
  await deleteThrowawayArtist(svc, artistF)
})

describe('analytics_type_timeline', () => {
  it('CRITICAL: a day reads the same before and after the roll-up touches it', async () => {
    const raw = await readDay()
    expect(raw, 'the raw arm').toEqual(EXPECTED)

    const { error } = await svc.rpc('roll_up_analytics', { p_day: DAY })
    expect(error, error?.message).toBeNull()

    // Proof the arm actually SWITCHED rather than the raw rows being read twice:
    // with the raw rows deleted, anything still returned can only be the tally.
    const tallyArm = await readDay()
    expect(tallyArm, 'the tally arm').toEqual(raw)

    await svc.from('analytics_events').delete().eq('artist_id', artistF)
    expect(await readDay(), 'still served after the raw rows are gone').toEqual(raw)
  })

  it('counts every type, not just views — the sparklines need plays and clicks', async () => {
    expect(Object.keys(await readDay()).sort()).toEqual(Object.keys(EXPECTED).sort())
    expect(Object.keys(EXPECTED).length).toBeGreaterThan(1)
  })

  it('never counts a bot', async () => {
    const counted = Object.values(await readDay()).reduce((n, v) => n + v, 0)
    expect(counted).toBe(PLANTED.filter((e) => !e.is_bot).length)
    expect(PLANTED.some((e) => e.is_bot), 'a bot really was planted').toBe(true)
  })

  it('returns nothing outside the window', async () => {
    const before = new Date(`${DAY}T00:00:00Z`)
    before.setUTCDate(before.getUTCDate() - 1)
    const iso = before.toISOString().slice(0, 10)
    const { data, error } = await svc.rpc('analytics_type_timeline', {
      p_artist_id: artistF, p_since: iso, p_until: iso,
    })
    // Without this the test passes when the function does not exist at all:
    // a failed RPC also returns no rows. Seen green against a missing door.
    expect(error, error?.message).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: anon cannot call it — the default grant is revoked, not just PUBLIC', async () => {
    // The witness: the rows are there and readable, so the denial below is the
    // door closing rather than an empty table.
    expect(Object.keys(await readDay()).length).toBeGreaterThan(0)
    const { error } = await anonClient().rpc('analytics_type_timeline', {
      p_artist_id: artistF, p_since: DAY, p_until: DAY,
    })
    expectExecuteDenied(error, 'analytics_type_timeline')
  })

  it('a signed-in manager reads the artist they manage', async () => {
    expect(await readDay(asA)).toEqual(EXPECTED)
  })

  it('a manager who does not manage this artist sees nothing — RLS, not the grant', async () => {
    const asB = await signInAs(SEED.managerB)
    const { data, error } = await asB.rpc('analytics_type_timeline', {
      p_artist_id: artistF, p_since: DAY, p_until: DAY,
    })
    expect(error, error?.message).toBeNull()
    expect(data ?? [], 'B must not see A rows').toHaveLength(0)
  })
})
