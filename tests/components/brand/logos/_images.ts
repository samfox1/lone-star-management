/**
 * Decoded-image fakes for the logo editor's tests: `{ width, height, data }` exactly as
 * `getImageData` returns them, so lib/image-checks.ts (which the tests do NOT mock) runs
 * its real maths on them. jsdom has no canvas; these stand in for what the browser decode
 * would have produced.
 */
import type { LogoImage } from '@/lib/image-checks'

type RGBA = [number, number, number, number]

function paint(size: number, at: (x: number, y: number) => RGBA): LogoImage {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data.set(at(x, y), (y * size + x) * 4)
  return { width: size, height: size, data }
}

const inMiddle = (size: number, x: number, y: number) => x >= size / 4 && x < (size * 3) / 4 && y >= size / 4 && y < (size * 3) / 4

/** A dark mark on an opaque, perfectly flat background — the "white box" logo. */
export function flatLogo(size = 40, bg: RGBA = [255, 255, 255, 255]): LogoImage {
  return paint(size, (x, y) => (inMiddle(size, x, y) ? [17, 17, 17, 255] : bg))
}

/** The same mark on an opaque GRADIENT: the edge is not one colour, so no cut-out. */
export function noisyLogo(size = 40): LogoImage {
  return paint(size, (x, y) => (inMiddle(size, x, y) ? [17, 17, 17, 255] : [Math.round((x / size) * 255), 90, Math.round((y / size) * 255), 255]))
}

/** A mark that already has transparency around it — nothing to say about a background. */
export function transparentLogo(size = 40): LogoImage {
  return paint(size, (x, y) => (inMiddle(size, x, y) ? [17, 17, 17, 255] : [0, 0, 0, 0]))
}

/** Alpha at a pixel. */
export const alphaAt = (img: LogoImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]

/** A picked PNG file, as the file input hands it over. */
export function pngFile(name = 'logo.png', bytes = 2048): File {
  const f = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}
