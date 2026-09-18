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
 * TENANCY, AND WHY THE ARTISTS ARE THROWAWAYS. This file used to run on the shared seed
 * artists. Its TRACK deletes were id- and title-scoped, which was fine; the REVISION
 * bookkeeping was not. `publishContent` snapshots every working track the artist has, so
 * the file recorded every revision that publish produced and deleted them all in
 * teardown — the artist's own songs' snapshots included, which quietly UNPUBLISHED them
 * on the live project. Running this suite also committed whatever unrelated track draft
 * happened to be pending.
 *
 * The B-side denial was worse. "Publishing artist B as manager A is a no-op" asserted a
 * count of 0, and `gulf-static` has no tracks — so the zero was true before RLS was ever
 * consulted, and teardowns elsewhere kept it that way. B now carries a PLANTED track, so
 * the zero means "RLS hid a row that is really there" (AGENTS.md rule 2).
 *
 * `lone-pine` currently reads empty for several tables because teardowns of this shape
 * have been running for months, which is exactly why an absolute count over a seed artist
 * cannot be trusted. Both artists are created and dropped by this file now: the counts
 * below are exact, and the revision sweep is the artist row itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createContent,
  deleteContent,
  listContent,
  publishContent,
  publishProfile,
  updateContent,
} from '@/lib/content'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectRlsDenied } from '@tests/helpers/rls'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

let a: ThrowawayArtist
let b: ThrowawayArtist
let artistA: string
let artistB: string
let asA: SupabaseClient
/** B's own song — the witness the "publish is a no-op" denial is measured against. */
let bTrackId: string

const TITLE = 'M3 CRUD fixture track'
const PUBLISH_TITLE = 'M3 publish-loop track'
const svc = serviceClient()

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  const asB = await signInAs(SEED.managerB)
  a = await createThrowawayArtist(svc, 'tracks crud A', asA)
  b = await createThrowawayArtist(svc, 'tracks crud B', asB)
  artistA = a.id
  artistB = b.id
  // get_public_site answers null until the profile singleton has been published once.
  await publishProfile(asA, artistA)

  const { data: planted, error } = await svc
    .from('tracks')
    .insert({ artist_id: artistB, title: "B's own song", source: 'manual' })
    .select('id')
    .single<{ id: string }>()
  if (error || !planted) throw error ?? new Error('planting the B witness failed')
  bTrackId = planted.id
})

afterAll(async () => {
  // Cascades tracks and revisions alike. The old teardown deleted revisions BY ID from a
  // list that also held other songs' snapshots; this one cannot reach outside the file.
  await deleteThrowawayArtist(svc, a)
  await deleteThrowawayArtist(svc, b)
})

describe('tracks CRUD (owner)', () => {
  let trackId: string

  it('creates a track scoped to the artist, source defaults to manual', async () => {
    const track = await createContent(asA, 'track', artistA, { title: TITLE })
    trackId = track.id
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
    // Postgres must be the thing refusing — a bare .toThrow() also passes on a helper
    // that crashed before it ever reached the insert, which proves nothing about the door.
    await expect(createContent(asA, 'track', artistB, { title: 'should-fail' })).rejects.toThrow(
      /row-level security/i,
    )
  })

  it('CRITICAL: manager A cannot insert a revision (publish) for artist B', async () => {
    const { error } = await asA
      .from('revisions')
      .insert({ artist_id: artistB, entity_type: 'track', entity_id: artistB, data: {} })
      .select()
    // Not `not.toBeNull()`: that is satisfied by a renamed column or a constraint
    // violation just as well as by the denial (see @tests/helpers/rls).
    expectRlsDenied(error, "A inserting a revision for B")
  })

  // 0 because RLS hides artist B's tracks from manager A, so publishContent has nothing
  // to snapshot. It is NOT an on_site filter — publishContent snapshots every working
  // row regardless of on_site. The old name ("no on-site tracks") described a filter
  // that has never existed, and would keep passing if RLS were removed tomorrow.
  it('publishing artist B as manager A is a no-op (RLS hides B rows — nothing to snapshot)', async () => {
    // THE PLANTED WITNESS (AGENTS.md rule 2). Zero is only evidence if there was
    // something to count: prove B's song is really there, as the service role, first.
    const { data: witness } = await svc.from('tracks').select('id').eq('artist_id', artistB)
    expect(witness, 'B must own a track, or the zero below is free').toHaveLength(1)
    expect(witness![0].id).toBe(bTrackId)

    const count = await publishContent(asA, 'track', artistB)
    expect(count).toBe(0)

    // …and nothing reached B's revisions either. The count is A's own return value, so a
    // publish that wrote a row while miscounting would still read as 0 here.
    const { count: revs } = await svc
      .from('revisions')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistB)
    expect(revs).toBe(0)
  })
})

describe('publish loop (draft -> publish -> public read)', () => {
  it('CRITICAL: publishing snapshots tracks into revisions, then they appear via the public read path', async () => {
    // A default on-site track: on the public site once published (the site gates
    // tracks on `on_site`, not Released — see 20260710170000).
    await createContent(asA, 'track', artistA, { title: PUBLISH_TITLE, stream_url: 'https://open.spotify.com/track/pub' })

    // Before publishing, the working row must NOT be on the public site. The payload has
    // to be a real one: on an artist with no published profile get_public_site answers
    // null, and "null does not contain the title" would pass for the wrong reason.
    const before = await anonClient().rpc('get_public_site', { p_slug: a.slug })
    expect(before.data, 'the door must be serving this artist at all').not.toBeNull()
    expect(JSON.stringify(before.data)).not.toContain(PUBLISH_TITLE)

    // Exact, not `toBeGreaterThanOrEqual(1)`: on a throwaway artist the catalogue is
    // exactly the songs this file made, so the count is a fact rather than a floor.
    const count = await publishContent(asA, 'track', artistA)
    expect(count).toBe(2) // the CRUD fixture (renamed) + the one just created

    // After publishing, the public read path serves it.
    const after = await anonClient().rpc('get_public_site', { p_slug: a.slug })
    expect(JSON.stringify(after.data)).toContain(PUBLISH_TITLE)
  })
})
