// On-site presence for videos, merch and tour dates, and the two write paths that own it.
/**
 * On-site presence for videos / merch / tour dates — the Music-page publish model
 * generalized (20260707120000_content_visibility; the flag was renamed
 * visible → on_site in 20260714150000).
 *
 * Two truths, split the way ADR 0009 splits the write paths:
 *
 *  1. Every gated type behaves the same AT THE DOOR, whichever path writes the flag:
 *     a new row lands off-site, a published row stays hidden until `on_site` is true, and
 *     a published row survives the deletion of its working row until a publish tombstones
 *     it. That's the contract the public site depends on, and it holds per-type — which is
 *     why it is asserted per-type rather than for whichever type came to mind: the door
 *     joins each section separately, so the rule can be broken for exactly one of them.
 *  2. reconcileOnSite — making the live set exactly a selection — now applies ONLY to
 *     the publish-reconciled types (merch here; release has its own suite). Running it
 *     against a live-toggle type is the bug ADR 0009 exists to prevent, so it is not
 *     exercised against one here.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent, reconcileOnSite } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

type Case = {
  type: 'video' | 'merch' | 'tour_date'
  table: string
  siteKey: 'videos' | 'merch' | 'tour_dates'
  create: Record<string, unknown>
  marker: string
}

// One case per on-site-gated content type: the section key on the public site, a
// minimal working row, and a title/marker to find it by.
const CASES: Case[] = [
  { type: 'video', table: 'videos', siteKey: 'videos', create: { title: 'VIS video', provider: 'youtube', embed_url: 'https://www.youtube.com/embed/vis1' }, marker: 'VIS video' },
  { type: 'merch', table: 'merch', siteKey: 'merch', create: { title: 'VIS merch', price: 20 }, marker: 'VIS merch' },
  { type: 'tour_date', table: 'tour_dates', siteKey: 'tour_dates', create: { date: '2026-10-10', venue: 'VIS venue', city: 'Austin' }, marker: 'VIS venue' },
]

const MERCH = CASES.find((c) => c.type === 'merch')!

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

/** Rows this file created, per table. Teardown removes ONLY these: the project is shared
 *  and live, so deleting every video / merch / tour date for the artist erases whatever
 *  else is in there and leaves later suites asserting over an empty site. */
const created: { table: string; id: string }[] = []

/** createContent + remember the row for teardown. */
async function create(c: Case, artistId = artistA, client = asA) {
  const row = await createContent(client, c.type, artistId, c.create)
  created.push({ table: c.table, id: row.id as string })
  return row
}

afterEach(async () => {
  if (!created.length) return
  await svc.from('revisions').delete().in('entity_id', created.map((r) => r.id))
  for (const table of new Set(created.map((r) => r.table))) {
    await svc.from(table).delete().in('id', created.filter((r) => r.table === table).map((r) => r.id))
  }
  created.length = 0
})

async function publicSection(siteKey: string): Promise<Record<string, unknown>[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return ((data as Record<string, Record<string, unknown>[]> | null)?.[siteKey] ?? [])
}

const onSite = (c: Case, siteKey = c.siteKey) =>
  publicSection(siteKey).then((rows) => rows.some((x) => JSON.stringify(x).includes(c.marker)))

/** Write one row's flag directly, as the live toggle does (setOnSiteAction's update).
 *  RLS-scoped, so it also stands in for a cross-tenant attempt. */
const writeFlag = (client: SupabaseClient, c: Case, id: string, on: boolean, artistId: string) =>
  client.from(c.table).update({ on_site: on }).eq('id', id).eq('artist_id', artistId)

describe.each(CASES)('on-site gating: $type', (c) => {
  it('createContent lands the new row off-site (on_site=false)', async () => {
    const row = await create(c)
    const { data } = await svc.from(c.table).select('on_site').eq('id', row.id as string).single()
    expect(data!.on_site).toBe(false)
  })

  it('CRITICAL: a published row stays hidden until the flag is on, and hides again when off', async () => {
    const row = await create(c) // on_site=false
    const id = row.id as string
    await publishContent(asA, c.type, artistA) // snapshot exists, but still hidden
    expect(await onSite(c)).toBe(false)

    // The door gates on the WORKING row, so the flag alone moves it — no republish.
    await writeFlag(asA, c, id, true, artistA)
    expect(await onSite(c)).toBe(true)

    await writeFlag(asA, c, id, false, artistA)
    expect(await onSite(c)).toBe(false)
  })

  it('CRITICAL: a published row whose WORKING row was deleted stays live until a tombstone', async () => {
    // The door LEFT JOINs the working row and coalesces a missing one to on-site
    // (20260707200000). Deleting a row is a DRAFT edit like any other: the published
    // snapshot stays authoritative until a publish tombstones it. An inner join reads as
    // a harmless simplification and yanks live content the moment anyone deletes a row.
    const row = await create(c)
    const id = row.id as string
    await writeFlag(asA, c, id, true, artistA)
    await publishContent(asA, c.type, artistA)
    expect(await onSite(c)).toBe(true)

    await svc.from(c.table).delete().eq('id', id)
    const { data: gone } = await svc.from(c.table).select('id').eq('id', id).maybeSingle()
    expect(gone).toBeNull() // no working row left to join to
    expect(await onSite(c)).toBe(true)
  })
})

/**
 * reconcileOnSite is the PUBLISH-RECONCILED path only (ADR 0009). Merch stands for it
 * here; releases have their own suite. Videos and tour dates deliberately do NOT
 * appear — they are live-toggled, and reconciling one would revert the editor's
 * toggles at the next publish, which is the whole reason for the split.
 */
describe('reconcileOnSite (publish-reconciled types)', () => {
  it('touches only rows that change, both directions', async () => {
    const on = await create(MERCH)
    const off = await create(MERCH)
    await reconcileOnSite(asA, 'merch', artistA, [on.id as string]) // seed: `on` is on-site

    // Desired set = keep `on`, add `off` → one flips on, nothing flips off.
    const res = await reconcileOnSite(asA, 'merch', artistA, [on.id as string, off.id as string])
    expect(res).toEqual({ shown: 1, hidden: 0 })

    const { data } = await svc.from(MERCH.table).select('id, on_site').eq('artist_id', artistA)
    const byId = Object.fromEntries((data ?? []).map((r) => [r.id, r.on_site]))
    expect(byId[on.id as string]).toBe(true)
    expect(byId[off.id as string]).toBe(true)
  })

  it('takes off the site anything absent from the selection', async () => {
    // The behaviour that makes reconcile incompatible with a live toggle: an empty
    // selection hides everything, including a row someone just switched on elsewhere.
    const row = await create(MERCH)
    await reconcileOnSite(asA, 'merch', artistA, [row.id as string])

    const res = await reconcileOnSite(asA, 'merch', artistA, [])
    expect(res).toEqual({ shown: 0, hidden: 1 })

    const { data } = await svc.from(MERCH.table).select('on_site').eq('id', row.id as string).single()
    expect(data!.on_site).toBe(false)
  })

  it("CRITICAL: cannot flip another tenant's rows on-site", async () => {
    // The one cross-tenant case kept here: it pins the RETURN-VALUE contract as well as
    // the row (a caller reads {shown, hidden} to report what it published, so an RLS
    // no-op reported as "1 shown" is a lie the row check alone wouldn't catch). Plain
    // "A's write to B is a no-op" belongs to rls.isolation.test.ts.
    const { data: bRow } = await svc
      .from(MERCH.table)
      .insert({ artist_id: artistB, ...MERCH.create, on_site: false })
      .select('id')
      .single()
    created.push({ table: MERCH.table, id: bRow!.id as string })

    const res = await reconcileOnSite(asA, 'merch', artistB, [bRow!.id as string])
    expect(res).toEqual({ shown: 0, hidden: 0 }) // RLS makes A's write a no-op

    const { data } = await svc.from(MERCH.table).select('on_site').eq('id', bRow!.id as string).single()
    expect(data!.on_site).toBe(false) // untouched
  })
})
