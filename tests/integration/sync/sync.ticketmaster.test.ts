// Ticketmaster tour-date sync against the real database.
/**
 * PHASE 4 — Ticketmaster tour-date sync (real DB). Same conflict policy as
 * Bandsintown: insert new, refresh ticketmaster-owned, never clobber manual;
 * RLS-scoped to the caller's artist. Tour can have multiple sources (unlike the
 * one-source catalog).
 *
 * WHY THE ARTISTS ARE THROWAWAYS (AGENTS.md rule 6). This file used to run on the shared
 * seed artists and wipe their `tour_dates` after every test — a teardown that destroys rows the
 * file never created, on the live hosted project. It also left the tenancy test below
 * asserting "artist B holds 0 rows" as proof that a cross-tenant write was refused, which
 * the teardown itself guaranteed. Both artists are created here and dropped here, so the
 * blanket wipe IS "exactly what I created", the absolute counts are true about a genuinely
 * empty table, and B now carries a PLANTED row so the refusal has something to refuse.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncTicketmasterTourDates } from '@/lib/sync'
import type { TicketmasterTourDate } from '@/lib/ticketmaster'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist } from '@tests/helpers/artist'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  const asB = await signInAs(SEED.managerB)
  artistA = (await createThrowawayArtist(svc, 'Ticketmaster sync A', asA)).id
  artistB = (await createThrowawayArtist(svc, 'Ticketmaster sync B', asB)).id
})

afterAll(async () => {
  // One statement, and the cascade takes every child row either artist ever held.
  await deleteThrowawayArtist(svc, artistA)
  await deleteThrowawayArtist(svc, artistB)
})

afterEach(async () => {
  // Safe as a blanket wipe ONLY because both artists were created by this file.
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
    // A PLANTED WITNESS (AGENTS.md rule 2). This used to assert that B held ZERO rows
    // afterwards — a fact the teardown established before the sync was ever attempted, so
    // it read as protection while passing whether or not RLS refused anything. With a row
    // already there, "B's data is untouched" is a claim about a table that HAS content,
    // and a write that landed would show up as a second row.
    const { error: plantErr } = await svc.from('tour_dates').insert({ artist_id: artistB, date: '2027-03-03', venue: "B's own show", source: 'manual' })
    expect(plantErr, 'the witness must exist before the denial means anything').toBeNull()

    await expect(syncTicketmasterTourDates(asA, artistB, [tm('tm-evil', 'evil')])).rejects.toThrow(/row-level security/i)

    const { data: after } = await svc.from('tour_dates').select('venue').eq('artist_id', artistB)
    expect(after).toHaveLength(1) // the witness, and nothing the sync tried to add
    expect(after![0].venue).toBe("B's own show")
  })
})
