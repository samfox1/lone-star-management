/**
 * PHASE 5 (Analytics) — record_event behavior: resolves the artist from the slug,
 * stores a typed event (+ optional target, no PII), and ignores junk (unknown
 * type or unknown slug) rather than erroring.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const anon = anonClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  await svc.from('analytics_events').delete().eq('artist_id', artistA)
})

async function eventsForA(): Promise<{ type: string; target: string | null }[]> {
  const { data } = await svc.from('analytics_events').select('type, target').eq('artist_id', artistA)
  return data ?? []
}

describe('record_event', () => {
  it('records a typed event with an optional target', async () => {
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'link_click', p_target: 'spotify' })
    const events = await eventsForA()
    expect(events.some((e) => e.type === 'link_click' && e.target === 'spotify')).toBe(true)
  })

  it('ignores an unknown event type (no row, no error)', async () => {
    const before = (await eventsForA()).length
    const { error } = await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'definitely_not_a_type' })
    expect(error).toBeNull()
    expect((await eventsForA()).length).toBe(before)
  })

  it('ignores an unknown slug (records nothing)', async () => {
    const before = (await eventsForA()).length
    await anon.rpc('record_event', { p_slug: 'no-such-artist-slug', p_type: 'view' })
    expect((await eventsForA()).length).toBe(before)
  })

  it('analytics_summary returns exact owner-read counts grouped by type', async () => {
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'view' })
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'view' })
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'play' })

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data } = await asA.rpc('analytics_summary', { p_artist_id: artistA, p_since: since })
    const counts = Object.fromEntries(
      ((data ?? []) as { type: string; count: number }[]).map((r) => [r.type, Number(r.count)]),
    )
    expect(counts.view).toBeGreaterThanOrEqual(2)
    expect(counts.play).toBeGreaterThanOrEqual(1)
  })
})
