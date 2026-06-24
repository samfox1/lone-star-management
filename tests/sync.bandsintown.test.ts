/**
 * MILESTONE 7 — Bandsintown tour-date sync (real DB). Same conflict policy as
 * the Spotify sync, applied to tour_dates via the bandsintown_id dedup key.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncBandsintownTourDates } from '@/lib/sync'
import type { BandsintownTourDate } from '@/lib/bandsintown'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterEach(async () => {
  await svc.from('tour_dates').delete().eq('artist_id', artistA)
  await svc.from('tour_dates').delete().eq('artist_id', artistB)
})

function ev(id: string, venue: string): BandsintownTourDate {
  return { bandsintown_id: id, date: '2026-09-01', venue, city: 'Austin', country: 'US', ticket_url: null }
}

describe('syncBandsintownTourDates', () => {
  it('inserts new, refreshes bandsintown-owned, never clobbers manual rows', async () => {
    await svc.from('tour_dates').insert([
      { artist_id: artistA, date: '2026-01-01', venue: 'My Manual Venue', bandsintown_id: 'bit-manual', source: 'manual' },
      { artist_id: artistA, date: '2026-02-02', venue: 'Stale Auto Venue', bandsintown_id: 'bit-auto', source: 'bandsintown' },
    ])

    const result = await syncBandsintownTourDates(asA, artistA, [
      ev('bit-manual', 'SHOULD NOT OVERWRITE'),
      ev('bit-auto', 'Fresh Venue'),
      ev('bit-new', 'New Venue'),
    ])
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, failed: 0 })

    const { data } = await svc
      .from('tour_dates')
      .select('venue, source, bandsintown_id')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.bandsintown_id, r]))
    expect(byId['bit-manual']).toMatchObject({ venue: 'My Manual Venue', source: 'manual' })
    expect(byId['bit-auto']).toMatchObject({ venue: 'Fresh Venue', source: 'bandsintown' })
    expect(byId['bit-new']).toMatchObject({ venue: 'New Venue', source: 'bandsintown' })
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    await expect(syncBandsintownTourDates(asA, artistB, [ev('bit-x', 'x')])).rejects.toThrow()
    const { count } = await svc
      .from('tour_dates')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0)
  })
})
