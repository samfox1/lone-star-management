// Importing a Drive file for real: the bytes land, the row registers, and a re-import
//   de-dupes.
/**
 * Drive copy-on-import — the real thing against the LIVE project: bytes land in
 * the right bucket under {artistId}/…, the row is registered with drive_file_id,
 * re-import dedupes via the partial unique index (and removes the just-uploaded
 * object — no orphans), and storage RLS still blocks cross-tenant writes. The
 * Drive client is faked (its HTTP contract is unit-tested in drive.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { importDriveFile } from '@/lib/drive-import'
import type { DriveClient } from '@/lib/drive'
import { SEED, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

const FOLDER = 'df-folder-1'
const AUDIO_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x00])

type Meta = { id: string; name: string; mimeType: string; size: number | null; parents: string[] }

/** A canned Drive client: fixed metadata + tiny bytes. */
function fakeDrive(meta: Partial<Meta>, bytes: Uint8Array = AUDIO_BYTES): DriveClient {
  return {
    getFileMeta: async () => ({
      id: 'df-file', name: 'Tiny Demo.mp3', mimeType: 'audio/mpeg', size: bytes.byteLength, parents: [FOLDER], ...meta,
    }),
    downloadFile: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as DriveClient
}

const imp = (kind: 'audio' | 'image' | 'video', fileId: string, drive: DriveClient) =>
  importDriveFile(asA as never, drive, { artistId: artistA, kind, fileId, folderId: FOLDER })

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
})

afterAll(async () => {
  // Remove the imported objects, then the rows (paths come from the rows).
  const clean = async (table: string, bucket: string, col: string) => {
    const { data } = await svc.from(table).select('*').like('drive_file_id', 'df-%')
    const paths = ((data ?? []) as Record<string, string>[]).map((r) => r[col]).filter(Boolean)
    if (paths.length) await svc.storage.from(bucket).remove(paths)
    await svc.from(table).delete().like('drive_file_id', 'df-%')
  }
  await clean('tracks', 'audio', 'audio_path')
  await clean('videos', 'videos', 'storage_path')
  await clean('media', 'media', 'storage_path')
})

describe('importDriveFile', () => {
  it('audio: lands bytes in the private audio bucket and registers an Unreleased song', async () => {
    const res = await imp('audio', 'df-audio-1', fakeDrive({ id: 'df-audio-1' }))
    expect(res).toEqual({ ok: true })

    const { data: row } = await svc
      .from('tracks').select('title, source, audio_path, drive_file_id')
      .eq('artist_id', artistA).eq('drive_file_id', 'df-audio-1').single()
    expect(row).toMatchObject({ title: 'Tiny Demo', source: 'manual', drive_file_id: 'df-audio-1' })
    expect(row!.audio_path).toMatch(new RegExp(`^${artistA}/audio/.+\\.mp3$`))

    const dl = await asA.storage.from('audio').download(row!.audio_path)
    expect(dl.error).toBeNull()
    expect(new Uint8Array(await dl.data!.arrayBuffer())).toEqual(AUDIO_BYTES)
  })

  // Owns both halves of its fixture: it used to re-import the row the test above
  // happened to leave behind, so running it alone (or after a reorder) proved nothing.
  it('re-importing the same Drive file dedupes AND leaves no orphan object', async () => {
    const drive = fakeDrive({ id: 'df-audio-2' })
    expect(await imp('audio', 'df-audio-2', drive)).toEqual({ ok: true })

    const before = await svc.storage.from('audio').list(`${artistA}/audio`)
    expect(await imp('audio', 'df-audio-2', drive)).toEqual({ error: 'Already imported from Drive.' })
    const after = await svc.storage.from('audio').list(`${artistA}/audio`)
    expect(after.data!.length).toBe(before.data!.length) // rolled back, not orphaned
  })

  it('video: uploaded-provider row, off-site until published', async () => {
    const drive = fakeDrive({ id: 'df-video-1', name: 'Tour Recap.mp4', mimeType: 'video/mp4' })
    expect(await imp('video', 'df-video-1', drive)).toEqual({ ok: true })
    const { data: row } = await svc
      .from('videos').select('title, provider, on_site, storage_path')
      .eq('artist_id', artistA).eq('drive_file_id', 'df-video-1').single()
    expect(row).toMatchObject({ title: 'Tour Recap', provider: 'uploaded', on_site: false })
  })

  it('image: gallery_image media row in the public media bucket', async () => {
    const drive = fakeDrive({ id: 'df-image-1', name: 'press.png', mimeType: 'image/png' })
    expect(await imp('image', 'df-image-1', drive)).toEqual({ ok: true })
    const { data: row } = await svc
      .from('media').select('purpose, storage_path')
      .eq('artist_id', artistA).eq('drive_file_id', 'df-image-1').single()
    expect(row!.purpose).toBe('gallery_image')
    expect(row!.storage_path).toMatch(new RegExp(`^${artistA}/gallery/.+\\.png$`))
  })

  it('rejects a file whose MIME does not match the requested kind', async () => {
    const res = await imp('image', 'df-x1', fakeDrive({ id: 'df-x1' })) // audio meta, image kind
    expect(res).toEqual({ error: "That file isn't an image." })
  })

  it("rejects a file that isn't inside the connected folder", async () => {
    const res = await imp('audio', 'df-x2', fakeDrive({ id: 'df-x2', parents: ['other-folder'] }))
    expect(res).toEqual({ error: "That file isn't in the connected Drive folder." })
  })

  it('rejects unsupported extensions with the allowed list', async () => {
    const res = await imp('audio', 'df-x3', fakeDrive({ id: 'df-x3', name: 'demo.flac' }))
    expect('error' in res && res.error).toMatch(/isn't supported — Drive import takes MP3, M4A/)
  })

  it('rejects oversize files up front with a friendly steer to direct upload', async () => {
    const res = await imp('audio', 'df-x4', fakeDrive({ id: 'df-x4', size: 31 * 1024 * 1024 }))
    expect('error' in res && res.error).toMatch(/31 MB — Drive import handles up to 30 MB/)
  })

  it("CRITICAL: manager A cannot import into another artist's folder (storage RLS)", async () => {
    const before = await svc.storage.from('audio').list(`${artistB}/audio`)
    const res = await importDriveFile(asA as never, fakeDrive({ id: 'df-x5' }), {
      artistId: artistB, kind: 'audio', fileId: 'df-x5', folderId: FOLDER,
    })
    // The refusal has to come from RLS. `'error' in res` alone also passes when the
    // bucket name is misspelled or the file is missing — i.e. it passes while the
    // tenancy boundary is wide open.
    expect('error' in res && res.error).toMatch(/row-level security/i)

    const { data: rows } = await svc
      .from('tracks').select('id').eq('artist_id', artistB).eq('drive_file_id', 'df-x5')
    expect(rows).toEqual([]) // no row for the other tenant
    const after = await svc.storage.from('audio').list(`${artistB}/audio`)
    expect(after.data!.length).toBe(before.data!.length) // and no bytes either
  })
})
