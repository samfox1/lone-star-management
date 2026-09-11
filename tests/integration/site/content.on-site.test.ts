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
 *  2. (2026-09-11) Two models: a video's flag is live; a tour date's or product's flag
 *     is a draft the door reads from the snapshot (ADR 0010). Both pinned per kind.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent } from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
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


beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
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
  it('createContent lands the row where its KIND says: a video off-site, a date or product ON (in the draft)', async () => {
    // A video still arrives off-site (83 YouTube imports must never auto-appear). A
    // hand-added date or product is on-site IN THE DRAFT: Publish is what shows it
    // (PRESENCE_PLAN, revised 2026-09-11).
    const row = await create(c)
    const { data } = await svc.from(c.table).select('on_site').eq('id', row.id as string).single()
    expect(data!.on_site).toBe(c.type !== 'video')
  })

  it('CRITICAL: the flag moves a video at once, but a date or product only after Publish', async () => {
    // Two models, on purpose. A video is LIVE-TOGGLED (ADR 0009): the door reads the
    // working row. A tour date or product is DRAFT-PRESENCE (ADR 0010, revised
    // 2026-09-11: "the user toggles, hits publish, and it updates on the live site"):
    // the door reads the snapshot, so a flip is invisible until the next publish.
    const row = await create(c)
    const id = row.id as string
    const start = c.type !== 'video'
    await publishContent(asA, c.type, artistA)
    expect(await onSite(c)).toBe(start)
    await writeFlag(asA, c, id, !start, artistA)
    if (c.type === 'video') {
      expect(await onSite(c)).toBe(!start) // live: the flag alone moved it
    } else {
      expect(await onSite(c), 'a draft flip reached the public site without a publish').toBe(start)
      await publishContent(asA, c.type, artistA)
      expect(await onSite(c)).toBe(!start) // published: now it moved
    }
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
// The `reconcileOnSite` block that lived here is gone with the function (PRESENCE_PLAN,
// 2026-09-10): merch is live-toggled now, and the first describe above IS that contract.
