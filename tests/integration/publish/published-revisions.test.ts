/**
 * The published-state seam: published_revisions(artist, entity_type?) returns the
 * LIVE published view — the latest revision per entity with TOMBSTONES EXCLUDED.
 * The single home for the rule every public door projects over (CONTEXT.md). It's
 * an internal DEFINER helper (not anon-callable); tests use the service role.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, publishContent } from '@/lib/content'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

type Row = { entity_type: string; entity_id: string; data: Record<string, unknown> }

async function rows(entity_type: string | null): Promise<Row[]> {
  const { data } = await svc.rpc('published_revisions', { p_artist_id: artistA, p_entity_type: entity_type })
  return (data ?? []) as Row[]
}

/** Rows this file created, per table — teardown removes ONLY these. The project is shared
 *  and live: deleting every track and link for the artist erases whatever else is in
 *  there and leaves later suites asserting over an empty site. */
const created: { table: string; id: string }[] = []

async function seed(type: 'track' | 'link', input: Record<string, unknown>) {
  const row = await createContent(asA, type, artistA, input)
  created.push({ table: type === 'track' ? 'tracks' : 'links', id: row.id })
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

describe('published_revisions', () => {
  it('CRITICAL: returns the live published state, excluding tombstones', async () => {
    const t = await seed('track', { title: 'PR live' })
    await publishContent(asA, 'track', artistA)
    expect((await rows('track')).some((r) => r.data.title === 'PR live')).toBe(true)

    // delete the working row + republish → tombstone; it drops out of the live view
    await deleteContent(asA, 'track', t.id)
    await publishContent(asA, 'track', artistA)
    expect((await rows('track')).some((r) => r.entity_id === t.id)).toBe(false)
  })

  it('filters by entity_type; null returns every type', async () => {
    const track = await seed('track', { title: 'PR t2' })
    const link = await seed('link', { label: 'PR l', url: 'https://x.example' })
    await publishContent(asA, 'track', artistA)
    await publishContent(asA, 'link', artistA)

    // Presence FIRST: `every` over an empty result is true, so a filter that returned
    // nothing at all — the failure mode that matters for a read the doors project over —
    // would satisfy the type check below on its own.
    const trackRows = await rows('track')
    expect(trackRows.map((r) => r.entity_id)).toContain(track.id)
    expect(trackRows.map((r) => r.entity_id)).not.toContain(link.id)
    expect(trackRows.every((r) => r.entity_type === 'track')).toBe(true)

    const all = await rows(null)
    expect(all.map((r) => r.entity_id)).toEqual(expect.arrayContaining([track.id, link.id]))
  })
})
