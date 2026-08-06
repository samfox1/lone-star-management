/**
 * The DOM half of asset compression: decode → downscale → re-encode. Client-only —
 * everything pure (verdicts, geometry, the quality walk) lives in asset-budget.ts, the
 * same split og-card keeps between geometry and drawing.
 */
import { fitWithinEdge, walkQuality, type AssetBudget } from '@/lib/site-editor/asset-budget'

/**
 * The file's longest edge in pixels, or undefined when it cannot be decoded. Orientation
 * comes from EXIF (`from-image`) — without it every sideways phone photo would measure,
 * and later upload, rotated.
 */
export async function decodeEdgePx(file: File): Promise<number | undefined> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const edge = Math.max(bmp.width, bmp.height)
    bmp.close()
    return edge
  } catch {
    return undefined
  }
}

export type CompressedImage = {
  /** Ready to upload: original name with the new extension, typed to the new mime. */
  file: File
  width: number
  height: number
  /** False when even the lowest acceptable quality missed maxBytes — the caller decides
   *  whether best-effort is good enough to offer. */
  fits: boolean
}

/** `photo.HEIC.jpg` → `photo.HEIC.webp`: the stored name keeps the original's stem so
 *  the media library stays recognisable; only the bytes and extension change. */
function renamed(name: string, mime: string): string {
  const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg'
  const stem = name.replace(/\.[^.]+$/, '')
  return `${stem}.${ext}`
}

/**
 * Downscale to the budget's edge and re-encode under its byte ceiling.
 *
 * The canvas starts fully transparent and webp/png carry alpha, so a transparent logo
 * survives — this is deliberately NOT og-card's pipeline, which fills its background
 * first because an og card must be opaque. PNG output skips the quality walk entirely:
 * PNG is lossless and `toBlob` ignores the quality argument for it, so walking would be
 * six wasted encodes converging on nothing.
 */
export async function compressImageFile(file: File, budget: AssetBudget): Promise<CompressedImage> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = fitWithinEdge(bmp.width, bmp.height, budget.maxEdgePx)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable in this browser.')
    ctx.drawImage(bmp, 0, 0, width, height)

    const mime = budget.mime ?? (file.type === 'image/png' ? 'image/png' : 'image/jpeg')
    const encodeAt = (quality?: number) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), mime, quality)
      })

    let blob: Blob
    let fits: boolean
    if (mime === 'image/png' || budget.maxBytes == null) {
      blob = await encodeAt()
      fits = budget.maxBytes == null || blob.size <= budget.maxBytes
    } else {
      // Cache each probe's blob so the walk's winner is reused rather than re-encoded.
      const byQuality = new Map<number, Blob>()
      const walk = await walkQuality(async (q) => {
        const b = await encodeAt(q)
        byQuality.set(q, b)
        return b.size
      }, budget.maxBytes)
      blob = byQuality.get(walk.quality)!
      fits = walk.fits
    }

    return {
      file: new File([blob], renamed(file.name, mime), { type: mime }),
      width,
      height,
      fits,
    }
  } finally {
    bmp.close()
  }
}
