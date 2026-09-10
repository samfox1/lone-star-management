// A tour date's supporting acts, and their links, reach the public site.
/**
 * A tour date's supporting acts reach the PUBLIC SITE.
 *
 * skeen-website has read `support` off every tour date since it was written
 * (lib/mapSite.ts → Shows.tsx renders "+ Arlo, Bo Reed"), but the column did not
 * exist on this side, so the site quietly rendered nothing forever. The key is
 * optional on the wire, which is exactly why nothing ever failed.
 *
 * What actually carries it is PUBLISHABLE.tour_date.snapshot — get_public_site
 * returns each revision's `data` wholesale, so a column missing from that list never
 * reaches the site no matter what the table holds. This asserts the whole path:
 * table → snapshot → revision → public door.
 *
 * on_site is set directly rather than through reconcileOnSite so the test states
 * only what it means (the date is on the site) and survives tour_date moving between
 * the two on-site write paths.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent, setSupportUrl, updateContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

type PublicTourDate = {
  id: string
  venue: string | null
  state: string | null
  country: string | null
  support?: string[] | null
  support_urls?: Record<string, string> | null
  is_past?: boolean | null
}

const VENUE = 'Support Test Hall'
let artistA: string
let asA: SupabaseClient
let id: string
const svc = serviceClient()

/** The date as the public door serves it — what skeen-website actually receives. */
async function fromPublicSite(): Promise<PublicTourDate | undefined> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  const dates = (data as { tour_dates: PublicTourDate[] }).tour_dates
  return dates.find((d) => d.id === id)
}

async function publishOnSite() {
  await publishContent(asA, 'tour_date', artistA)
  await asA.from('tour_dates').update({ on_site: true }).eq('id', id).eq('artist_id', artistA)
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  const row = await createContent(asA, 'tour_date', artistA, {
    date: '2026-11-04',
    venue: VENUE,
    city: 'Austin',
    state: 'TX',
    // A comma INSIDE one act: the tag input's reason to exist, asserted end to end.
    support: ['Arlo', 'Crosby, Stills & Nash'],
  })
  id = row.id as string
})

afterAll(async () => {
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_id', id)
  await svc.from('tour_dates').delete().eq('id', id)
})

describe('tour date support (who else is performing)', () => {
  it('stores the acts as written, commas and all', async () => {
    const rows = await asA.from('tour_dates').select('support').eq('id', id).single()
    expect(rows.data?.support).toEqual(['Arlo', 'Crosby, Stills & Nash'])
  })

  it('defaults to an empty array, never null, when no acts are given', async () => {
    // skeen reads `t.support?.length` — null would work, but NOT NULL DEFAULT '{}'
    // matches tracks.featured_artists and spares every reader a null branch.
    const row = await createContent(asA, 'tour_date', artistA, { date: '2026-11-05', venue: 'No Support Hall' })
    expect(row.support).toEqual([])
    await svc.from('tour_dates').delete().eq('id', row.id as string)
  })

  it('CRITICAL: rides the snapshot to the public door, alongside country', async () => {
    await publishOnSite()
    const live = await fromPublicSite()
    expect(live).toBeDefined()
    expect(live?.support).toEqual(['Arlo', 'Crosby, Stills & Nash'])
    // state ships too — a two-letter US code chosen from the dropdown, so skeen can
    // render "Austin, TX".
    expect(live?.state).toBe('TX')
  })

  it('publishes an edited lineup', async () => {
    await updateContent(asA, 'tour_date', id, { support: ['Bo Reed'] })
    await publishOnSite()
    expect((await fromPublicSite())?.support).toEqual(['Bo Reed'])
  })

  it('publishes a CLEARED lineup, so a dropped act leaves the site', async () => {
    await updateContent(asA, 'tour_date', id, { support: [] })
    await publishOnSite()
    expect((await fromPublicSite())?.support).toEqual([])
  })
})

describe('tour date support links (per-act outbound URLs)', () => {
  // A separate date so the lineup edits above don't interfere. Cleaned up here.
  let linkId: string
  beforeAll(async () => {
    const row = await createContent(asA, 'tour_date', artistA, {
      date: '2026-12-01',
      venue: 'Support Link Hall',
      city: 'Austin',
      support: ['Gudfella', 'Arlo'],
    })
    linkId = row.id as string
  })
  afterAll(async () => {
    await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_id', linkId)
    await svc.from('tour_dates').delete().eq('id', linkId)
  })

  async function linkDate(): Promise<PublicTourDate | undefined> {
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    return (data as { tour_dates: PublicTourDate[] }).tour_dates.find((d) => d.id === linkId)
  }

  it('defaults support_urls to an empty map, never null', async () => {
    const { data } = await asA.from('tour_dates').select('support_urls').eq('id', linkId).single()
    expect(data?.support_urls).toEqual({})
  })

  it('sets ONE act’s URL by name without touching the name list', async () => {
    const map = await setSupportUrl(asA, artistA, linkId, 'Gudfella', 'https://gudfella.example')
    expect(map).toEqual({ Gudfella: 'https://gudfella.example' })
    // The names are untouched — the two columns don’t clobber each other.
    const { data } = await asA.from('tour_dates').select('support, support_urls').eq('id', linkId).single()
    expect(data?.support).toEqual(['Gudfella', 'Arlo'])
    expect(data?.support_urls).toEqual({ Gudfella: 'https://gudfella.example' })
  })

  it('CRITICAL: support_urls rides the snapshot to the public door, beside the names', async () => {
    await publishContent(asA, 'tour_date', artistA)
    await asA.from('tour_dates').update({ on_site: true }).eq('id', linkId).eq('artist_id', artistA)
    const live = await linkDate()
    expect(live?.support).toEqual(['Gudfella', 'Arlo'])
    expect(live?.support_urls).toEqual({ Gudfella: 'https://gudfella.example' })
  })

  it('clears one act’s URL (blank), leaving other acts’ links intact', async () => {
    await setSupportUrl(asA, artistA, linkId, 'Arlo', 'https://arlo.example')
    let map = await setSupportUrl(asA, artistA, linkId, 'Gudfella', '')
    expect(map).toEqual({ Arlo: 'https://arlo.example' })
    // And it publishes the cleared state.
    await publishContent(asA, 'tour_date', artistA)
    expect((await linkDate())?.support_urls).toEqual({ Arlo: 'https://arlo.example' })
    map = await setSupportUrl(asA, artistA, linkId, 'Arlo', '')
    expect(map).toEqual({})
  })
})

describe('tour date without a date (TBA row)', () => {
  it('can be created with no date, and the door serves it without erroring', async () => {
    // `date` was NOT NULL until 20260716120000; a partial add would fail at the DB.
    const row = await createContent(asA, 'tour_date', artistA, { venue: 'TBA Hall', city: 'Austin' })
    const tbaId = row.id as string
    try {
      expect(row.date).toBeNull()

      // Publish + put on site, then read the door. The door orders by date, and a null
      // must sort (last) rather than throw — this is the actual regression risk.
      await publishContent(asA, 'tour_date', artistA)
      await asA.from('tour_dates').update({ on_site: true }).eq('id', tbaId).eq('artist_id', artistA)
      const { data, error } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
      expect(error).toBeNull()
      const live = (data as { tour_dates: { id: string; date: string | null }[] }).tour_dates.find((d) => d.id === tbaId)
      expect(live?.date).toBeNull()
    } finally {
      await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_id', tbaId)
      await svc.from('tour_dates').delete().eq('id', tbaId)
    }
  })

  it("the 'old show' flag is stored and rides the snapshot to the door", async () => {
    // A dateless old show — Skeen's core case. The flag is what puts it in Past on the
    // site, so it must survive create → publish → public read.
    const row = await createContent(asA, 'tour_date', artistA, { venue: 'Old Hall', city: 'Austin', is_past: true })
    const oldId = row.id as string
    try {
      expect(row.is_past).toBe(true)
      await publishContent(asA, 'tour_date', artistA)
      await asA.from('tour_dates').update({ on_site: true }).eq('id', oldId).eq('artist_id', artistA)
      const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
      const live = (data as { tour_dates: PublicTourDate[] }).tour_dates.find((d) => d.id === oldId)
      expect(live?.is_past).toBe(true)
    } finally {
      await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_id', oldId)
      await svc.from('tour_dates').delete().eq('id', oldId)
    }
  })
})
