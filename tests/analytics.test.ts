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

describe('per-item attribution (record_event entity + analytics_by_entity)', () => {
  const VIDEO = '11111111-1111-1111-1111-111111111111'
  const MERCH = '22222222-2222-2222-2222-222222222222'

  it('stores entity_id + entity_type and accepts the new video_click type', async () => {
    await anon.rpc('record_event', {
      p_slug: SEED.artistASlug,
      p_type: 'video_click',
      p_target: 'My Video',
      p_entity_id: VIDEO,
      p_entity_type: 'video',
    })
    const { data } = await svc
      .from('analytics_events')
      .select('type, entity_id, entity_type')
      .eq('artist_id', artistA)
      .eq('entity_id', VIDEO)
    expect((data ?? []).some((e) => e.type === 'video_click' && e.entity_type === 'video')).toBe(true)
  })

  it('analytics_by_entity groups counts per (entity, type) for the owner', async () => {
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'buy_click', p_entity_id: MERCH, p_entity_type: 'merch' })
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'buy_click', p_entity_id: MERCH, p_entity_type: 'merch' })

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data } = await asA.rpc('analytics_by_entity', { p_artist_id: artistA, p_since: since })
    const row = ((data ?? []) as { entity_id: string; type: string; count: number }[]).find(
      (r) => r.entity_id === MERCH && r.type === 'buy_click',
    )
    expect(Number(row?.count)).toBeGreaterThanOrEqual(2)
  })

  it('CRITICAL: anon gets zero rows from analytics_by_entity (security invoker + RLS)', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    // The function runs as the caller; anon fails the owner-read RLS on
    // analytics_events, so it returns nothing (never another artist's counts).
    const { data } = await anon.rpc('analytics_by_entity', { p_artist_id: artistA, p_since: since })
    expect((data ?? []).length).toBe(0)
  })

  it('analytics_entity_daily sums daily counts across the given entity ids (owner)', async () => {
    const A = '44444444-4444-4444-4444-444444444444'
    const B = '55555555-5555-5555-5555-555555555555'
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'play', p_entity_id: A, p_entity_type: 'track' })
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'link_click', p_entity_id: B, p_entity_type: 'track' })

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await asA.rpc('analytics_entity_daily', { p_artist_id: artistA, p_entity_ids: [A, B], p_since: since })
    const total = ((data ?? []) as { day: string; count: number }[]).reduce((n, r) => n + Number(r.count), 0)
    expect(total).toBeGreaterThanOrEqual(2) // both entities' events, bucketed by day

    // anon fails RLS → nothing.
    const anonRes = await anon.rpc('analytics_entity_daily', { p_artist_id: artistA, p_entity_ids: [A, B], p_since: since })
    expect((anonRes.data ?? []).length).toBe(0)
  })
})
