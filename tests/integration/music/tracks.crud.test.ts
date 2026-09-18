// Songs end to end against the real database: edit, publish, read publicly, with RLS in play.
/**
 * MILESTONE 3 — Tracks end to end (CRUD + publish), test-first.
 *
 * Exercises the generic content layer at `type: 'track'` as the seeded managers,
 * against the real DB, so RLS is part of the test. It used to go through
 * `src/lib/tracks.ts`, a typed facade the application itself never called — so this
 * suite was the only thing keeping it alive, and it proved the facade rather than the
 * code that actually runs. The facade is deleted; the loop below is unchanged.
 *
 * Proves the full loop: a manager edits working rows, publishes a snapshot into
 * `revisions`, and the published track then appears through the public read path
 * (get_public_site) — while a non-owner is denied at every step.
 *
 * Test files run in parallel against one shared DB, so every fixture here uses
 * a unique title and is created/cleaned by explicit id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createContent,
  deleteContent,
  listContent,
  publishContent,
  updateContent,
} from '@/lib/content'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient

const createdTrackIds: string[] = []
const createdRevisionIds: string[] = []
const TITLE = 'M3 CRUD fixture track'
const PUBLISH_TITLE = 'M3 publish-loop track'
const svc = serviceClient()

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  if (createdRevisionIds.length)
    await svc.from('revisions').delete().in('id', createdRevisionIds)
  if (createdTrackIds.length)
    await svc.from('tracks').delete().in('id', createdTrackIds)
  // Belt-and-suspenders title sweep for anything not captured. SCOPED TO artistA: this
  // runs as the service role against the shared live database, so an unscoped title
  // delete would reach into other artists' (and other suites') rows.
  await svc
    .from('tracks')
    .delete()
    .eq('artist_id', artistA)
    .in('title', [TITLE, TITLE + ' (edited)', PUBLISH_TITLE])
})

describe('tracks CRUD (owner)', () => {
  let trackId: string

  it('creates a track scoped to the artist, source defaults to manual', async () => {
    const track = await createContent(asA, 'track', artistA, { title: TITLE })
    trackId = track.id
    createdTrackIds.push(track.id)
    expect(track.title).toBe(TITLE)
    expect(track.artist_id).toBe(artistA)
    expect(track.source).toBe('manual')
  })

  it('lists the artist tracks including the new one', async () => {
    const tracks = await listContent(asA, 'track', artistA)
    expect(tracks.map((t) => t.id)).toContain(trackId)
  })

  it('updates a track', async () => {
    const updated = await updateContent(asA, 'track', trackId, { title: TITLE + ' (edited)' })
    expect(updated.title).toBe(TITLE + ' (edited)')
  })

  it('deletes a track', async () => {
    const created = await createContent(asA, 'track', artistA, { title: 'M3 delete-me' })
    await deleteContent(asA, 'track', created.id)
    const after = await listContent(asA, 'track', artistA)
    expect(after.map((t) => t.id)).not.toContain(created.id)
  })
})

describe('tracks isolation (non-owner denied)', () => {
  it('CRITICAL: manager A cannot create a track for artist B', async () => {
    await expect(createContent(asA, 'track', artistB, { title: 'should-fail' })).rejects.toThrow()
  })

  it('CRITICAL: manager A cannot insert a revision (publish) for artist B', async () => {
    const { error } = await asA
      .from('revisions')
      .insert({ artist_id: artistB, entity_type: 'track', entity_id: artistB, data: {} })
      .select()
    expect(error).not.toBeNull()
  })

  // 0 because RLS hides artist B's tracks from manager A, so publishContent has nothing
  // to snapshot. It is NOT an on_site filter — publishContent snapshots every working
  // row regardless of on_site. The old name ("no on-site tracks") described a filter
  // that has never existed, and would keep passing if RLS were removed tomorrow.
  it('publishing artist B as manager A is a no-op (RLS hides B rows — nothing to snapshot)', async () => {
    const count = await publishContent(asA, 'track', artistB)
    expect(count).toBe(0)
  })
})

describe('publish loop (draft -> publish -> public read)', () => {
  it('CRITICAL: publishing snapshots tracks into revisions, then they appear via the public read path', async () => {
    // A default on-site track: on the public site once published (the site gates
    // tracks on `on_site`, not Released — see 20260710170000).
    const track = await createContent(asA, 'track', artistA, { title: PUBLISH_TITLE, stream_url: 'https://open.spotify.com/track/pub' })
    createdTrackIds.push(track.id)

    // Before publishing, the working row must NOT be on the public site.
    const before = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    expect(JSON.stringify(before.data)).not.toContain(PUBLISH_TITLE)

    // Snapshot existing revisions so we can clean up EVERYTHING this publish
    // creates (it snapshots all of the artist's working tracks, not just ours).
    const { data: existingRevs } = await svc
      .from('revisions')
      .select('id')
      .eq('artist_id', artistA)
    const beforeIds = new Set((existingRevs ?? []).map((r) => r.id))

    const count = await publishContent(asA, 'track', artistA)
    expect(count).toBeGreaterThanOrEqual(1)

    const { data: afterRevs } = await svc
      .from('revisions')
      .select('id')
      .eq('artist_id', artistA)
    ;(afterRevs ?? [])
      .filter((r) => !beforeIds.has(r.id))
      .forEach((r) => createdRevisionIds.push(r.id))

    // After publishing, the public read path serves it.
    const after = await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })
    expect(JSON.stringify(after.data)).toContain(PUBLISH_TITLE)
  })
})
