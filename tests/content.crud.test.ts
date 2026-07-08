/**
 * MILESTONE 5 — remaining content (tour dates, merch, links), test-first.
 *
 * One generic content layer drives all three types. Each case proves, against
 * the real DB as the seeded managers: owner CRUD, non-owner denial, and the
 * publish loop (snapshot -> revisions -> appears via the public read path under
 * the right key).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type CrudEntity,
  type VisibleEntity,
  VISIBLE_ENTITIES,
  createContent,
  deleteContent,
  listContent,
  publishContent,
  reconcileVisibility,
  updateContent,
} from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

type Case = {
  type: CrudEntity
  table: string
  create: Record<string, unknown>
  edit: Record<string, unknown>
  editField: string
  marker: string
  siteKey: 'tour_dates' | 'merch' | 'links'
}

const CASES: Case[] = [
  {
    type: 'tour_date',
    table: 'tour_dates',
    create: { date: '2026-09-01', venue: 'M5 Venue', city: 'Austin' },
    edit: { venue: 'M5 Venue edited' },
    editField: 'venue',
    marker: 'M5 Venue',
    siteKey: 'tour_dates',
  },
  {
    type: 'merch',
    table: 'merch',
    create: { title: 'M5 Tee', price: 25 },
    edit: { title: 'M5 Tee edited' },
    editField: 'title',
    marker: 'M5 Tee',
    siteKey: 'merch',
  },
  {
    type: 'link',
    table: 'links',
    create: { label: 'M5 Link', url: 'https://example.com' },
    edit: { label: 'M5 Link edited' },
    editField: 'label',
    marker: 'M5 Link',
    siteKey: 'links',
  },
]

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  // Sequential test files + seed has no content, so all of A's revisions are
  // ours. Wipe them plus the working rows we created.
  // Scope to content types — never delete the profile/media snapshots that keep
  // the artist's public site "live".
  await svc.from('revisions').delete().eq('artist_id', artistA)
    .in('entity_type', ['track', 'tour_date', 'merch', 'link'])
  for (const c of CASES) {
    await svc.from(c.table).delete().eq('artist_id', artistA)
  }
})

describe.each(CASES)('content type: $type', (c) => {
  let id: string

  it('creates (owner), scoped to the artist', async () => {
    const row = await createContent(asA, c.type, artistA, c.create)
    id = row.id as string
    expect(row.artist_id).toBe(artistA)
  })

  it('lists including the new row', async () => {
    const rows = await listContent(asA, c.type, artistA)
    expect(rows.map((r) => r.id)).toContain(id)
  })

  it('updates', async () => {
    const updated = await updateContent(asA, c.type, id, c.edit)
    expect(updated[c.editField]).toBe(c.edit[c.editField])
  })

  it('CRITICAL: non-owner cannot create for artist B', async () => {
    await expect(createContent(asA, c.type, artistB, c.create)).rejects.toThrow()
  })

  it('CRITICAL: publishing makes it appear on the public read path under the right key', async () => {
    await publishContent(asA, c.type, artistA)
    // Visible-gated types (tour_date/merch) land off-site on create; toggle on-site
    // so they reach the public door (links have no visibility gate).
    if ((VISIBLE_ENTITIES as readonly string[]).includes(c.type)) {
      await reconcileVisibility(asA, c.type as VisibleEntity, artistA, [id])
    }
    const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    const section = (data as Record<string, unknown[]>)[c.siteKey]
    expect(JSON.stringify(section)).toContain(c.marker)
  })

  it('deletes', async () => {
    await deleteContent(asA, c.type, id)
    const rows = await listContent(asA, c.type, artistA)
    expect(rows.map((r) => r.id)).not.toContain(id)
  })
})
