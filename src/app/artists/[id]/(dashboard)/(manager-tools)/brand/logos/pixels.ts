import type { LogoImage } from '@/lib/manager-tools/brand/image-checks'

/**
 * The canvas half of the logo checks: a file in, RGBA pixels out, and back again as a PNG.
 * `lib/image-checks.ts` does the maths on plain arrays; this module is the only part that
 * needs a browser, which is why it is its own file — the component tests swap it for
 * decoded-image fakes (jsdom has no canvas), and the maths they then run is the real one.
 */

/** Past this many pixels a decode is skipped rather than risk a tab's memory: an RGBA
 *  copy of a 16-megapixel image is 64MB, and the gate has already downscaled any logo
 *  bigger than the site needs, so only a pathological file gets here. */
const MAX_DECODE_PIXELS = 4096 * 4096

/** Decode an image file into RGBA pixels. Null when the browser cannot (an unsupported
 *  format, a corrupt file, no canvas) — the modal then shows no warnings, never an error. */
export async function decodeLogo(file: Blob): Promise<LogoImage | null> {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = bitmap
    if (width < 1 || height < 1 || width * height > MAX_DECODE_PIXELS) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const data = ctx.getImageData(0, 0, width, height)
    return { width: data.width, height: data.height, data: data.data }
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

/**
 * Fetch a logo that is ALREADY stored and decode it, the same way an upload is — so the
 * editor can check a logo the moment it opens, not only right after an upload. Returns the
 * pixels and the file's size in bytes (the "very large file" check needs it).
 *
 * The file comes from the PUBLIC media bucket, which answers CORS with
 * `Access-Control-Allow-Origin: *` (checked 2026-09-23, GET and preflight), so a CORS-mode
 * fetch may read its bytes. Where it cannot (a bucket that stops sending the header, no
 * network), this returns null and the editor says nothing — never a guessed warning.
 */
export async function loadStoredLogo(url: string): Promise<{ image: LogoImage; bytes: number } | null> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (!res.ok) return null
    const blob = await res.blob()
    const image = await decodeLogo(blob)
    return image ? { image, bytes: blob.size } : null
  } catch {
    return null
  }
}

/** Encode RGBA pixels as a PNG (the one format here that keeps the cut-out's alpha). */
export async function encodePng(img: LogoImage): Promise<Blob | null> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  }
}

/** An object URL for a blob, or null where the browser has none (a test DOM). */
export function objectUrl(blob: Blob): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
}

export function revokeUrl(url: string): void {
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}
