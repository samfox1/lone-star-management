/**
 * MILESTONE 3 — Tracks end to end (CRUD + publish), test-first.
 *
 * Exercises src/lib/tracks.ts as the seeded managers, against the real DB, so
 * RLS is part of the test. Proves the full loop: a manager edits working rows,
 * publishes a snapshot into `revisions`, and the published track then appears
 * through the public read path (get_public_site) — while a non-owner is denied
 * at every step.
 *
 * Test files run in parallel against one shared DB, so every fixture here uses
 * a unique title and is created/cleaned by explicit id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createTrack,
  deleteTrack,
  listTracks,
  publishTracks,
  updateTrack,
} from '@/lib/tracks'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

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
  // Belt-and-suspenders title sweep for anything not captured.
  await svc.from('tracks').delete().in('title', [TITLE, TITLE + ' (edited)', PUBLISH_TITLE])
})

describe('tracks CRUD (owner)', () => {
  let trackId: string

  it('creates a track scoped to the artist, source defaults to manual', async () => {
    const track = await createTrack(asA, artistA, { title: TITLE })
    trackId = track.id
    createdTrackIds.push(track.id)
    expect(track.title).toBe(TITLE)
    expect(track.artist_id).toBe(artistA)
    expect(track.source).toBe('manual')
  })

  it('lists the artist tracks including the new one', async () => {
    const tracks = await listTracks(asA, artistA)
    expect(tracks.map((t) => t.id)).toContain(trackId)
  })

  it('updates a track', async () => {
    const updated = await updateTrack(asA, trackId, { title: TITLE + ' (edited)' })
    expect(updated.title).toBe(TITLE + ' (edited)')
  })

  it('deletes a track', async () => {
    const created = await createTrack(asA, artistA, { title: 'M3 delete-me' })
    await deleteTrack(asA, created.id)
    const after = await listTracks(asA, artistA)
    expect(after.map((t) => t.id)).not.toContain(created.id)
  })
})

describe('tracks isolation (non-owner denied)', () => {
  it('CRITICAL: manager A cannot create a track for artist B', async () => {
    await expect(createTrack(asA, artistB, { title: 'should-fail' })).rejects.toThrow()
  })

  it('CRITICAL: manager A cannot insert a revision (publish) for artist B', async () => {
    const { error } = await asA
      .from('revisions')
      .insert({ artist_id: artistB, entity_type: 'track', entity_id: artistB, data: {} })
      .select()
    expect(error).not.toBeNull()
  })

  it('publishing artist B as manager A is a no-op (no visible tracks)', async () => {
    const count = await publishTracks(asA, artistB)
    expect(count).toBe(0)
  })
})

describe('publish loop (draft -> publish -> public read)', () => {
  it('CRITICAL: publishing snapshots tracks into revisions, then they appear via the public read path', async () => {
    // stream_url = platform presence, so the track is Released (public-door visible).
    const track = await createTrack(asA, artistA, { title: PUBLISH_TITLE, stream_url: 'https://open.spotify.com/track/pub' })
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

    const count = await publishTracks(asA, artistA)
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
