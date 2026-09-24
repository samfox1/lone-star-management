/**
 * Reads the designed weight out of a font FILE, rather than trusting a filename ("Bold"
 * in the name, Regular in the bytes) or an upload form field. TTF/OTF and WOFF 1 store
 * it as `usWeightClass` in the `OS/2` table — this walks the sfnt/WOFF table directory
 * far enough to find that table and nothing else, so it works on partial trust: a
 * corrupt or exotic font reads as "unknown" (null), never throws into the upload flow.
 *
 * WOFF2 packs its whole table directory through a shared Brotli stream (not one table
 * at a time like WOFF 1), which needs a real decoder this module deliberately doesn't
 * pull in — so WOFF2 always reads null, and the Brand page's own upload flow asks the
 * user for the weight instead (see BRAND_PAGE_PLAN.md, Fonts).
 */

const OS2_TAG = 'OS/2'

function tag4(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

/** Runs bytes through the platform's `deflate` (zlib-wrapped) decoder — available as a
 *  global in browsers and Node 18+, so this module needs no compression dependency. */
async function inflateZlib(input: Uint8Array): Promise<Uint8Array> {
  // DOM lib types DecompressionStream's writable side as WritableStream<BufferSource>,
  // which TS's invariant stream generics won't line up with ReadableStream<Uint8Array>
  // even though every real runtime's DecompressionStream happily accepts a Uint8Array —
  // this cast is that mismatch, not a behaviour change.
  const ds = new DecompressionStream('deflate') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input)
      controller.close()
    },
  }).pipeThrough(ds)
  const reader = readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** `usWeightClass` from a table-directory format shared by TTF/OTF (`sfnt`): a 12-byte
 *  header (version, numTables, …), then `numTables` 16-byte records of (tag, checksum,
 *  offset, length). */
function weightFromSfntTables(view: DataView, buf: Uint8Array): number | null {
  const numTables = view.getUint16(4)
  for (let i = 0; i < numTables; i++) {
    const recOffset = 12 + i * 16
    if (recOffset + 16 > buf.length) return null
    if (tag4(view, recOffset) !== OS2_TAG) continue
    const tableOffset = view.getUint32(recOffset + 8)
    if (tableOffset + 6 > buf.length) return null
    return view.getUint16(tableOffset + 4)
  }
  return null
}

/** WOFF 1's own 44-byte header, then `numTables` 20-byte records of (tag, offset,
 *  compLength, origLength, origChecksum). Each table is stored either raw
 *  (`compLength === origLength`) or zlib-deflated. */
async function weightFromWoffTables(view: DataView, buf: Uint8Array): Promise<number | null> {
  const numTables = view.getUint16(12)
  for (let i = 0; i < numTables; i++) {
    const recOffset = 44 + i * 20
    if (recOffset + 20 > buf.length) return null
    if (tag4(view, recOffset) !== OS2_TAG) continue
    const offset = view.getUint32(recOffset + 4)
    const compLength = view.getUint32(recOffset + 8)
    const origLength = view.getUint32(recOffset + 12)
    if (offset + compLength > buf.length) return null
    const raw = buf.subarray(offset, offset + compLength)
    const tableBytes = compLength === origLength ? raw : await inflateZlib(raw)
    if (tableBytes.length < 6) return null
    const tableView = new DataView(tableBytes.buffer, tableBytes.byteOffset, tableBytes.byteLength)
    return tableView.getUint16(4)
  }
  return null
}

/** The weights a font row can hold: CSS's 100–900 scale, the `artist_fonts.weight` CHECK. */
export const MIN_FONT_WEIGHT = 100
export const MAX_FONT_WEIGHT = 900

/**
 * A weight read off a file, or null when it is outside 100–900.
 *
 * UNKNOWN, NOT CLAMPED (2026-09-23). OpenType allows 1–1000, and the files people upload
 * say 950 (Extra Black), 1000, 0, or a legacy 1–9 scale. Handed on as they are, the
 * column's CHECK refused the row and the upload deleted the file ("Font weight must be
 * between 100 and 900"). A clamp would keep the row but invent the answer — 0 would become
 * "Thin" with a red "no Bold", 5 on the old scale (a Medium) the same — and the weight is
 * only there to tell the manager something true. Unknown makes the upload dialog ASK, the
 * same path a WOFF2 takes; asking costs one click, a wrong name on the row costs trust.
 */
export function usableWeight(n: number | null): number | null {
  return n !== null && Number.isInteger(n) && n >= MIN_FONT_WEIGHT && n <= MAX_FONT_WEIGHT ? n : null
}

/**
 * `OS/2.usWeightClass` (100–900) from a TTF/OTF or WOFF 1 file, or null when the format
 * is WOFF2, unrecognised, too short/corrupt to read safely, or says a weight outside
 * 100–900 (`usableWeight`).
 */
export async function sniffFontWeight(bytes: ArrayBuffer | Uint8Array): Promise<number | null> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (buf.length < 12) return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const sig = view.getUint32(0, false)
  const tag = tag4(view, 0)
  try {
    if (sig === 0x00010000 || tag === 'OTTO' || tag === 'true') {
      return usableWeight(weightFromSfntTables(view, buf))
    }
    if (tag === 'wOFF') {
      return usableWeight(await weightFromWoffTables(view, buf))
    }
    // 'wOF2' (WOFF2) and anything else: unsupported, not an error.
    return null
  } catch {
    return null
  }
}

/** [weight, name] pairs in CSS/OpenType's standard scale, used to name the nearest
 *  class to whatever `usWeightClass` actually holds (fonts occasionally ship odd values
 *  like 350 or 550). Order matters for ties: `weightName` keeps the FIRST match, so an
 *  exact tie (e.g. 650, equidistant from 600 and 700) favours the lower standard name. */
const WEIGHT_NAMES: ReadonlyArray<readonly [number, string]> = [
  [100, 'Thin'],
  [200, 'Extra Light'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semi Bold'],
  [700, 'Bold'],
  [800, 'Extra Bold'],
  [900, 'Black'],
]

/** The standard weight name nearest `n`, for display next to a font row's sample. */
export function weightName(n: number): string {
  let best = WEIGHT_NAMES[0]
  let bestDistance = Math.abs(n - best[0])
  for (const entry of WEIGHT_NAMES) {
    const distance = Math.abs(n - entry[0])
    if (distance < bestDistance) {
      best = entry
      bestDistance = distance
    }
  }
  return best[1]
}
