// @vitest-environment jsdom
/**
 * The compressor itself — the code that touches the manager's actual bytes.
 *
 * It had NO tests when it shipped, on the reasoning that jsdom has no canvas. That
 * reasoning is wrong twice over: the browser APIs it uses are three named globals that
 * can be faked, and the decisions worth pinning are not "does canvas work" but the ones
 * that silently destroy a file when they are wrong —
 *
 *   • EXIF orientation, or every sideways phone photo uploads rotated;
 *   • alpha preserved, because this is NOT og-card's pipeline (that one fills its
 *     background BY DESIGN, and reusing it here would put a black box behind every
 *     transparent logo);
 *   • PNG skips the quality walk, since toBlob ignores quality for it and walking would
 *     be six identical encodes converging on nothing;
 *   • the bitmap is released on EVERY path, including the throwing one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressImageFile, decodeEdgePx } from '@/lib/site-editor/compress-image'
import type { AssetBudget } from '@/lib/site-editor/asset-budget'

type BitmapCall = { file: unknown; opts?: { imageOrientation?: string } }

const calls = {
  bitmap: [] as BitmapCall[],
  draw: [] as { w: number; h: number }[],
  toBlob: [] as { mime: string; quality: number | undefined }[],
  closed: 0,
}

/** Bytes an encode returns, per quality. Overridden per test. */
let encodedSize: (mime: string, quality: number | undefined) => number
/** The decoded source dimensions. */
let source = { width: 4000, height: 3000 }
/** Make createImageBitmap reject, for the decode-failure paths. */
let decodeFails = false

beforeEach(() => {
  calls.bitmap = []
  calls.draw = []
  calls.toBlob = []
  calls.closed = 0
  source = { width: 4000, height: 3000 }
  decodeFails = false
  encodedSize = () => 100_000

  vi.stubGlobal('createImageBitmap', (file: unknown, opts?: { imageOrientation?: string }) => {
    calls.bitmap.push({ file, opts })
    if (decodeFails) return Promise.reject(new Error('decode failed'))
    return Promise.resolve({
      width: source.width,
      height: source.height,
      close: () => {
        calls.closed += 1
      },
    })
  })

  // jsdom's <canvas> has no 2d context and no toBlob; supply both.
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return Object.create(HTMLElement.prototype)
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (_b: unknown, _x: number, _y: number, w: number, h: number) => calls.draw.push({ w, h }),
      }),
      toBlob: (cb: (b: Blob | null) => void, mime: string, quality?: number) => {
        calls.toBlob.push({ mime, quality })
        // REAL bytes, not a blob with a lied-about `size`: compressImageFile builds its
        // result with `new File([blob], …)`, which re-reads the actual content — so a
        // faked size would silently make every size assertion here meaningless.
        cb(new Blob([new Uint8Array(encodedSize(mime, quality))], { type: mime }))
      },
    }
    return canvas as unknown as HTMLElement
  }) as typeof document.createElement)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const file = (name = 'photo.jpg', type = 'image/jpeg') => new File(['src'], name, { type })
const WEBP: AssetBudget = { maxEdgePx: 1200, maxBytes: 400_000, mime: 'image/webp' }

describe('decodeEdgePx', () => {
  it('CRITICAL: decodes with EXIF orientation applied', () => {
    // Without `from-image` a photo taken sideways measures (and later uploads) rotated —
    // and the manager has no way to correct it from the editor.
    return decodeEdgePx(file()).then((edge) => {
      expect(edge).toBe(4000)
      expect(calls.bitmap[0].opts?.imageOrientation).toBe('from-image')
    })
  })

  it('returns the LONGEST edge, whichever way round the photo is', async () => {
    source = { width: 3000, height: 4000 }
    expect(await decodeEdgePx(file())).toBe(4000)
  })

  it('a file it cannot decode measures undefined rather than throwing', async () => {
    // A corrupt file must not blow up the picker; the byte ceiling still applies.
    decodeFails = true
    expect(await decodeEdgePx(file())).toBeUndefined()
  })

  it('releases the bitmap — these are large and not GC-cheap', async () => {
    await decodeEdgePx(file())
    expect(calls.closed).toBe(1)
  })
})

describe('compressImageFile', () => {
  it('CRITICAL: downscales to the budget edge, preserving aspect', async () => {
    const out = await compressImageFile(file(), WEBP)
    expect({ width: out.width, height: out.height }).toEqual({ width: 1200, height: 900 })
    expect(calls.draw[0]).toEqual({ w: 1200, h: 900 })
  })

  it('CRITICAL: never upscales a small original', async () => {
    source = { width: 500, height: 400 }
    const out = await compressImageFile(file(), WEBP)
    expect({ width: out.width, height: out.height }).toEqual({ width: 500, height: 400 })
  })

  it('CRITICAL: decodes with EXIF orientation here too, not just when measuring', async () => {
    // Measuring upright and then ENCODING rotated would be the worst of both.
    await compressImageFile(file(), WEBP)
    expect(calls.bitmap[0].opts?.imageOrientation).toBe('from-image')
  })

  it('re-encodes to the budget mime and renames to match', async () => {
    const out = await compressImageFile(file('holiday.JPEG'), WEBP)
    expect(out.file.type).toBe('image/webp')
    expect(out.file.name).toBe('holiday.webp')
    expect(calls.toBlob.every((c) => c.mime === 'image/webp')).toBe(true)
  })

  it('CRITICAL: a PNG keeps its format when the budget names none — alpha survives', async () => {
    // The transparency trap. Defaulting to JPEG here would flatten every transparent
    // logo onto black, which is exactly the bug og-card exists to work around.
    const out = await compressImageFile(file('logo.png', 'image/png'), { maxEdgePx: 1200 })
    expect(out.file.type).toBe('image/png')
    expect(out.file.name).toBe('logo.png')
  })

  it('CRITICAL: PNG output does NOT walk quality — toBlob ignores it', async () => {
    // Six identical encodes converging on nothing, on the largest files we handle.
    await compressImageFile(file('logo.png', 'image/png'), { maxEdgePx: 1200, maxBytes: 400_000 })
    expect(calls.toBlob).toHaveLength(1)
    expect(calls.toBlob[0].quality).toBeUndefined()
  })

  it('walks quality down until the result fits, and reports fits', async () => {
    // Sized so a fitting quality EXISTS inside the walk's [0.5, 0.92] range — at
    // 400KB this encoder cannot fit even at the floor, which is the fits:false case
    // below, not this one.
    encodedSize = (_m, q) => Math.round((q ?? 1) * 1_000_000)
    const out = await compressImageFile(file(), { ...WEBP, maxBytes: 700_000 })
    expect(out.fits).toBe(true)
    expect(out.file.size).toBeLessThanOrEqual(700_000)
    // …and it is the WINNING encode's bytes, not the ceiling's.
    expect(out.file.size).toBeGreaterThan(500_000)
    // The winning encode is REUSED, not re-run: re-encoding it would double the work on
    // the biggest file in the flow.
    expect(calls.toBlob.length).toBeLessThanOrEqual(8)
  })

  it('CRITICAL: an incompressible image still returns a file, flagged fits:false', async () => {
    // The caller decides whether best-effort is acceptable. Returning nothing (or
    // throwing) here would stall the modal with no way forward.
    encodedSize = () => 900_000
    const out = await compressImageFile(file(), WEBP)
    expect(out.fits).toBe(false)
    expect(out.file.size).toBe(900_000)
  })

  it('with no byte ceiling it encodes once and always fits', async () => {
    encodedSize = () => 900_000
    const out = await compressImageFile(file(), { maxEdgePx: 1200, mime: 'image/webp' })
    expect(out.fits).toBe(true)
    expect(calls.toBlob).toHaveLength(1)
  })

  it('CRITICAL: releases the bitmap even when encoding throws', async () => {
    // The `finally` is the whole point: a modal the manager cancels after a failure must
    // not leak a decoded 4000px bitmap per attempt.
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return Object.create(HTMLElement.prototype)
      return { width: 0, height: 0, getContext: () => null } as unknown as HTMLElement
    }) as typeof document.createElement)
    await expect(compressImageFile(file(), WEBP)).rejects.toThrow(/canvas/i)
    expect(calls.closed).toBe(1)
  })
})
