/**
 * MERGING SONGS — against the real database.
 *
 * The pure resolution table is pinned in tests/song-merge.test.ts. What can only be
 * proven here is the part that decides whether a merge is ALLOWED to run at all, because
 * it is enforced by RLS and by the artist-scoped re-read, neither of which a mock can
 * demonstrate. A merge deletes a row permanently, so "who can delete whose song" is the
 * assertion that matters most in this file.
 *
 * The last two blocks are the failure modes that cost real data: a cross-artist pair, and
 * a conflicting-identity pair that must leave BOTH rows standing rather than silently
 * discarding one platform's song.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeSongs } from '@/lib/song-merge'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

const svc = serviceClient()

let artistA: string
let artistB: string
let asA: SupabaseClient

// Every row this file creates, torn down by stable identity — the suite shares one real
// database with the seeded roster, so a leaked fixture becomes another file's bug.
const created: string[] = []

async function makeSong(artistId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await svc
    .from('tracks')
    .insert({ artist_id: artistId, title: 'MERGE fixture', source: 'manual', ...fields })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('fixture insert failed')
  created.push(data.id)
  return data.id
}

const readSong = async (id: string) => {
  const { data } = await svc.from('tracks').select('*').eq('id', id).maybeSingle()
  return data
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  if (created.length) await svc.from('tracks').delete().in('id', created)
})

describe('a real merge', () => {
  it('unions the duplicate onto the kept song and deletes the duplicate', async () => {
    const keep = await makeSong(artistA, { title: 'MERGE keeper', spotify_id: 'merge-sp-1' })
    const drop = await makeSong(artistA, {
      title: 'MERGE dupe',
      apple_id: 'merge-ap-1',
      album_name: 'MERGE album',
      duration_ms: 203_000,
    })

    expect(await mergeSongs(asA, artistA, keep, drop)).toEqual({ ok: true, orphanedAudioPath: null })

    const merged = await readSong(keep)
    expect(merged).toMatchObject({
      title: 'MERGE keeper', // the kept row's curated title survives
      spotify_id: 'merge-sp-1',
      apple_id: 'merge-ap-1', // gained from the duplicate
      album_name: 'MERGE album',
      duration_ms: 203_000,
    })
    expect(await readSong(drop)).toBeNull()
  })
})

/**
 * CROSS-ARTIST. `artistId` and both song ids arrive from the client, so the pair is
 * re-read scoped to the artist rather than trusted. Two ways this could go wrong, both
 * covered: naming another tenant's song as the duplicate (it would be DELETED), and
 * naming it as the keeper (it would be WRITTEN to).
 */
describe('cross-artist merges are impossible', () => {
  it("CRITICAL: refuses to absorb another artist's song, and deletes nothing", async () => {
    const keep = await makeSong(artistA, { title: 'MERGE mine' })
    const foreign = await makeSong(artistB, { title: 'MERGE theirs' })

    const res = await mergeSongs(asA, artistA, keep, foreign)
    expect(res.ok).toBe(false)
    // The foreign song is untouched — this is the assertion that would fail if the pair
    // were resolved by id alone.
    expect(await readSong(foreign)).not.toBeNull()
  })

  it("CRITICAL: refuses to write into another artist's song", async () => {
    const foreign = await makeSong(artistB, { title: 'MERGE theirs target' })
    const drop = await makeSong(artistA, { title: 'MERGE mine', apple_id: 'merge-ap-2' })

    expect((await mergeSongs(asA, artistA, foreign, drop)).ok).toBe(false)
    expect(await readSong(foreign)).toMatchObject({ apple_id: null })
    expect(await readSong(drop)).not.toBeNull()
  })

  // Claiming artist B's id does not widen anything: manager A cannot see B's rows at all,
  // so the pair still fails to resolve. Belt and braces over the guard above.
  it("CRITICAL: naming the other artist's id doesn't unlock their songs", async () => {
    const one = await makeSong(artistB, { title: 'MERGE b one' })
    const two = await makeSong(artistB, { title: 'MERGE b two' })

    expect((await mergeSongs(asA, artistB, one, two)).ok).toBe(false)
    expect(await readSong(one)).not.toBeNull()
    expect(await readSong(two)).not.toBeNull()
  })

  /**
   * The artist-scoped re-read, ISOLATED from RLS.
   *
   * Every case above also passes with the scoping removed, because manager A simply
   * cannot see artist B's rows — RLS answers first. That makes those tests unable to
   * see a regression in the scoping itself, and the scoping is the ONLY thing standing
   * between a multi-artist manager and a merge that moves a song between two rosters.
   * Lone Star is single-manager today; the day it isn't, this is the test that notices.
   *
   * The service-role client is used precisely BECAUSE it bypasses RLS: it is the
   * strongest available stand-in for a caller who legitimately sees both artists.
   */
  it('CRITICAL: refuses a cross-artist pair even for a caller who can see both', async () => {
    const keep = await makeSong(artistA, { title: 'MERGE scope A' })
    const foreign = await makeSong(artistB, { title: 'MERGE scope B', apple_id: 'merge-ap-scope' })

    expect((await mergeSongs(svc, artistA, keep, foreign)).ok).toBe(false)
    expect(await readSong(foreign)).not.toBeNull()
    expect(await readSong(keep)).toMatchObject({ apple_id: null })
  })
})

/**
 * THE CONFLICT REFUSAL, end to end. A refusal must leave the database exactly as it was:
 * a merge that half-ran — patching the keeper but failing to delete, or vice versa — is
 * worse than not merging, because the duplicate stops looking like a duplicate.
 */
describe('conflicting platform identity refuses without touching either row', () => {
  it('CRITICAL: different Spotify ids refuse, and BOTH songs survive intact', async () => {
    const keep = await makeSong(artistA, { title: 'MERGE conflict A', spotify_id: 'merge-conflict-a' })
    const drop = await makeSong(artistA, {
      title: 'MERGE conflict B',
      spotify_id: 'merge-conflict-b',
      album_name: 'MERGE would-be-copied',
    })

    const res = await mergeSongs(asA, artistA, keep, drop)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/Spotify/)

    expect(await readSong(keep)).toMatchObject({
      spotify_id: 'merge-conflict-a',
      album_name: null, // nothing was copied over before the refusal
    })
    expect(await readSong(drop)).not.toBeNull()
  })

  it('a song is never merged into itself', async () => {
    const one = await makeSong(artistA, { title: 'MERGE self' })
    expect((await mergeSongs(asA, artistA, one, one)).ok).toBe(false)
    expect(await readSong(one)).not.toBeNull()
  })
})
