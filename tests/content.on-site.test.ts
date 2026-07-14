/**
 * On-site presence for videos / merch / tour dates — the Music-page publish model
 * generalized (20260707120000_content_visibility; the flag was renamed
 * visible → on_site in 20260714150000). Against the real DB as seeded managers,
 * this proves:
 *   - createContent lands new video/merch/tour_date rows OFF-site (on_site=false),
 *     so an add is a draft the manager then selects + publishes on;
 *   - reconcileOnSite flips exactly the rows that should change, both ways, and
 *     is RLS-scoped (can't touch another tenant);
 *   - the public door (get_public_site) gates each section on the live `on_site`
 *     flag: a published-but-hidden item is absent until it's toggled on.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type OnSiteEntity,
  createContent,
  publishContent,
  reconcileOnSite,
} from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

// One case per on-site-gated content type: the section key on the public site, a
// minimal working row, and a title/marker to find it by.
const CASES: {
  type: Exclude<OnSiteEntity, 'release'>
  table: string
  siteKey: 'videos' | 'merch' | 'tour_dates'
  create: Record<string, unknown>
  marker: string
}[] = [
  { type: 'video', table: 'videos', siteKey: 'videos', create: { title: 'VIS video', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/vis1' }, marker: 'VIS video' },
  { type: 'merch', table: 'merch', siteKey: 'merch', create: { title: 'VIS merch', price: 20 }, marker: 'VIS merch' },
  { type: 'tour_date', table: 'tour_dates', siteKey: 'tour_dates', create: { date: '2026-10-10', venue: 'VIS venue', city: 'Austin' }, marker: 'VIS venue' },
]

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterEach(async () => {
  for (const c of CASES) {
    await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', c.type)
    await svc.from(c.table).delete().eq('artist_id', artistA)
    await svc.from(c.table).delete().eq('artist_id', artistB)
  }
})

async function publicSection(siteKey: string): Promise<Record<string, unknown>[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as Record<string, Record<string, unknown>[]> | null)?.[siteKey] ?? [])
}

describe.each(CASES)('visibility: $type', (c) => {
  it('createContent lands the new row off-site (on_site=false)', async () => {
    const row = await createContent(asA, c.type, artistA, c.create)
    const { data } = await svc.from(c.table).select('on_site').eq('id', row.id as string).single()
    expect(data!.on_site).toBe(false)
  })

  it('CRITICAL: a published row stays hidden until toggled on-site', async () => {
    const row = await createContent(asA, c.type, artistA, c.create) // on_site=false
    await publishContent(asA, c.type, artistA) // snapshot exists, but still hidden
    expect((await publicSection(c.siteKey)).some((x) => JSON.stringify(x).includes(c.marker))).toBe(false)

    await reconcileOnSite(asA, c.type, artistA, [row.id as string]) // toggle on
    expect((await publicSection(c.siteKey)).some((x) => JSON.stringify(x).includes(c.marker))).toBe(true)

    await reconcileOnSite(asA, c.type, artistA, []) // toggle back off
    expect((await publicSection(c.siteKey)).some((x) => JSON.stringify(x).includes(c.marker))).toBe(false)
  })

  it('reconcileOnSite touches only rows that change, both directions', async () => {
    const on = await createContent(asA, c.type, artistA, c.create)
    const off = await createContent(asA, c.type, artistA, c.create)
    await reconcileOnSite(asA, c.type, artistA, [on.id as string]) // seed: `on` is on-site

    // Desired set = keep `on`, add `off` → one flips on, nothing flips off.
    const res = await reconcileOnSite(asA, c.type, artistA, [on.id as string, off.id as string])
    expect(res).toEqual({ shown: 1, hidden: 0 })

    const { data } = await svc.from(c.table).select('id, on_site').eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.id, r.on_site]))
    expect(byId[on.id as string]).toBe(true)
    expect(byId[off.id as string]).toBe(true)
  })

  it("CRITICAL: cannot flip another tenant's rows on-site", async () => {
    const { data: bRow } = await svc
      .from(c.table)
      .insert({ artist_id: artistB, ...c.create, on_site: false })
      .select('id')
      .single()

    const res = await reconcileOnSite(asA, c.type, artistB, [bRow!.id as string])
    expect(res).toEqual({ shown: 0, hidden: 0 }) // RLS makes A's write a no-op

    const { data } = await svc.from(c.table).select('on_site').eq('id', bRow!.id as string).single()
    expect(data!.on_site).toBe(false) // untouched
  })
})
