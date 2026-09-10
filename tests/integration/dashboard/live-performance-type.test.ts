// Live performance as a sixth song type, with its own section but the same plumbing.
/**
 * LIVE PERFORMANCE — a sixth song type (Sam, 2026-08-21: "recordings of artists live
 * performance", "its own section in the music assets but embeded in the sites just like
 * the other music").
 *
 * So it is a `release_type`, not a new column: it gets its own Music-page section for
 * free (the sections ARE RELEASE_TYPES) and reaches a connected site through the same
 * wire field every other type uses. This pins both halves — the app registry and the DB
 * CHECK that has to accept it — because the two are hand-kept in sync and the CHECK is
 * the half that fails silently in the UI ("Failed to save") rather than at build time.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, toReleaseType, type ReleaseType } from '@/lib/releases'
import { SEED, artistIdBySlug, serviceClient } from '@tests/helpers/supabase'

const svc = serviceClient()
const MARK = 'live-type-test'

afterAll(async () => {
  // Scoped to the rows this file planted, by title marker — never "everything for the
  // seed artist" (AGENTS.md rule 6).
  await svc.from('tracks').delete().eq('title', MARK)
  await svc.from('releases').delete().eq('title', MARK)
})

describe('the live-performance type', () => {
  it('is in the registry and carries a label', () => {
    expect(RELEASE_TYPES).toContain('live')
    expect(RELEASE_TYPE_LABEL.live).toBe('Live')
  })

  it('survives coercion instead of collapsing to the single default', () => {
    expect(toReleaseType('live')).toBe('live')
    // The guard still bites: an unknown tag is still 'single'.
    expect(toReleaseType('bootleg')).toBe('single')
  })

  it('the label map stays TOTAL over the registry (a new type without a label is a build error)', () => {
    // Derived from the registry, never hand-listed — a future type is covered here the
    // day it is added (AGENTS.md rule 4).
    for (const t of RELEASE_TYPES) expect(RELEASE_TYPE_LABEL[t as ReleaseType]).toBeTruthy()
  })

  it("the DB CHECK on tracks accepts 'live'", async () => {
    const artist = await artistIdBySlug(SEED.artistASlug)
    const { data, error } = await svc
      .from('tracks')
      .insert({ artist_id: artist, title: MARK, release_type: 'live' })
      .select('id, release_type')
      .single()
    expect(error).toBeNull()
    expect(data?.release_type).toBe('live')
  })

  it("the DB CHECK on releases accepts 'live'", async () => {
    const artist = await artistIdBySlug(SEED.artistASlug)
    const { data, error } = await svc
      .from('releases')
      .insert({ artist_id: artist, title: MARK, slug: `${MARK}-${'x'}`, release_type: 'live' })
      .select('id, release_type')
      .single()
    expect(error).toBeNull()
    expect(data?.release_type).toBe('live')
  })

  it('the CHECK is still a CHECK — a junk type is rejected, not stored', async () => {
    const artist = await artistIdBySlug(SEED.artistASlug)
    const { error } = await svc
      .from('tracks')
      .insert({ artist_id: artist, title: MARK, release_type: 'bootleg' })
    expect(error?.code).toBe('23514') // check_violation
  })
})
