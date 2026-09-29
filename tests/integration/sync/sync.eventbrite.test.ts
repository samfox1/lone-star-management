// Eventbrite shows → tour dates against the real database: drafts, one row per event, edits kept.
/**
 * PENDING MIGRATION: supabase/migrations/20260929120500_eventbrite_integration.sql (written
 * 2026-09-28, NOT pushed). Until it is pushed this file SKIPS itself: the probe reads
 * `tour_dates.eventbrite_id` and skips only on 42703 ("column does not exist") — any other
 * answer runs the suite, so the push turns it on by itself and a network failure fails loudly.
 * The probe is one read of one column, made before the file takes the database lock.
 *
 * The unit twin (tests/unit/tour/eventbrite-sync.test.ts) pins the writer against a fake; this
 * proves the same rules where they finally hold — Postgres, RLS, the unique index, the
 * CHECK on `source`, and `reorder_rows`:
 *
 *   - a pulled show is a DRAFT: off the site, and no revision is written (nothing published);
 *   - a second pull adds nothing; a racing duplicate is refused by the unique index;
 *   - a manager's edit (through their own RLS session) survives the next pull;
 *   - new shows are slotted by date in a dragged list;
 *   - a pull can only write into its own artist (the planted row in B survives).
 *
 * Throwaway artists only (AGENTS.md rule 6): the blanket wipe is exactly what this file made.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncEventbriteTourDates } from '@/lib/sync'
import type { IncomingShow } from '@/lib/tour-pull'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist } from '@tests/helpers/artist'

const svc = serviceClient()
const probe = await svc.from('tour_dates').select('eventbrite_id').limit(1)
const PENDING = probe.error?.code === '42703'

const show = (id: string, over: Partial<IncomingShow['values']> = {}): IncomingShow => ({
  externalId: id,
  values: {
    date: '2026-11-05',
    venue: 'Mohawk',
    city: 'Austin',
    state: 'TX',
    country: 'United States',
    ticket_url: `https://www.eventbrite.com/e/skeen-live-tickets-${id}`,
    latitude: 30.27,
    longitude: -97.74,
    ...over,
  },
})

describe.skipIf(PENDING)(PENDING ? 'PENDING MIGRATION 20260929120500 (not pushed): Eventbrite sync — skipped' : 'syncEventbriteTourDates (real database)', () => {
  let artistA: string
  let artistB: string
  let asA: SupabaseClient

  beforeAll(async () => {
    asA = await signInAs(SEED.managerA)
    const asB = await signInAs(SEED.managerB)
    artistA = (await createThrowawayArtist(svc, 'Eventbrite sync A', asA)).id
    artistB = (await createThrowawayArtist(svc, 'Eventbrite sync B', asB)).id
  })

  afterAll(async () => {
    await deleteThrowawayArtist(svc, artistA)
    await deleteThrowawayArtist(svc, artistB)
  })

  afterEach(async () => {
    // Safe as a blanket wipe ONLY because both artists were created by this file.
    await svc.from('tour_dates').delete().eq('artist_id', artistA)
    await svc.from('tour_dates').delete().eq('artist_id', artistB)
  })

  const rowsOf = async (artist: string) =>
    (await svc.from('tour_dates').select('*').eq('artist_id', artist).order('date')).data as Record<string, unknown>[]

  it('CRITICAL: new shows land as drafts — off the site, owned by Eventbrite, and never published', async () => {
    const result = await syncEventbriteTourDates(asA, artistA, [show('101'), show('102', { date: '2026-12-01', venue: 'Online', city: null, state: null, country: null, latitude: null, longitude: null })])
    expect(result).toMatchObject({ added: 2, failed: 0 })
    const rows = await rowsOf(artistA)
    expect(rows.map((r) => [r.eventbrite_id, r.source, r.on_site])).toEqual([
      ['101', 'eventbrite', false],
      ['102', 'eventbrite', false],
    ])
    expect(rows[0]).toMatchObject({ date: '2026-11-05', venue: 'Mohawk', city: 'Austin', state: 'TX', ticket_url: 'https://www.eventbrite.com/e/skeen-live-tickets-101' })
    expect(rows[0].pulled).toMatchObject({ venue: 'Mohawk', date: '2026-11-05' })
    // Nothing published: no tour_date revision exists for this artist.
    const { count } = await svc.from('revisions').select('id', { count: 'exact', head: true }).eq('artist_id', artistA).eq('entity_type', 'tour_date')
    expect(count).toBe(0)
  })

  it('CRITICAL: the same events again add nothing; a racing duplicate is refused by the unique index', async () => {
    await syncEventbriteTourDates(asA, artistA, [show('101'), show('102')])
    const again = await syncEventbriteTourDates(asA, artistA, [show('101'), show('102')])
    expect(again).toMatchObject({ added: 0, updated: 0, failed: 0 })
    expect(await rowsOf(artistA)).toHaveLength(2)
    const dup = await svc.from('tour_dates').insert({ artist_id: artistA, eventbrite_id: '101', source: 'eventbrite', date: '2026-11-05' })
    expect(dup.error?.code).toBe('23505')
  })

  it('CRITICAL: a manager’s edit survives the next pull; what they did not touch follows Eventbrite', async () => {
    await syncEventbriteTourDates(asA, artistA, [show('101')])
    const [row] = await rowsOf(artistA)
    const edit = await asA.from('tour_dates').update({ venue: 'Mohawk (outdoor stage)' }).eq('id', row.id as string).select('id')
    expect(edit.data).toHaveLength(1)
    const result = await syncEventbriteTourDates(asA, artistA, [show('101', { venue: 'Stubb’s', city: 'Round Rock' })])
    expect(result).toMatchObject({ added: 0, updated: 1, failed: 0 })
    const [after] = await rowsOf(artistA)
    expect(after).toMatchObject({ venue: 'Mohawk (outdoor stage)', city: 'Round Rock' })
  })

  it('in a dragged list a new show is slotted by its date', async () => {
    await svc.from('tour_dates').insert([
      { artist_id: artistA, source: 'manual', date: '2026-10-01', venue: 'First', sort_order: 0 },
      { artist_id: artistA, source: 'manual', date: '2026-12-01', venue: 'Last', sort_order: 1 },
    ])
    await syncEventbriteTourDates(asA, artistA, [show('101', { date: '2026-11-05' })])
    const { data } = await svc.from('tour_dates').select('venue, sort_order').eq('artist_id', artistA).order('sort_order')
    expect((data ?? []).map((r) => r.venue)).toEqual(['First', 'Mohawk', 'Last'])
  })

  it('CRITICAL: a pull can only write into its own artist', async () => {
    const planted = await svc.from('tour_dates').insert({ artist_id: artistB, source: 'manual', date: '2026-10-10', venue: 'B’s own show' }).select('id').single()
    expect(planted.error).toBeNull()
    await expect(syncEventbriteTourDates(asA, artistB, [show('201')])).rejects.toThrow()
    const rows = await rowsOf(artistB)
    expect(rows.map((r) => r.venue)).toEqual(['B’s own show'])
  })
})
