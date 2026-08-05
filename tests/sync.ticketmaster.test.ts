/**
 * PHASE 4 — Ticketmaster tour-date sync (real DB). Same conflict policy as
 * Bandsintown: insert new, refresh ticketmaster-owned, never clobber manual;
 * RLS-scoped to the caller's artist. Tour can have multiple sources (unlike the
 * one-source catalog).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncTicketmasterTourDates } from '@/lib/sync'
import type { TicketmasterTourDate } from '@/lib/ticketmaster'
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

const tm = (id: string, venue: string): TicketmasterTourDate => ({
  ticketmaster_id: id,
  date: '2026-09-01',
  venue,
  city: 'Austin',
  country: 'US',
  ticket_url: `https://ticketmaster.com/event/${id}`,
  latitude: 30.2672,
  longitude: -97.7431,
})

describe('syncTicketmasterTourDates', () => {
  it('inserts new, refreshes ticketmaster-owned, never clobbers manual', async () => {
    await svc.from('tour_dates').insert([
      { artist_id: artistA, date: '2026-09-01', venue: 'My Edit', ticketmaster_id: 'tm-manual', source: 'manual' },
      { artist_id: artistA, date: '2026-09-01', venue: 'Stale', ticketmaster_id: 'tm-auto', source: 'ticketmaster' },
    ])

    const result = await syncTicketmasterTourDates(asA, artistA, [
      tm('tm-manual', 'SHOULD NOT OVERWRITE'),
      tm('tm-auto', 'Fresh'),
      tm('tm-new', 'Brand New'),
    ])
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: 1, failed: 0 })

    const { data } = await svc
      .from('tour_dates')
      .select('venue, source, ticketmaster_id, latitude, longitude, on_site')
      .eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.ticketmaster_id, r]))
    expect(byId['tm-manual']).toMatchObject({ venue: 'My Edit', source: 'manual' })
    expect(byId['tm-auto']).toMatchObject({ venue: 'Fresh', source: 'ticketmaster' })
    // on_site is `not null default true` and the public doors coalesce to true, so the
    // insertDefaults `on_site: false` is the only thing keeping an import off the site.
    expect(byId['tm-new']).toMatchObject({ venue: 'Brand New', source: 'ticketmaster', latitude: 30.2672, longitude: -97.7431, on_site: false })
  })

  it("CRITICAL: cannot sync into another tenant's artist", async () => {
    // Assert Postgres refuses — a bare .toThrow() would pass on any incidental throw.
    await expect(syncTicketmasterTourDates(asA, artistB, [tm('tm-evil', 'evil')])).rejects.toThrow(/row-level security/i)
    const { count } = await svc
      .from('tour_dates')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(count).toBe(0)
  })
})
