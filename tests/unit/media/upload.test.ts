// What may be uploaded, per kind, and the size messages that say how to fix it.
/**
 * Pure upload + video-render logic, extracted so the rules that used to be buried in
 * the uploader components' onChange handlers (and the site templates' render branch)
 * have fast regression guards. No DB, no React.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  validateUpload,
  buildStoragePath,
  contentTypeFor,
  performUpload,
  friendlyUploadError,
  formatProgress,
  acceptFor,
  AUDIO_UPLOAD_RULES,
  DOCUMENT_UPLOAD_RULES,
  isOwnedStoragePath,
  IMAGE_UPLOAD_RULES,
  VIDEO_UPLOAD_RULES,
  FONT_UPLOAD_RULES,
} from '@/lib/upload'
import { videoRenderMode, embedOrStorageValid, publicVideoSrc, isRenderableVideo } from '@/lib/video-render'
import { collectablePaths } from '@/lib/storage-gc'

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

  it('CRITICAL: the IMAGE rules reject SVG — the media bucket is public and an SVG can carry script', () => {
    expect(validateUpload({ name: 'logo.svg', size: 1000, type: 'image/svg+xml' }, IMAGE_UPLOAD_RULES).ok).toBe(false)
  })

  it('CRITICAL: the IMAGE rules accept HEIC/HEIF — the iPhone default was refused at the door', () => {
    // ASSET_COMPRESSION_BRIEF (skeen repo): "assume camera originals — HEIC from an
    // iPhone". The compression gate transcodes every HEIC to webp before storage (the
    // media bucket's allowed_mime_types has no image/heic, deliberately — the raw file
    // must never land), but the validator ran on the picker's file FIRST in spirit:
    // .heic was not in allowedExt, so a manager's camera-roll photo was a dead end
    // before the compressor built to serve it ever saw the bytes.
    expect(validateUpload({ name: 'IMG_4021.heic', size: 9_000_000, type: 'image/heic' }, IMAGE_UPLOAD_RULES).ok).toBe(true)
    expect(validateUpload({ name: 'IMG_4021.heif', size: 9_000_000, type: 'image/heif' }, IMAGE_UPLOAD_RULES).ok).toBe(true)
    // Windows and some share paths report no mime for HEIC at all; ext carries it.
    expect(validateUpload({ name: 'IMG_4021.heic', size: 9_000_000, type: '' }, IMAGE_UPLOAD_RULES).ok).toBe(true)
  })

  it('…and the picker advertises what the validator now accepts', () => {
    // acceptFor derives from the same rules, so this is the pair staying in step.
    expect(acceptFor(IMAGE_UPLOAD_RULES)).toContain('.heic')
    expect(acceptFor(IMAGE_UPLOAD_RULES)).toContain('image/heic')
    expect(acceptFor(IMAGE_UPLOAD_RULES)).not.toContain('svg')
  })
})

/**
 * Track/song audio. ONE constant, because three uploaders hand-rolled the same list and
 * one had already drifted (song-add accepted audio/x-m4a, the other two rejected the
 * same file) — the exact failure IMAGE_UPLOAD_RULES exists to prevent.
 */
describe('AUDIO_UPLOAD_RULES (track/song audio)', () => {
  it('accepts mp3 and m4a', () => {
    expect(validateUpload({ name: 's.mp3', size: 1000, type: 'audio/mpeg' }, AUDIO_UPLOAD_RULES).ok).toBe(true)
    expect(validateUpload({ name: 's.m4a', size: 1000, type: 'audio/mp4' }, AUDIO_UPLOAD_RULES).ok).toBe(true)
  })

  it('CRITICAL: accepts an m4a the browser reports as audio/x-m4a — the drift that split the uploaders', () => {
    expect(validateUpload({ name: 's.m4a', size: 1000, type: 'audio/x-m4a' }, AUDIO_UPLOAD_RULES).ok).toBe(true)
  })

  it('rejects other audio formats and a spoofed mime', () => {
    expect(validateUpload({ name: 's.wav', size: 1000, type: 'audio/wav' }, AUDIO_UPLOAD_RULES).ok).toBe(false)
    expect(validateUpload({ name: 's.mp3', size: 1000, type: 'text/html' }, AUDIO_UPLOAD_RULES).ok).toBe(false)
  })

  it('caps at 30 MB, matching what all three uploaders already enforced', () => {
    expect(AUDIO_UPLOAD_RULES.maxBytes).toBe(30 * 1024 * 1024)
    expect(validateUpload({ name: 's.mp3', size: AUDIO_UPLOAD_RULES.maxBytes + 1, type: '' }, AUDIO_UPLOAD_RULES).ok).toBe(false)
  })
})

/**
 * `acceptFor` — the file-picker accept list, derived from the SAME rules validateUpload
 * enforces. Hand-written accept attributes are how the logo picker advertised image/*
 * (which admits SVG) while the validator refused it.
 */
describe('acceptFor', () => {
  it('lists every allowed mime and dot-extension', () => {
    expect(acceptFor(AUDIO_UPLOAD_RULES)).toBe('audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a')
  })

  it('CRITICAL: the image list never admits SVG — no wildcards, only the allowlist', () => {
    const accept = acceptFor(IMAGE_UPLOAD_RULES)
    expect(accept).not.toMatch(/svg/i)
    expect(accept).not.toContain('*')
    expect(accept).toContain('image/png')
    expect(accept).toContain('.jpg')
  })

  it('falls back to extensions alone when the rules carry no mime list', () => {
    expect(acceptFor({ allowedExt: ['pdf'], maxBytes: 1 })).toBe('.pdf')
  })
})

/**
 * Press-kit DOCUMENTS (stage plot, tech rider) — the first non-media upload.
 *
 * These are PDFs, and everything that already exists assumes images or video. The rules
 * are their own constant rather than a widened IMAGE_UPLOAD_RULES: a PDF must never be
 * accepted anywhere an image is expected. The `media` bucket is PUBLIC, so a PDF landing
 * there would be readable by URL forever; documents get a private bucket instead and are
 * fetched server-side when the EPK PDF is assembled.
 */
describe('DOCUMENT_UPLOAD_RULES (press-kit PDFs)', () => {
  it('accepts a PDF', () => {
    expect(validateUpload({ name: 'rider.pdf', size: 1000, type: 'application/pdf' }, DOCUMENT_UPLOAD_RULES)).toEqual({
      ok: true,
      ext: 'pdf',
    })
  })

  it('CRITICAL: rejects an image — documents are not the media uploader', () => {
    expect(validateUpload({ name: 'photo.jpg', size: 1000, type: 'image/jpeg' }, DOCUMENT_UPLOAD_RULES).ok).toBe(false)
  })

  it('CRITICAL: rejects a spoofed mime on a .pdf name', () => {
    // A public-facing document store that took text/html would serve stored XSS from the
    // Supabase origin. The bucket is the real guard; this is the client-side half.
    expect(validateUpload({ name: 'rider.pdf', size: 1000, type: 'text/html' }, DOCUMENT_UPLOAD_RULES).ok).toBe(false)
  })

  it('CRITICAL: a PDF is rejected by the IMAGE rules, so widening one never widens the other', () => {
    expect(validateUpload({ name: 'rider.pdf', size: 1000, type: 'application/pdf' }, IMAGE_UPLOAD_RULES).ok).toBe(false)
    expect(validateUpload({ name: 'rider.pdf', size: 1000, type: 'application/pdf' }, VIDEO_UPLOAD_RULES).ok).toBe(false)
  })

  it('caps the size well below the image limit — a rider is a few pages', () => {
    expect(DOCUMENT_UPLOAD_RULES.maxBytes).toBeLessThan(IMAGE_UPLOAD_RULES.maxBytes)
    expect(validateUpload({ name: 'r.pdf', size: DOCUMENT_UPLOAD_RULES.maxBytes + 1, type: '' }, DOCUMENT_UPLOAD_RULES).ok).toBe(false)
  })

  it('names PDF in the rejection message', () => {
    const r = validateUpload({ name: 'x.doc', size: 1, type: '' }, DOCUMENT_UPLOAD_RULES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/PDF/)
  })

  it('sets an explicit application/pdf content type on upload', () => {
    expect(contentTypeFor('pdf')).toBe('application/pdf')
  })
})

describe('over-size messages carry the FIX, not just the verdict (asset-compression brief)', () => {
  // "That file is 200 MB — the limit is 500 MB" tells a manager they failed; it does not
  // tell them what to do next, and "compress it first" without HOW is a dead end for
  // someone without the tools. Video and font over-size messages now name the one-time
  // fix in plain words. Images are absent on purpose: the editor's gate compresses those
  // FOR the manager, so instructions there would describe work nobody has to do.
  it('a video over the limit says how to export it smaller', () => {
    const big = { name: 'clip.mp4', size: VIDEO_UPLOAD_RULES.maxBytes + 1, type: 'video/mp4' }
    const res = validateUpload(big, VIDEO_UPLOAD_RULES)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/1080p/i)
  })

  it('a font over the limit points at WOFF2', () => {
    const big = { name: 'family.ttf', size: FONT_UPLOAD_RULES.maxBytes + 1, type: 'font/ttf' }
    const res = validateUpload(big, FONT_UPLOAD_RULES)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/woff2/i)
  })

  it('an image over the limit keeps the plain message — the editor compresses those', () => {
    const big = { name: 'photo.jpg', size: IMAGE_UPLOAD_RULES.maxBytes + 1, type: 'image/jpeg' }
    const res = validateUpload(big, IMAGE_UPLOAD_RULES)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).not.toMatch(/1080p|woff2/i)
  })

  it('…and every over-size message still names both numbers', () => {
    const big = { name: 'clip.mp4', size: VIDEO_UPLOAD_RULES.maxBytes + 1, type: 'video/mp4' }
    const res = validateUpload(big, VIDEO_UPLOAD_RULES)
    if (!res.ok) expect(res.error).toMatch(/limit is/)
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

/**
 * `isOwnedStoragePath` — the tie between "who uploaded" and "what row points where".
 *
 * A storage path arrives from the CLIENT: the browser uploads direct-to-Storage, then
 * asks a server action to record the location. Storage RLS pins the upload to the
 * tenant's folder and row RLS pins the row's tenant, but until this nothing connected
 * the two, so a manager could record a row pointing at any path they liked.
 */
describe('isOwnedStoragePath', () => {
  const A = '1f2a969b-cb1c-493c-851f-647581a3e4ab'
  const B = '99999999-cb1c-493c-851f-647581a3e4ab'
  const good = buildStoragePath(A, 'brand', 'png')

  it('accepts exactly what buildStoragePath produces', () => {
    expect(isOwnedStoragePath(A, good)).toBe(true)
    for (const folder of ['brand', 'gallery', 'hero-videos', 'profile', 'documents']) {
      expect(isOwnedStoragePath(A, buildStoragePath(A, folder, 'jpg'))).toBe(true)
    }
  })

  it('accepts a descriptive SLUG filename too (20260826140000), still tenant-pinned', () => {
    expect(isOwnedStoragePath(A, `${A}/gallery/skeen-tour-with-jigitz.jpg`)).toBe(true)
    expect(isOwnedStoragePath(B, `${A}/gallery/skeen-tour-with-jigitz.jpg`)).toBe(false)
    // Not a slug: uppercase, spaces, dots in the name, an over-long name.
    expect(isOwnedStoragePath(A, `${A}/gallery/Skeen.jpg`)).toBe(false)
    expect(isOwnedStoragePath(A, `${A}/gallery/skeen tour.jpg`)).toBe(false)
    expect(isOwnedStoragePath(A, `${A}/gallery/skeen.tour.jpg`)).toBe(false)
    expect(isOwnedStoragePath(A, `${A}/gallery/${'a'.repeat(81)}.jpg`)).toBe(false)
  })

  it("CRITICAL: rejects another artist's folder", () => {
    expect(isOwnedStoragePath(A, buildStoragePath(B, 'brand', 'png'))).toBe(false)
  })

  it('CRITICAL: rejects traversal and absolute paths', () => {
    for (const bad of [
      `${A}/brand/../../${B}/brand/x.png`,
      `../${A}/brand/x.png`,
      `/${A}/brand/x.png`,
      `${A}/../x.png`,
    ]) {
      expect(isOwnedStoragePath(A, bad), bad).toBe(false)
    }
  })

  it('CRITICAL: rejects a prefix that merely STARTS with the artist id', () => {
    // `${A}-evil/...` starts with A's id but is a different folder entirely.
    expect(isOwnedStoragePath(A, `${A}-evil/brand/${A}.png`)).toBe(false)
  })

  it('rejects a missing folder, an empty name, and junk', () => {
    // `evil.png` used to be here: since 20260826140000 a slug-shaped name is a legal
    // file name (media-rename.ts). The tenant prefix is what keeps it harmless.
    for (const bad of [`${A}/x.png`, `${A}/brand/`, `${A}/brand/.png`, '', 'x']) {
      expect(isOwnedStoragePath(A, bad), bad).toBe(false)
    }
  })

  it('rejects a non-string', () => {
    expect(isOwnedStoragePath(A, null as unknown as string)).toBe(false)
  })
})
