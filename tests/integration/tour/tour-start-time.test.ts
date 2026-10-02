// A show's start time reaches the public site, and the column refuses a malformed one.
/**
 * `tour_dates.start_time` (20261001140000): 24h HH:MM, the venue's local time. The unit
 * test (tests/unit/tour/start-time.test.ts) pins the parser, the form path and the
 * snapshot list; this pins what only the database can say: the column exists, its CHECK
 * holds the same rule, and the value travels table → snapshot → revision → public door.
 *
 * The migration is LIVE. The show lives on a THROWAWAY artist (AGENTS.md rule 6): Publish
 * commits that artist's whole tour list, and dropping the artist removes every row it made.
 * get_public_site answers only once the profile has been published, so beforeAll does that.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent, publishProfile, updateContent } from '@/lib/content'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

let artist: ThrowawayArtist
let asA: SupabaseClient
let id: string
const svc = serviceClient()

describe('tour date start time', () => {
  beforeAll(async () => {
    asA = await signInAs(SEED.managerA)
    artist = await createThrowawayArtist(svc, 'tour start time', asA)
    await publishProfile(asA, artist.id)
    const row = await createContent(asA, 'tour_date', artist.id, { date: '2026-11-06', venue: 'Start Time Test Hall' })
    id = row.id as string
  })

  afterAll(async () => {
    await deleteThrowawayArtist(svc, artist)
  })

  it('CRITICAL: rides to the public door as HH:MM, and the column refuses anything else', async () => {
    await updateContent(asA, 'tour_date', id, { start_time: '20:30' })
    await publishContent(asA, 'tour_date', artist.id)
    const { data } = await anonClient().rpc('get_public_site', { p_slug: artist.slug })
    const live = (data as { tour_dates: { id: string; start_time?: string | null }[] }).tour_dates.find((d) => d.id === id)
    expect(live, 'the show is on the public site').toBeDefined()
    expect(live?.start_time).toBe('20:30')

    // The backstop under the parser: the service key skips every app-side check, so only
    // the CHECK stands between it and the column. 23514 = check_violation.
    for (const bad of ['8pm', '24:00', '9:05', '20:30:00']) {
      const { error } = await svc.from('tour_dates').update({ start_time: bad }).eq('id', id)
      expect(error?.code, bad).toBe('23514')
    }
    const { data: row } = await svc.from('tour_dates').select('start_time').eq('id', id).single()
    expect(row?.start_time).toBe('20:30')
  })
})
