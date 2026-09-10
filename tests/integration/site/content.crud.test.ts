// Tour dates, merch and links end to end: owner edits, then the publish loop.
/**
 * MILESTONE 5 — remaining content (tour dates, merch, links), test-first.
 *
 * One generic content layer drives all three types. Each case proves, against the real DB
 * as the seeded manager: owner CRUD, and the publish loop — a new row is DRAFT (absent
 * from the public site however its on-site flag is set) until publish snapshots it into
 * `revisions`, after which it appears under the right key.
 *
 * Non-owner denial is NOT here. rls.isolation.test.ts and content.isolation.test.ts own
 * cross-tenant writes for every type and assert the ROW is untouched; a bare
 * `rejects.toThrow()` here was a weaker restatement of the same rule.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type CrudEntity,
  createContent,
  deleteContent,
  listContent,
  publishContent,
  updateContent,
} from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

type Case = {
  type: CrudEntity
  table: string
  create: Record<string, unknown>
  edit: Record<string, unknown>
  editField: string
  marker: string
  siteKey: 'tour_dates' | 'merch' | 'links'
}

/** The public door's section for one content type. */
async function publicSection(c: Case): Promise<unknown[]> {
  const { data } = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
  return (data as Record<string, unknown[]> | null)?.[c.siteKey] ?? []
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
let asA: SupabaseClient
const svc = serviceClient()

/** Rows this file created, per table — teardown removes ONLY these. Deleting every tour
 *  date / merch item / link for the artist would erase whatever else is in the shared
 *  live project and leave later suites asserting over an empty site. */
const created: { table: string; id: string }[] = []

/** Create a row that this test OWNS. Each `it` makes its own: a fixture shared through a
 *  `let` written by the first test can't be run alone, and its later assertions read a row
 *  an earlier test already renamed. */
async function ownRow(c: Case) {
  const row = await createContent(asA, c.type, artistA, c.create)
  created.push({ table: c.table, id: row.id as string })
  return row
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  if (!created.length) return
  await svc.from('revisions').delete().in('entity_id', created.map((r) => r.id))
  for (const table of new Set(created.map((r) => r.table))) {
    await svc.from(table).delete().in('id', created.filter((r) => r.table === table).map((r) => r.id))
  }
  created.length = 0
})

describe.each(CASES)('content type: $type', (c) => {
  it('creates (owner), scoped to the artist', async () => {
    const row = await ownRow(c)
    expect(row.artist_id).toBe(artistA)
  })

  it('lists including the new row', async () => {
    const row = await ownRow(c)
    const rows = await listContent(asA, c.type, artistA)
    expect(rows.map((r) => r.id)).toContain(row.id)
  })

  it('updates', async () => {
    const row = await ownRow(c)
    const updated = await updateContent(asA, c.type, row.id, c.edit)
    expect(updated[c.editField]).toBe(c.edit[c.editField])
  })

  it('CRITICAL: it is DRAFT until published, then appears under the right key', async () => {
    const row = await ownRow(c)
    // tour_date/merch land off-site on create; put the row on the site so it reaches
    // the public door. Writing the flag directly works for EITHER on-site write path
    // (ADR 0009), so this test doesn't have to track which one a type uses — it once
    // branched on ON_SITE_ENTITIES, which quietly stopped toggling tour dates the day
    // they moved to the live toggle. Links insert on-site already; setting it is a no-op.
    await asA.from(c.table).update({ on_site: true }).eq('id', row.id).eq('artist_id', artistA)

    // The flag decides VISIBILITY; publish decides EXISTENCE. Asserting presence after a
    // publish (as every test here used to) says nothing about a door that serves working
    // rows — an ON-SITE row that was never published must still be absent.
    // By id, not by marker: the markers are substrings of each other's edited variants.
    expect(JSON.stringify(await publicSection(c))).not.toContain(row.id)

    await publishContent(asA, c.type, artistA)
    const section = JSON.stringify(await publicSection(c))
    expect(section).toContain(row.id)
    expect(section).toContain(c.marker)
  })

  it('deletes', async () => {
    const row = await ownRow(c)
    await deleteContent(asA, c.type, row.id)
    const rows = await listContent(asA, c.type, artistA)
    expect(rows.map((r) => r.id)).not.toContain(row.id)
  })
})
