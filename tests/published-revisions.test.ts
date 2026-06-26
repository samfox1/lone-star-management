/**
 * The published-state seam: published_revisions(artist, entity_type?) returns the
 * LIVE published view — the latest revision per entity with TOMBSTONES EXCLUDED.
 * The single home for the rule every public door projects over (CONTEXT.md). It's
 * an internal DEFINER helper (not anon-callable); tests use the service role.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, deleteContent, publishContent } from '@/lib/content'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()

type Row = { entity_type: string; entity_id: string; data: Record<string, unknown> }

async function rows(entity_type: string | null): Promise<Row[]> {
  const { data } = await svc.rpc('published_revisions', { p_artist_id: artistA, p_entity_type: entity_type })
  return (data ?? []) as Row[]
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('tracks').delete().eq('artist_id', artistA)
  await svc.from('links').delete().eq('artist_id', artistA)
  await svc.from('revisions').delete().eq('artist_id', artistA).in('entity_type', ['track', 'link'])
})

describe('published_revisions', () => {
  it('CRITICAL: returns the live published state, excluding tombstones', async () => {
    const t = await createContent(asA, 'track', artistA, { title: 'PR live' })
    await publishContent(asA, 'track', artistA)
    expect((await rows('track')).some((r) => r.data.title === 'PR live')).toBe(true)

    // delete the working row + republish → tombstone; it drops out of the live view
    await deleteContent(asA, 'track', t.id)
    await publishContent(asA, 'track', artistA)
    expect((await rows('track')).some((r) => r.entity_id === t.id)).toBe(false)
  })

  it('filters by entity_type; null returns every type', async () => {
    await createContent(asA, 'track', artistA, { title: 'PR t2' })
    await createContent(asA, 'link', artistA, { label: 'PR l', url: 'https://x.example' })
    await publishContent(asA, 'track', artistA)
    await publishContent(asA, 'link', artistA)

    expect((await rows('track')).every((r) => r.entity_type === 'track')).toBe(true)
    const types = new Set((await rows(null)).map((r) => r.entity_type))
    expect(types.has('track')).toBe(true)
    expect(types.has('link')).toBe(true)
  })
})
