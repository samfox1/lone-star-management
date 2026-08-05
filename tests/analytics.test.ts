/**
 * PHASE 5 (Analytics) — record_event behavior: resolves the artist from the slug,
 * stores a typed event (+ optional target, no PII), and ignores junk (unknown
 * type or unknown slug) rather than erroring.
 *
 * EXACT counts, not `>=`. Every test here owns its rows via a unique `p_target`
 * (or a unique entity id), so the assertion is `toBe(n)`. The `>=` this file used
 * to carry could not fail: it passed whether record_event inserted one row or ten,
 * so a door that DOUBLE-COUNTED every event — the plausible regression, since the
 * insert sits behind a burst cap and a type/slug guard that a rewrite has to
 * re-thread — would have shipped green.
 *
 * `analytics_summary` groups by type with no target filter, so it can't be scoped
 * that way; it is scoped by TIME instead, from the DB's own clock (`sinceAfter`) —
 * never `Date.now()`, which is a different clock than the one stamping created_at.
 *
 * Teardown removes only the targets and entity ids this file created. It used to
 * delete every analytics event for artist A, which destroys real history and other
 * suites' fixtures on the shared hosted project.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let asA: SupabaseClient
const svc = serviceClient()
const anon = anonClient()

/** Every target / entity id this file caused to exist. Nothing else is deleted. */
const targets: string[] = []
const entities: string[] = []

/** A target string no other test (or real visitor) can collide with. */
function ownTarget(name: string): string {
  const t = `test-${name}-${crypto.randomUUID()}`
  targets.push(t)
  return t
}

function ownEntity(): string {
  const id = crypto.randomUUID()
  entities.push(id)
  return id
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  if (targets.length) await svc.from('analytics_events').delete().in('target', targets)
  if (entities.length) await svc.from('analytics_events').delete().in('entity_id', entities)
})

/** Rows carrying one of this file's targets — i.e. rows the calling test owns. */
async function rowsFor(target: string): Promise<{ type: string; target: string | null }[]> {
  const { data } = await svc.from('analytics_events').select('type, target').eq('target', target)
  return data ?? []
}

/**
 * The created_at of the row that target owns — the DB's own clock, used as the
 * `p_since` boundary. A client-side `new Date()` is a different clock: any skew
 * either drops the test's own rows out of the window or lets earlier ones in.
 */
async function sinceAfter(target: string): Promise<string> {
  const { data } = await svc
    .from('analytics_events')
    .select('created_at')
    .eq('target', target)
    .order('created_at')
    .limit(1)
    .single()
  return data!.created_at as string
}

describe('record_event', () => {
  it('records exactly one typed event with its target', async () => {
    const target = ownTarget('link')
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'link_click', p_target: target })
    // Exactly one: a door that inserted twice would still satisfy `some(...)`.
    expect(await rowsFor(target)).toEqual([{ type: 'link_click', target }])
  })

  it('ignores an unknown event type (no row, no error)', async () => {
    const target = ownTarget('badtype')
    const { error } = await anon.rpc('record_event', {
      p_slug: SEED.artistASlug,
      p_type: 'definitely_not_a_type',
      p_target: target,
    })
    expect(error).toBeNull()
    expect(await rowsFor(target)).toEqual([])
  })

  it('ignores an unknown slug (records nothing, for any artist)', async () => {
    const target = ownTarget('badslug')
    await anon.rpc('record_event', { p_slug: 'no-such-artist-slug', p_type: 'view', p_target: target })
    // Unscoped by artist: an unknown slug must not land the row on SOME other artist.
    expect(await rowsFor(target)).toEqual([])
  })

  it('analytics_summary returns exact owner-read counts grouped by type', async () => {
    const target = ownTarget('summary')
    // The first event is also the window boundary, so the window holds this test's
    // rows and nothing earlier.
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'view', p_target: target })
    const since = await sinceAfter(target)
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'view', p_target: target })
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'play', p_target: target })

    const { data } = await asA.rpc('analytics_summary', { p_artist_id: artistA, p_since: since })
    const counts = Object.fromEntries(
      ((data ?? []) as { type: string; count: number }[]).map((r) => [r.type, Number(r.count)]),
    )
    expect(counts.view).toBe(2)
    expect(counts.play).toBe(1)
  })
})

describe('per-item attribution (record_event entity + analytics_by_entity)', () => {
  it('stores entity_id + entity_type exactly once and accepts the new video_click type', async () => {
    const video = ownEntity()
    await anon.rpc('record_event', {
      p_slug: SEED.artistASlug,
      p_type: 'video_click',
      p_target: ownTarget('video'),
      p_entity_id: video,
      p_entity_type: 'video',
    })
    const { data } = await svc
      .from('analytics_events')
      .select('type, entity_id, entity_type')
      .eq('artist_id', artistA)
      .eq('entity_id', video)
    expect(data).toEqual([{ type: 'video_click', entity_id: video, entity_type: 'video' }])
  })

  it('analytics_by_entity groups exact counts per (entity, type) for the owner', async () => {
    const merch = ownEntity()
    const target = ownTarget('merch')
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'buy_click', p_target: target, p_entity_id: merch, p_entity_type: 'merch' })
    const since = await sinceAfter(target)
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'buy_click', p_target: target, p_entity_id: merch, p_entity_type: 'merch' })

    const { data } = await asA.rpc('analytics_by_entity', { p_artist_id: artistA, p_since: since })
    const rows = ((data ?? []) as { entity_id: string; type: string; count: number }[]).filter(
      (r) => r.entity_id === merch,
    )
    // One row, one type, exactly two events — a double-counting insert reads as 4.
    expect(rows.map((r) => ({ type: r.type, count: Number(r.count) }))).toEqual([{ type: 'buy_click', count: 2 }])
  })

  it('CRITICAL: anon gets zero rows from analytics_by_entity (security invoker + RLS)', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    // The function runs as the caller; anon fails the owner-read RLS on
    // analytics_events, so it returns nothing (never another artist's counts).
    const { data } = await anon.rpc('analytics_by_entity', { p_artist_id: artistA, p_since: since })
    expect((data ?? []).length).toBe(0)
  })

  it('analytics_entity_daily sums exactly the given entity ids (owner)', async () => {
    const a = ownEntity()
    const b = ownEntity()
    const other = ownEntity()
    const target = ownTarget('daily')
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'play', p_target: target, p_entity_id: a, p_entity_type: 'track' })
    const since = await sinceAfter(target)
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'link_click', p_target: target, p_entity_id: b, p_entity_type: 'track' })
    // Not in p_entity_ids: pins that the filter narrows, so a dropped WHERE reads as 3.
    await anon.rpc('record_event', { p_slug: SEED.artistASlug, p_type: 'play', p_target: target, p_entity_id: other, p_entity_type: 'track' })

    const { data } = await asA.rpc('analytics_entity_daily', { p_artist_id: artistA, p_entity_ids: [a, b], p_since: since })
    const total = ((data ?? []) as { day: string; count: number }[]).reduce((n, r) => n + Number(r.count), 0)
    expect(total).toBe(2)

    // anon fails RLS → nothing.
    const anonRes = await anon.rpc('analytics_entity_daily', { p_artist_id: artistA, p_entity_ids: [a, b], p_since: since })
    expect((anonRes.data ?? []).length).toBe(0)
  })
})
