/**
 * Pure upload + video-render logic, extracted so the rules that used to be buried in
 * the uploader components' onChange handlers (and the site templates' render branch)
 * have fast regression guards. No DB, no React.
 */
import { describe, expect, it, vi } from 'vitest'
import { validateUpload, buildStoragePath, contentTypeFor, performUpload, friendlyUploadError, formatProgress } from '@/lib/upload'
import { videoRenderMode, embedOrStorageValid, publicVideoSrc, isRenderableVideo } from '@/lib/video-render'
import { orphanedPaths, collectablePaths } from '@/lib/storage-gc'

describe('validateUpload', () => {
  const rules = { allowedExt: ['mp4', 'mov', 'webm'], maxBytes: 200_000_000 }

  it('accepts an allowed ext within size', () => {
    expect(validateUpload({ name: 'clip.mp4', size: 1000, type: 'video/mp4' }, rules)).toEqual({ ok: true, ext: 'mp4' })
  })
  it('is case-insensitive on ext', () => {
    expect(validateUpload({ name: 'CLIP.MP4', size: 1, type: '' }, rules)).toEqual({ ok: true, ext: 'mp4' })
    expect(validateUpload({ name: 'x.EXE', size: 1, type: '' }, rules).ok).toBe(false)
  })
  it('rejects a disallowed ext, naming the allowed types', () => {
    const r = validateUpload({ name: 'evil.exe', size: 1, type: '' }, rules)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/MP4/)
  })
  it('rejects over maxBytes, accepts exactly maxBytes (boundary)', () => {
    expect(validateUpload({ name: 'a.mp4', size: rules.maxBytes + 1, type: '' }, rules).ok).toBe(false)
    expect(validateUpload({ name: 'a.mp4', size: rules.maxBytes, type: '' }, rules).ok).toBe(true)
  })
  it('rejects no-extension and trailing-dot names (never returns ext:"")', () => {
    expect(validateUpload({ name: 'noext', size: 1, type: '' }, rules).ok).toBe(false)
    expect(validateUpload({ name: 'foo.', size: 1, type: '' }, rules).ok).toBe(false)
    expect(validateUpload({ name: '.hidden', size: 1, type: '' }, rules).ok).toBe(false)
  })
  it('tolerates a blank/quirky mime when ext is valid, but rejects a hard mime mismatch', () => {
    const withMime = { ...rules, allowedMime: ['video/mp4', 'video/quicktime', 'video/webm'] }
    expect(validateUpload({ name: 'a.mp4', size: 1, type: '' }, withMime).ok).toBe(true) // browser reported no mime
    expect(validateUpload({ name: 'a.mp4', size: 1, type: 'text/html' }, withMime).ok).toBe(false) // spoofed
  })
})

describe('friendlyUploadError (raw Supabase/DB errors → specific manager-facing text)', () => {
  const ctx = { noun: 'video', allowed: ['mp4', 'mov', 'webm'], maxBytes: 500 * 1024 * 1024 }

  it('maps a bucket mime rejection, naming the allowed types', () => {
    const msg = friendlyUploadError('mime type text/html is not supported', ctx)
    expect(msg).toMatch(/MP4, MOV, WEBM/)
    expect(msg).not.toMatch(/text\/html/) // no raw jargon
  })
  it('maps a too-large (413) rejection to a smaller/compress hint, NOT a possibly-wrong number', () => {
    // The 413 is the server's limit (project global / bucket), which the client can't
    // read and may not equal ctx.maxBytes — so it must not quote a specific size here.
    const msg = friendlyUploadError('Payload too large', ctx)
    expect(msg).toMatch(/too large/i)
    expect(msg).toMatch(/smaller|compress/i)
    expect(msg).not.toMatch(/500 MB/)
    expect(friendlyUploadError('The object exceeded the maximum allowed size', ctx)).toMatch(/too large/i)
  })
  it('maps an RLS/permission violation to a permission message', () => {
    expect(friendlyUploadError('new row violates row-level security policy', ctx)).toMatch(/permission/i)
  })
  it('maps a network failure to a connection message', () => {
    expect(friendlyUploadError('Failed to fetch', ctx)).toMatch(/connection/i)
  })
  it('maps a duplicate to a rename hint', () => {
    expect(friendlyUploadError('The resource already exists', ctx)).toMatch(/already exists/i)
  })
  it('falls back to a clean generic (never a raw stack) for an unknown error', () => {
    const msg = friendlyUploadError('some unrecognized parser detail xyz', { noun: 'video' })
    expect(msg).toMatch(/video/)
    expect(msg).not.toMatch(/unrecognized/)
  })
  it('omits the type/limit clauses when context is absent', () => {
    expect(friendlyUploadError('mime not supported', { noun: 'file' })).not.toMatch(/undefined/)
  })
})

describe('orphanedPaths (storage GC diff)', () => {
  it('returns listed objects that are no longer referenced', () => {
    const listed = ['a/videos/1.mp4', 'a/videos/2.mp4', 'a/videos/3.mp4']
    const referenced = ['a/videos/2.mp4'] // only #2 still in a working row/live revision
    expect(orphanedPaths(listed, referenced)).toEqual(['a/videos/1.mp4', 'a/videos/3.mp4'])
  })
  it('keeps everything when all are referenced, removes nothing on empty input', () => {
    expect(orphanedPaths(['a/1.mp4'], ['a/1.mp4'])).toEqual([])
    expect(orphanedPaths([], ['a/1.mp4'])).toEqual([])
  })
})

describe('collectablePaths (age-gated GC — the mid-upload race guard)', () => {
  const now = 1_700_000_000_000
  const old = new Date(now - 20 * 60 * 1000).toISOString()
  const fresh = new Date(now - 60 * 1000).toISOString()

  it('collects an OLD unreferenced object', () => {
    expect(collectablePaths([{ path: 'a/videos/1.mp4', createdAt: old }], [], now)).toEqual(['a/videos/1.mp4'])
  })
  it('SKIPS a fresh unreferenced object — its row may still be mid-write', () => {
    expect(collectablePaths([{ path: 'a/videos/1.mp4', createdAt: fresh }], [], now)).toEqual([])
  })
  it('never collects a referenced object, even an old one', () => {
    expect(collectablePaths([{ path: 'a/videos/1.mp4', createdAt: old }], ['a/videos/1.mp4'], now)).toEqual([])
  })
  it('treats a missing timestamp as fresh (skips, never wrong-deletes)', () => {
    expect(collectablePaths([{ path: 'a/videos/1.mp4' }], [], now)).toEqual([])
  })
})

describe('buildStoragePath', () => {
  const A = '11111111-1111-1111-1111-111111111111'
  it('composes {artistId}/{category}/{uuid}.{ext} with a lowercased ext', () => {
    const p = buildStoragePath(A, 'videos', 'MP4', '22222222-2222-2222-2222-222222222222')
    expect(p).toBe(`${A}/videos/22222222-2222-2222-2222-222222222222.mp4`)
  })
  it('never echoes the original filename (path-traversal safe)', () => {
    const p = buildStoragePath(A, 'videos', 'mov')
    expect(p).toMatch(new RegExp(`^${A}/videos/[0-9a-f-]{36}\\.mov$`))
    expect(p).not.toContain('..')
    expect(p).not.toContain(' ')
  })
})

describe('contentTypeFor', () => {
  it('maps known video/audio exts, undefined otherwise', () => {
    expect(contentTypeFor('mp4')).toBe('video/mp4')
    expect(contentTypeFor('mov')).toBe('video/quicktime')
    expect(contentTypeFor('webm')).toBe('video/webm')
    expect(contentTypeFor('mp3')).toBe('audio/mpeg')
    expect(contentTypeFor('m4a')).toBe('audio/mp4')
    expect(contentTypeFor('exe')).toBeUndefined()
  })
})

describe('performUpload (orphan-cleanup orchestrator)', () => {
  function fakeSupabase(uploadErr: string | null) {
    const remove = vi.fn(async () => ({ error: null }))
    return {
      remove,
      storage: {
        from: () => ({ upload: async () => ({ error: uploadErr ? { message: uploadErr } : null }), remove }),
      },
    }
  }

  it('removes the just-uploaded object when the row write fails', async () => {
    const sb = fakeSupabase(null)
    const res = await performUpload({
      supabase: sb as never,
      bucket: 'videos',
      path: 'a/videos/x.mp4',
      file: {} as never,
      writeRow: async () => 'row exploded',
    })
    expect(res).toEqual({ error: 'row exploded' })
    expect(sb.remove).toHaveBeenCalledTimes(1)
    expect(sb.remove).toHaveBeenCalledWith(['a/videos/x.mp4'])
  })
  it('does NOT remove on the happy path', async () => {
    const sb = fakeSupabase(null)
    const res = await performUpload({
      supabase: sb as never,
      bucket: 'videos',
      path: 'a/videos/x.mp4',
      file: {} as never,
      writeRow: async () => null,
    })
    expect(res).toEqual({ ok: true })
    expect(sb.remove).not.toHaveBeenCalled()
  })
  it('surfaces an upload error without calling the row write', async () => {
    const sb = fakeSupabase('storage boom')
    const writeRow = vi.fn(async () => null)
    const res = await performUpload({ supabase: sb as never, bucket: 'videos', path: 'p', file: {} as never, writeRow })
    expect(res).toEqual({ error: 'storage boom' })
    expect(writeRow).not.toHaveBeenCalled()
  })

  it('uses an injected transfer (resumable) instead of the simple upload', async () => {
    const sb = fakeSupabase(null)
    const transfer = vi.fn(async () => null)
    const res = await performUpload({ supabase: sb as never, bucket: 'videos', path: 'a/videos/x.mp4', file: {} as never, writeRow: async () => null, transfer })
    expect(res).toEqual({ ok: true })
    expect(transfer).toHaveBeenCalledTimes(1)
  })

  it('a transfer error returns without a row write (partial upload can resume later)', async () => {
    const sb = fakeSupabase(null)
    const writeRow = vi.fn(async () => null)
    const res = await performUpload({ supabase: sb as never, bucket: 'videos', path: 'p', file: {} as never, writeRow, transfer: async () => 'transfer boom' })
    expect(res).toEqual({ error: 'transfer boom' })
    expect(writeRow).not.toHaveBeenCalled()
    expect(sb.remove).not.toHaveBeenCalled()
  })

  it('still rolls back the object when the row write fails after a resumable transfer', async () => {
    const sb = fakeSupabase(null)
    const res = await performUpload({ supabase: sb as never, bucket: 'videos', path: 'a/videos/x.mp4', file: {} as never, writeRow: async () => 'row boom', transfer: async () => null })
    expect(res).toEqual({ error: 'row boom' })
    expect(sb.remove).toHaveBeenCalledWith(['a/videos/x.mp4'])
  })
})

describe('formatProgress', () => {
  it('floors to a whole percent and clamps 0..100', () => {
    expect(formatProgress(0)).toBe('0%')
    expect(formatProgress(0.5)).toBe('50%')
    expect(formatProgress(0.999)).toBe('99%') // never show 100% until truly done
    expect(formatProgress(1)).toBe('100%')
    expect(formatProgress(1.5)).toBe('100%')
    expect(formatProgress(-0.2)).toBe('0%')
  })
})

describe('video-render helpers', () => {
  it('videoRenderMode: uploaded → video, embeds → iframe', () => {
    expect(videoRenderMode('uploaded')).toBe('video')
    expect(videoRenderMode('youtube')).toBe('iframe')
    expect(videoRenderMode('soundcloud')).toBe('iframe')
  })

  it('embedOrStorageValid: uploaded needs a file; embeds need a URL', () => {
    expect(embedOrStorageValid({ provider: 'uploaded', embed_url: null, storage_path: 'a/videos/x.mp4' })).toBe(true)
    expect(embedOrStorageValid({ provider: 'uploaded', embed_url: 'https://y', storage_path: null })).toBe(false)
    expect(embedOrStorageValid({ provider: 'youtube', embed_url: 'https://y', storage_path: null })).toBe(true)
    expect(embedOrStorageValid({ provider: 'youtube', embed_url: null, storage_path: null })).toBe(false)
  })

  it('publicVideoSrc: uploaded → public videos-bucket URL; embed → embed_url', () => {
    const up = publicVideoSrc({ provider: 'uploaded', embed_url: null, storage_path: 'a/videos/x.mp4' })
    expect(up).toBe(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/videos/a/videos/x.mp4`)
    expect(publicVideoSrc({ provider: 'youtube', embed_url: 'https://yt/e', storage_path: null })).toBe('https://yt/e')
  })

  it('publicVideoSrc rejects a malformed storage_path (never builds a bad src)', () => {
    expect(publicVideoSrc({ provider: 'uploaded', embed_url: null, storage_path: '../../etc/passwd' })).toBeNull()
  })

  it('isRenderableVideo: uploaded needs a resolvable path; embed needs a safe URL', () => {
    expect(isRenderableVideo({ provider: 'uploaded', embed_url: null, storage_path: 'a/videos/x.mp4' })).toBe(true)
    expect(isRenderableVideo({ provider: 'uploaded', embed_url: null, storage_path: '../../etc/passwd' })).toBe(false)
    expect(isRenderableVideo({ provider: 'youtube', embed_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', storage_path: null })).toBe(true)
    expect(isRenderableVideo({ provider: 'youtube', embed_url: null, storage_path: null })).toBe(false)
  })
})
