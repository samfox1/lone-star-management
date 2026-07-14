/**
 * Uploaded-video integration against the live hosted project (20260708120000). Proves
 * the long-term-bug guards that unit tests can't reach:
 *   - the embed-or-storage + provider CHECK constraints (service role bypasses RLS but
 *     NOT checks, so a rejection is unambiguously the constraint);
 *   - the videos bucket is NOT anon-enumerable, but manager writes are folder-scoped;
 *   - an uploaded row's storage_path flows through the publish snapshot → get_public_site
 *     (without leaking the server-only columns) and is gated by `on_site`;
 *   - performUpload removes the object when the row write fails (no orphan), end-to-end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createContent, publishContent, reconcileOnSite } from '@/lib/content'
import { performUpload, buildStoragePath } from '@/lib/upload'
import { gcVideoObjects, gcDeletedVideoObject } from '@/lib/storage-gc'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()
const objects: string[] = [] // storage paths to clean up
const bytes = new Uint8Array([0, 0, 0, 32]) // tiny stand-in; the bucket checks declared mime, not bytes

async function put(client: SupabaseClient, path: string) {
  objects.push(path)
  return client.storage.from('videos').upload(path, bytes, { contentType: 'video/mp4', upsert: false })
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  if (objects.length) await svc.storage.from('videos').remove(objects)
  await svc.from('revisions').delete().eq('artist_id', artistA).eq('entity_type', 'video')
  await svc.from('videos').delete().eq('artist_id', artistA)
  await svc.from('videos').delete().eq('artist_id', artistB)
})

describe('videos CHECK constraints (service role isolates the constraint)', () => {
  it('rejects a row with neither embed_url nor storage_path', async () => {
    const { error } = await svc
      .from('videos')
      .insert({ artist_id: artistA, title: 'UPL-neither', provider: 'uploaded', embed_url: null, storage_path: null })
    expect(error).not.toBeNull()
  })

  it('accepts a storage-only uploaded row', async () => {
    const { data, error } = await svc
      .from('videos')
      .insert({ artist_id: artistA, title: 'UPL-storage', provider: 'uploaded', storage_path: `${artistA}/videos/x.mp4` })
      .select('id')
      .single()
    expect(error).toBeNull()
    if (data) await svc.from('videos').delete().eq('id', data.id)
  })

  it("provider CHECK allows 'uploaded' but still rejects junk", async () => {
    const bad = await svc
      .from('videos')
      .insert({ artist_id: artistA, title: 'UPL-junkprov', provider: 'vimeo', storage_path: `${artistA}/videos/y.mp4` })
    expect(bad.error).not.toBeNull()
  })
})

describe('videos bucket security', () => {
  it('CRITICAL: anon cannot enumerate the videos bucket', async () => {
    const { data } = await anonClient().storage.from('videos').list(`${artistA}/videos`)
    expect(data ?? []).toHaveLength(0)
  })

  it("CRITICAL: a manager cannot write into another artist's folder", async () => {
    const mine = await put(asA, buildStoragePath(artistA, 'videos', 'mp4'))
    expect(mine.error).toBeNull()
    const theirs = await put(asA, buildStoragePath(artistB, 'videos', 'mp4'))
    expect(theirs.error).not.toBeNull()
  })

  it('an uploaded object stays publicly fetchable by URL (blocking list did not break playback)', async () => {
    const path = buildStoragePath(artistA, 'videos', 'mp4')
    const { error } = await put(asA, path)
    expect(error).toBeNull()
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/videos/${path}`)
    expect(res.ok).toBe(true)
  })
})

describe('uploaded video RLS isolation', () => {
  it("CRITICAL: cannot read/update/delete another tenant's uploaded video", async () => {
    const { data: bRow } = await svc
      .from('videos')
      .insert({ artist_id: artistB, title: 'UPL-Bsecret', provider: 'uploaded', storage_path: `${artistB}/videos/z.mp4`, on_site: false })
      .select('id')
      .single()
    const id = bRow!.id as string

    const read = await asA.from('videos').select('id').eq('id', id)
    expect(read.data ?? []).toHaveLength(0)
    const upd = await asA.from('videos').update({ title: 'hacked' }).eq('id', id)
    expect(upd.error ?? (await svc.from('videos').select('title').eq('id', id).single()).data!.title).toBe('UPL-Bsecret')
    await asA.from('videos').delete().eq('id', id)
    const still = await svc.from('videos').select('id').eq('id', id)
    expect(still.data ?? []).toHaveLength(1)
  })
})

describe('publish → public site', () => {
  it('storage_path flows into the snapshot + get_public_site, gated by on_site, no secret cols', async () => {
    const path = buildStoragePath(artistA, 'videos', 'mp4')
    await put(asA, path)
    const row = await createContent(asA, 'video', artistA, {
      title: 'UPL-published',
      provider: 'uploaded',
      embed_url: null,
      storage_path: path,
    })
    await publishContent(asA, 'video', artistA)

    // Published snapshot carries storage_path but not the server-only columns.
    const { data: rev } = await svc
      .from('revisions')
      .select('data')
      .eq('artist_id', artistA)
      .eq('entity_type', 'video')
      .order('published_at', { ascending: false })
      .limit(1)
      .single()
    const snap = rev!.data as Record<string, unknown>
    expect(snap.storage_path).toBe(path)
    expect(snap).not.toHaveProperty('youtube_id')
    expect(snap).not.toHaveProperty('source')

    const videos = async () =>
      (((await anonClient().rpc('get_public_site', { p_slug: SEED.artistASlug })).data as Record<string, Record<string, unknown>[]> | null)?.videos ?? [])
    const mine = (arr: Record<string, unknown>[]) => arr.find((v) => v.storage_path === path)

    expect(mine(await videos())).toBeUndefined() // still hidden (on_site=false)
    await reconcileOnSite(asA, 'video', artistA, [row.id as string])
    const shown = mine(await videos())
    expect(shown).toBeDefined()
    expect(shown!.provider).toBe('uploaded')
  })
})

describe('storage GC', () => {
  it('CRITICAL: keeps a referenced object but removes one orphaned by a delete', async () => {
    const path = buildStoragePath(artistA, 'videos', 'mp4')
    await put(asA, path)
    const row = await createContent(asA, 'video', artistA, {
      title: 'UPL-gc',
      provider: 'uploaded',
      embed_url: null,
      storage_path: path,
    })

    // Still referenced by the working row → GC must NOT touch it.
    await gcVideoObjects(asA, artistA, 0)
    const after1 = await svc.storage.from('videos').list(`${artistA}/videos`)
    expect((after1.data ?? []).some((o) => path.endsWith(o.name))).toBe(true)

    // Delete the working row → the object is now an orphan → GC removes it.
    await svc.from('videos').delete().eq('id', row.id as string)
    await gcVideoObjects(asA, artistA, 0)
    const after2 = await svc.storage.from('videos').list(`${artistA}/videos`)
    expect((after2.data ?? []).some((o) => path.endsWith(o.name))).toBe(false)
  })

  it('CRITICAL: default-age GC leaves a FRESH unreferenced object (mid-upload race guard)', async () => {
    // Simulate an in-flight upload: object exists, row not yet inserted.
    const path = buildStoragePath(artistA, 'videos', 'mp4')
    await put(asA, path)
    await gcVideoObjects(asA, artistA) // default 15-min age gate
    const after = await svc.storage.from('videos').list(`${artistA}/videos`)
    expect((after.data ?? []).some((o) => path.endsWith(o.name))).toBe(true) // survived — not deleted mid-upload
  })
})

describe('delete flow → row + storage', () => {
  const hasObject = async (path: string) => {
    const { data } = await svc.storage.from('videos').list(`${artistA}/videos`)
    return (data ?? []).some((o) => path.endsWith(o.name))
  }

  it('CRITICAL: deleting a DRAFT uploaded video removes both the row AND the object', async () => {
    const path = buildStoragePath(artistA, 'videos', 'mp4')
    await put(asA, path)
    const row = await createContent(asA, 'video', artistA, {
      title: 'UPL-draftdel',
      provider: 'uploaded',
      embed_url: null,
      storage_path: path,
    })
    expect(await hasObject(path)).toBe(true)

    // The real delete path: remove the row, then the delete-time cleanup.
    await asA.from('videos').delete().eq('id', row.id as string)
    await gcDeletedVideoObject(asA, row.id as string, path)

    expect((await svc.from('videos').select('id').eq('id', row.id as string)).data ?? []).toHaveLength(0) // row gone
    expect(await hasObject(path)).toBe(false) // object gone
  })

  it('a PUBLISHED video keeps its object at delete (still served until tombstone; publish GC handles it)', async () => {
    const path = buildStoragePath(artistA, 'videos', 'mp4')
    await put(asA, path)
    const row = await createContent(asA, 'video', artistA, {
      title: 'UPL-pubdel',
      provider: 'uploaded',
      embed_url: null,
      storage_path: path,
    })
    await publishContent(asA, 'video', artistA) // now a revision references the path

    await asA.from('videos').delete().eq('id', row.id as string)
    await gcDeletedVideoObject(asA, row.id as string, path)

    expect(await hasObject(path)).toBe(true) // object survives — get_public_site still serves it
  })
})

describe('orphan cleanup', () => {
  it('CRITICAL: performUpload removes the object when the row write fails', async () => {
    const path = buildStoragePath(artistA, 'videos', 'mp4')
    objects.push(path) // in case cleanup is needed; the test asserts it's already gone
    const res = await performUpload({
      supabase: asA as never,
      bucket: 'videos',
      path,
      file: bytes,
      contentType: 'video/mp4',
      // Write a row for artist B via A's client → RLS rejects → orphan must be removed.
      writeRow: async (p) => {
        const { error } = await asA.from('videos').insert({ artist_id: artistB, title: 'UPL-orphan', provider: 'uploaded', storage_path: p })
        return error?.message ?? null
      },
    })
    expect('error' in res).toBe(true)
    const { data } = await svc.storage.from('videos').list(`${artistA}/videos`)
    expect((data ?? []).some((o) => path.endsWith(o.name))).toBe(false)
  })
})
