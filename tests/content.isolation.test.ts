/**
 * MILESTONE 5 — write-isolation gate for ALL content types + publish-all.
 *
 * README's #1 priority: a manager can never WRITE another tenant's data. The
 * per-type CRUD test only covered non-owner CREATE; this covers non-owner
 * UPDATE and DELETE for every content type (the generic update/delete filter by
 * id alone, so RLS is the sole guard and must be proven for each table). Also
 * covers publishAll(), which is what the dashboard Publish button calls.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type CrudEntity,
  createContent,
  deleteContent,
  publishAll,
  reconcileOnSite,
  updateContent,
} from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'
import { deleteAddedSince, snapshotIds } from './helpers/rls'

type DenyCase = {
  type: CrudEntity
  table: string
  bRow: Record<string, unknown>
  edit: Record<string, unknown>
  identCol: string
  identVal: string
}

const DENY: DenyCase[] = [
  { type: 'track', table: 'tracks', bRow: { title: 'ISO-B track' }, edit: { title: 'hacked' }, identCol: 'title', identVal: 'ISO-B track' },
  { type: 'tour_date', table: 'tour_dates', bRow: { date: '2026-01-01', venue: 'ISO-B venue' }, edit: { venue: 'hacked' }, identCol: 'venue', identVal: 'ISO-B venue' },
  { type: 'merch', table: 'merch', bRow: { title: 'ISO-B merch' }, edit: { title: 'hacked' }, identCol: 'title', identVal: 'ISO-B merch' },
  { type: 'link', table: 'links', bRow: { label: 'ISO-B link', url: 'https://b.example' }, edit: { label: 'hacked' }, identCol: 'label', identVal: 'ISO-B link' },
]

let artistA: string
let artistB: string
let asA: SupabaseClient
const bRowIds: Record<string, string> = {}
const aCreatedIds: { table: string; id: string }[] = []
const svc = serviceClient()
/** Revisions that already existed for A, so teardown removes only the ones we publish. */
let revisionsBefore: Set<string | number> | undefined

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  revisionsBefore = await snapshotIds(svc, 'revisions', { artist_id: artistA })

  for (const c of DENY) {
    const { data, error } = await svc
      .from(c.table)
      .insert({ ...c.bRow, artist_id: artistB })
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error(`seed B ${c.type} failed`)
    bRowIds[c.type] = data.id
  }
})

afterAll(async () => {
  // Scoped to what this file created. The old teardown deleted EVERY track, tour date,
  // merch item and link belonging to artist A, plus all four kinds of A's revisions —
  // on the shared live project that wipes another suite's fixtures mid-run and leaves
  // later denials with nothing to deny.
  await deleteAddedSince(svc, 'revisions', { artist_id: artistA }, revisionsBefore)
  for (const c of DENY) {
    if (bRowIds[c.type]) await svc.from(c.table).delete().eq('id', bRowIds[c.type])
  }
  for (const { table, id } of aCreatedIds) {
    await svc.from(table).delete().eq('id', id)
  }
})

describe.each(DENY)('write isolation: $type', (c) => {
  it("CRITICAL: manager A cannot UPDATE B's row", async () => {
    // RLS hides B's row, so the update matches nothing and .single() rejects.
    await expect(updateContent(asA, c.type, bRowIds[c.type], c.edit)).rejects.toThrow()
    // And the row is genuinely unchanged.
    const { data } = await svc.from(c.table).select(c.identCol).eq('id', bRowIds[c.type]).single()
    expect((data as unknown as Record<string, unknown>)[c.identCol]).toBe(c.identVal)
  })

  it("CRITICAL: manager A cannot DELETE B's row", async () => {
    // RLS hides the row → delete is a silent no-op (matches nothing).
    await deleteContent(asA, c.type, bRowIds[c.type])
    const { count } = await svc
      .from(c.table)
      .select('id', { count: 'exact', head: true })
      .eq('id', bRowIds[c.type])
    expect(count).toBe(1) // still there
  })
})

describe('publishAll', () => {
  it('publishes every content type in one call; all appear on the public read path', async () => {
    const markers = {
      track: 'ISO-A pub track',
      tour_date: 'ISO-A pub venue',
      merch: 'ISO-A pub merch',
      link: 'ISO-A pub link',
    }
    const created = [
      // stream_url = platform presence: the doors expose RELEASED music only, and
      // a bare manual track is Unreleased (dashboard-only). See lib/music.ts.
      await createContent(asA, 'track', artistA, { title: markers.track, stream_url: 'https://open.spotify.com/track/iso' }),
      await createContent(asA, 'tour_date', artistA, { date: '2026-05-05', venue: markers.tour_date }),
      await createContent(asA, 'merch', artistA, { title: markers.merch, price: 10 }),
      await createContent(asA, 'link', artistA, { label: markers.link, url: 'https://a.example' }),
    ]
    const tables = ['tracks', 'tour_dates', 'merch', 'links']
    created.forEach((row, i) => aCreatedIds.push({ table: tables[i], id: row.id }))

    const count = await publishAll(asA, artistA)
    expect(count).toBeGreaterThanOrEqual(4)

    // tour_date + merch land off-site on create (on_site=false); put them on the site
    // so they reach the public door. (track + link have no visibility gate.) The two
    // use different write paths — tour_date is live-toggled, merch is publish-
    // reconciled (ADR 0009) — and both are RLS-scoped to A either way.
    await asA.from('tour_dates').update({ on_site: true }).eq('id', created[1].id).eq('artist_id', artistA)
    await reconcileOnSite(asA, 'merch', artistA, [created[2].id])

    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const blob = JSON.stringify(data)
    for (const marker of Object.values(markers)) {
      expect(blob).toContain(marker)
    }
  })
})
