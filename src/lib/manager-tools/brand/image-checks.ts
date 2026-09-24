/**
 * Logo upload checks for the Brand page's logo editor modal — pure pixel maths on a
 * decoded bitmap, no DOM. The caller decodes the file (canvas in the browser) and hands
 * over `{ width, height, data }`; that split is what lets these run in vitest's node
 * environment AND in the browser off the same code, the same way asset-budget.ts keeps
 * geometry separate from compress-image.ts's canvas calls.
 */
import { clamp, canonicalHex, rgbToHex } from '@/lib/color'

/** A decoded bitmap: `data` is RGBA, four bytes per pixel, row-major — the same shape
 *  `CanvasRenderingContext2D.getImageData().data` returns. */
export type LogoImage = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export type LogoAnalysis = {
  lowRes: boolean
  /** '#rrggbb' when the border is one opaque colour, else null. */
  flatBackground: string | null
  hasTransparency: boolean
  huge: boolean
}

/**
 * Below this on the longer edge, a logo reads fuzzy wherever the dashboard or a site
 * enlarges it (merch mockups, a hero-sized mark) and is already short of the 180px an
 * iOS home-screen icon wants once any zoom/crop is applied on top. 500px gives real
 * headroom above that without flagging ordinary small exported marks as broken.
 */
export const MIN_LOGO_EDGE_PX = 500

/**
 * Above this many bytes, a browser tab is uploading megabytes for what is ultimately a
 * favicon-sized or letterhead-sized use. 8MB is comfortably above any legitimately
 * flat, vector-exported logo we've seen and below what a manager's laptop uploads by
 * accident (an unresized phone screenshot or a print-res TIFF re-saved as PNG).
 */
export const HUGE_LOGO_BYTES = 8 * 1024 * 1024

/**
 * How far a border pixel may drift from the border's reference colour (Euclidean RGB
 * distance; max possible is ~441) and still count as "the same flat colour". Kept
 * tight because this gates whether the UI OFFERS the one-click background cut-out at
 * all — a false positive here would silently botch a real photo or gradient border.
 */
export const FLAT_BORDER_TOLERANCE = 10

/** A border pixel below this alpha is already see-through — that's "the logo already
 *  has transparency", not "a flat colour to cut out" — so flat-background detection
 *  requires the border to be this opaque. */
export const MIN_OPAQUE_ALPHA = 250

/**
 * Flood-fill colour-distance radius used by `removeFlatBackground`, deliberately wider
 * than `FLAT_BORDER_TOLERANCE`. The border itself is checked to be near-perfectly
 * uniform (that's what qualifies it as "flat"), but the ring of pixels just inside it is
 * anti-aliased — part background colour, part logo colour — and sits farther from the
 * pure background colour than the border does. This tolerance is loose enough to reach
 * those blended pixels; `SOFT_EDGE_INNER_FRACTION` below is what stops it from also
 * eating a pale logo edge outright.
 */
export const DEFAULT_CUTOUT_TOLERANCE = 40

/**
 * Below this fraction of the tolerance, a flood-filled pixel is "clearly background"
 * and goes fully transparent. Between it and the tolerance, alpha ramps linearly down
 * to 0 as the pixel gets closer to the background colour — that ramp is the soft edge
 * an anti-aliased boundary needs; a hard cutoff at the tolerance radius would leave a
 * visible stair-step ring around the cut-out logo.
 */
const SOFT_EDGE_INNER_FRACTION = 0.4

function pixelAt(img: LogoImage, x: number, y: number) {
  const i = (y * img.width + x) * 4
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2], a: img.data[i + 3] }
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

/** The perimeter pixels of the bitmap, one ring thick — what "the border" means for
 *  every check in this module. */
function* borderCoords(width: number, height: number): Generator<{ x: number; y: number }> {
  for (let x = 0; x < width; x++) {
    yield { x, y: 0 }
    if (height > 1) yield { x, y: height - 1 }
  }
  for (let y = 1; y < height - 1; y++) {
    yield { x: 0, y }
    if (width > 1) yield { x: width - 1, y }
  }
}

/** The border's colour if it is one opaque, near-uniform colour, else null. Shared by
 *  `analyzeLogo` (report it) and `removeFlatBackground` (refuse to run without it). */
function detectFlatBorder(img: LogoImage): string | null {
  const { width, height } = img
  if (width < 1 || height < 1) return null
  const coords = [...borderCoords(width, height)]
  if (coords.length === 0) return null
  const first = pixelAt(img, coords[0].x, coords[0].y)
  if (first.a < MIN_OPAQUE_ALPHA) return null
  let rSum = first.r
  let gSum = first.g
  let bSum = first.b
  for (let idx = 1; idx < coords.length; idx++) {
    const p = pixelAt(img, coords[idx].x, coords[idx].y)
    if (p.a < MIN_OPAQUE_ALPHA) return null
    if (colorDistance(p.r, p.g, p.b, first.r, first.g, first.b) > FLAT_BORDER_TOLERANCE) return null
    rSum += p.r
    gSum += p.g
    bSum += p.b
  }
  const n = coords.length
  return rgbToHex(rSum / n, gSum / n, bSum / n)
}

/** Flags an uploaded logo needs a warning for: too small, a flat background it could
 *  offer to cut out, existing transparency, or a suspiciously large file. `bytes` is
 *  the original upload size; omit it (e.g. re-analysing an already-stored image) and
 *  `huge` reads false rather than guessing. */
export function analyzeLogo(img: LogoImage, bytes?: number): LogoAnalysis {
  const lowRes = Math.max(img.width, img.height) < MIN_LOGO_EDGE_PX
  const huge = bytes != null && bytes > HUGE_LOGO_BYTES
  let hasTransparency = false
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] < 255) {
      hasTransparency = true
      break
    }
  }
  return { lowRes, flatBackground: detectFlatBorder(img), hasTransparency, huge }
}

export type CutoutResult = {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * Makes the background transparent — but only the part of it connected to the image's
 * edge (a 4-connected flood fill seeded from the border). A same-coloured area fully
 * enclosed by the logo's own ink (inside a ring, a loop of a letterform) is never
 * reached by that flood and is left exactly as uploaded.
 *
 * Returns null when the border isn't one flat opaque colour (the same test
 * `analyzeLogo`'s `flatBackground` uses) — the UI is expected to have already checked
 * that and to say so instead of calling this at all.
 */
export function removeFlatBackground(img: LogoImage, opts?: { tolerance?: number }): CutoutResult | null {
  const bg = detectFlatBorder(img)
  if (!bg) return null
  const full = canonicalHex(bg)
  if (!full) return null
  const bgR = parseInt(full.slice(1, 3), 16)
  const bgG = parseInt(full.slice(3, 5), 16)
  const bgB = parseInt(full.slice(5, 7), 16)

  const tolerance = opts?.tolerance ?? DEFAULT_CUTOUT_TOLERANCE
  const innerTolerance = tolerance * SOFT_EDGE_INNER_FRACTION
  const span = tolerance - innerTolerance

  const { width, height, data } = img
  const out = new Uint8ClampedArray(data)
  const visited = new Uint8Array(width * height)

  const distanceToBg = (x: number, y: number): number => {
    const i = (y * width + x) * 4
    return colorDistance(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB)
  }

  const softenAlpha = (x: number, y: number, distance: number) => {
    const i = (y * width + x) * 4
    const origAlpha = out[i + 3]
    const factor = span <= 0 ? 0 : clamp((distance - innerTolerance) / span, 0, 1)
    out[i + 3] = Math.round(origAlpha * factor)
  }

  const queue: Array<{ x: number; y: number }> = []
  for (const { x, y } of borderCoords(width, height)) {
    const idx = y * width + x
    if (visited[idx]) continue
    const d = distanceToBg(x, y)
    if (d <= tolerance) {
      visited[idx] = 1
      queue.push({ x, y })
    }
  }

  const neighbours = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  while (queue.length > 0) {
    const { x, y } = queue.pop()!
    softenAlpha(x, y, distanceToBg(x, y))
    for (const [dx, dy] of neighbours) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const nIdx = ny * width + nx
      if (visited[nIdx]) continue
      const d = distanceToBg(nx, ny)
      if (d <= tolerance) {
        visited[nIdx] = 1
        queue.push({ x: nx, y: ny })
      }
    }
  }

  return { width, height, data: out }
}
