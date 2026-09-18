// The one place that says what is live: latest revision per entity, tombstones excluded.
/**
 * The published-state seam: published_revisions(artist, entity_type?) returns the
 * LIVE published view — the latest revision per entity with TOMBSTONES EXCLUDED.
 * The single home for the rule every public door projects over (CONTEXT.md). It's
 * an internal DEFINER helper (not anon-callable); tests use the service role.
 *
 * WHY THE ARTIST IS A THROWAWAY (AGENTS.md rule 6). The row bookkeeping here was already
 * tidy — every track and link is deleted by the id it was created with. The defect was the
 * other one: `publishContent` is CATALOG-WIDE. Called against the shared seed artist it
 * snapshots every pending draft that artist has, so a run committed a human's half-finished
 * song to their live site as a side effect of testing a read helper, and did it four times.
 * No id list can scope that, because the rows it publishes are the ones this file never
 * touched. An artist this file owns has nothing pending but its own fixtures.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, publishContent } from '@/lib/content'
import { SEED, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let tenantA: ThrowawayArtist
let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

type Row = { entity_type: string; entity_id: string; data: Record<string, unknown> }

async function rows(entity_type: string | null): Promise<Row[]> {
  const { data } = await svc.rpc('published_revisions', { p_artist_id: artistA, p_entity_type: entity_type })
  return (data ?? []) as Row[]
}

async function seed(type: 'track' | 'link', input: Record<string, unknown>) {
  return createContent(asA, type, artistA, input)
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  tenantA = await createThrowawayArtist(svc, 'Published revisions', asA)
  artistA = tenantA.id
})

afterAll(async () => {
  // One cascading delete: the tracks, the links and every revision published off them.
  await deleteThrowawayArtist(svc, tenantA)
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
