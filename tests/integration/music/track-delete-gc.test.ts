// Deleting a song takes its audio file with it, and a cleanup failure never fails the delete.
/**
 * deleteContentAction('track') — the audio object must not outlive the row.
 *
 * The merge path already collects a deleted duplicate's audio master
 * (gcDeletedAudioObject); PLAIN deletion was the remaining leak: the row died, the
 * object in the paid `audio` bucket survived forever, referenced by nothing and
 * collected by no one. This pins the delete path to the same rule the merge uses:
 *
 *   - never published → the object is removed with the row (the common case: upload
 *     a demo, delete it, storage is clean);
 *   - PUBLISHED → the object SURVIVES, because `audio_path_for_play` serves the path
 *     out of the published revision snapshot — removing it 404s the live site's
 *     player on a file that cannot be recovered;
 *   - a GC failure never fails the delete — losing the row delete over a storage
 *     hiccup is worse than a leaked object.
 *
 * The first two run against the LIVE project as the seeded manager (the action gets
 * manager A's real signed-in client, so RLS and storage policies run exactly as in
 * the app). The failure-ordering case uses a fake client, because a real storage
 * outage can't be planted.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// The action builds its client from request cookies; tests swap in either manager A's
// REAL signed-in client (live-DB cases) or a fake (the storage-failure case).
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => activeClient }))

import { deleteContentAction } from '@/app/artists/[id]/(dashboard)/actions'

let artistA: string
let asA: SupabaseClient
let activeClient: unknown
const svc = serviceClient()
const body = new Uint8Array([0xff, 0xfb, 0x90, 0x00]) // tiny fake mp3 frame

/** Rows/objects this file created — the ONLY things its teardown removes (the project
 *  is shared and live; a blanket delete-by-artist would erase other suites' fixtures). */
const createdTracks: string[] = []
const createdObjects: string[] = []

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  activeClient = asA
})

afterAll(async () => {
  if (createdTracks.length) {
    await svc.from('revisions').delete().in('entity_id', createdTracks)
    await svc.from('tracks').delete().in('id', createdTracks)
  }
  if (createdObjects.length) await svc.storage.from('audio').remove(createdObjects)
})

/** A track of artist A's with a real uploaded object behind its audio_path. */
async function seedSongWithAudio(name: string): Promise<{ id: string; path: string }> {
  const path = `${artistA}/audio/${name}`
  const up = await svc.storage.from('audio').upload(path, body, { contentType: 'audio/mpeg', upsert: true })
  if (up.error) throw new Error(up.error.message)
  createdObjects.push(path)
  const { data, error } = await svc
    .from('tracks')
    .insert({ artist_id: artistA, title: 'GC-DELETE fixture', source: 'manual', audio_path: path })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('fixture insert failed')
  createdTracks.push(data.id)
  return { id: data.id, path }
}

/** Existence via LIST (a metadata query), never download: a download primes the storage
 *  CDN cache, and the post-delete download then serves the stale bytes — making a real
 *  removal look like a leak. */
const objectExists = async (path: string) => {
  const name = path.split('/').pop()!
  const { data } = await svc.storage.from('audio').list(path.slice(0, path.lastIndexOf('/')), { search: name })
  return (data ?? []).some((o) => o.name === name)
}

describe('deleting a song with uploaded audio (live DB)', () => {
  it('CRITICAL: a never-published song takes its audio object with it', async () => {
    const { id, path } = await seedSongWithAudio('gc-del-unpublished.mp3')
    // The fixture must exist first, or the "gone" assertion below is vacuous.
    expect(await objectExists(path), 'fixture object missing before delete').toBe(true)

    expect((await deleteContentAction('track', id, artistA)).error).toBeUndefined()

    const { data: row } = await svc.from('tracks').select('id').eq('id', id).maybeSingle()
    expect(row).toBeNull()
    expect(await objectExists(path), 'audio object leaked after the row was deleted').toBe(false)
  })

  it('CRITICAL: a PUBLISHED song keeps its object — the revision snapshot still serves it', async () => {
    const { id, path } = await seedSongWithAudio('gc-del-published.mp3')
    // A published revision naming this song — audio_path_for_play reads the path out of
    // THIS snapshot, so the object must outlive the working row.
    const { error } = await svc
      .from('revisions')
      .insert({ artist_id: artistA, entity_type: 'track', entity_id: id, data: { audio_path: path } })
    if (error) throw new Error(error.message)

    expect((await deleteContentAction('track', id, artistA)).error).toBeUndefined()

    const { data: row } = await svc.from('tracks').select('id').eq('id', id).maybeSingle()
    expect(row).toBeNull()
    expect(await objectExists(path), 'published audio object removed — the live player now 404s').toBe(true)
  })
})

describe('GC failure never fails the delete', () => {
  it('returns success when every storage/revision surface is down, and still deletes the row', async () => {
    const deletes: string[] = []
    // Minimal client: the tracks read + delete succeed; everything GC touches throws.
    activeClient = {
      from(table: string) {
        if (table === 'tracks')
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: { audio_path: 'a1/audio/x.mp3' } }) }) }),
            delete: () => ({
              eq: async (_col: string, id: string) => {
                deletes.push(id)
                return { error: null }
              },
            }),
          }
        // The revisions count check — first thing GC does.
        return {
          select: () => ({
            eq: () => ({
              eq: async () => {
                throw new Error('revisions unreachable')
              },
            }),
          }),
        }
      },
      storage: {
        from: () => ({
          remove: async () => {
            throw new Error('storage down')
          },
        }),
      },
    }
    try {
      const res = await deleteContentAction('track', 't-err', 'a1')
      expect(res.error, 'a storage hiccup must not surface as a failed delete').toBeUndefined()
      expect(deletes, 'the row delete itself must still have run').toEqual(['t-err'])
    } finally {
      activeClient = asA
    }
  })
})
