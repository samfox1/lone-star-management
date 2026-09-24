// Reads OS/2.usWeightClass out of hand-built, minimal sfnt/WOFF buffers — no binary
// fixtures committed (AGENTS.md: fixtures should be visible next to what they test, not
// opaque binaries nobody can diff). Each builder writes exactly the bytes the reader
// needs: a table directory pointing at a 6-byte OS/2 table, nothing else.
import { describe, expect, it } from 'vitest'
import { sniffFontWeight, usableWeight, weightName } from '@/lib/font-weight'

const OS2_TAG = [0x4f, 0x53, 0x2f, 0x32] // 'O','S','/','2'

/** A minimal sfnt (TTF/OTF) container: header + one table record for 'OS/2' + the
 *  table's 6 bytes (version, xAvgCharWidth, usWeightClass). `sfntVersion` selects which
 *  of the three sniffFontWeight-recognised signatures the file claims to be. */
function buildSfnt(weight: number, sfntVersion: number): Uint8Array {
  const os2Offset = 12 + 16 // header + one table record
  const buf = new Uint8Array(os2Offset + 6)
  const view = new DataView(buf.buffer)
  view.setUint32(0, sfntVersion)
  view.setUint16(4, 1) // numTables
  view.setUint16(6, 0)
  view.setUint16(8, 0)
  view.setUint16(10, 0)
  buf.set(OS2_TAG, 12)
  view.setUint32(16, 0) // checksum, unread
  view.setUint32(20, os2Offset)
  view.setUint32(24, 6) // length
  view.setUint16(os2Offset + 0, 4) // OS/2 version
  view.setInt16(os2Offset + 2, 0) // xAvgCharWidth
  view.setUint16(os2Offset + 4, weight) // usWeightClass
  return buf
}

async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  // See the matching cast in src/lib/font-weight.ts: TS's DOM lib types
  // CompressionStream's writable side as WritableStream<BufferSource>, which its
  // invariant stream generics won't line up with ReadableStream<Uint8Array>.
  const cs = new CompressionStream('deflate') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  }).pipeThrough(cs)
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

/** A minimal WOFF 1 container wrapping the same 6-byte OS/2 table, either stored raw
 *  or zlib-deflated (WOFF's actual on-disk compression). */
async function buildWoff(weight: number, compressed: boolean): Promise<Uint8Array> {
  const os2 = new Uint8Array(6)
  const os2View = new DataView(os2.buffer)
  os2View.setUint16(0, 4)
  os2View.setInt16(2, 0)
  os2View.setUint16(4, weight)

  const tableData = compressed ? await deflateZlib(os2) : os2
  const dirOffset = 44
  const tableOffset = dirOffset + 20 // one table record
  const buf = new Uint8Array(tableOffset + tableData.length)
  const view = new DataView(buf.buffer)
  buf.set([0x77, 0x4f, 0x46, 0x46], 0) // 'wOFF'
  view.setUint32(4, 0x00010000) // flavor
  view.setUint32(8, buf.length) // length
  view.setUint16(12, 1) // numTables
  view.setUint16(14, 0)
  view.setUint32(16, 0)
  view.setUint16(20, 1)
  view.setUint16(22, 0)
  view.setUint32(24, 0)
  view.setUint32(28, 0)
  view.setUint32(32, 0)
  view.setUint32(36, 0)
  view.setUint32(40, 0)
  buf.set(OS2_TAG, dirOffset)
  view.setUint32(dirOffset + 4, tableOffset)
  view.setUint32(dirOffset + 8, tableData.length) // compLength
  view.setUint32(dirOffset + 12, os2.length) // origLength
  view.setUint32(dirOffset + 16, 0)
  buf.set(tableData, tableOffset)
  return buf
}

describe('sniffFontWeight', () => {
  it('reads usWeightClass from a TrueType sfnt (0x00010000)', async () => {
    const buf = buildSfnt(700, 0x00010000)
    expect(await sniffFontWeight(buf)).toBe(700)
  })

  it('reads usWeightClass from an OpenType/CFF sfnt (OTTO)', async () => {
    const otto = (0x4f << 24) | (0x54 << 16) | (0x54 << 8) | 0x4f
    const buf = buildSfnt(300, otto >>> 0)
    expect(await sniffFontWeight(buf)).toBe(300)
  })

  it('reads usWeightClass from an old Mac TrueType sfnt (true)', async () => {
    const trueTag = (0x74 << 24) | (0x72 << 16) | (0x75 << 8) | 0x65
    const buf = buildSfnt(200, trueTag >>> 0)
    expect(await sniffFontWeight(buf)).toBe(200)
  })

  it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
    const buf = buildSfnt(500, 0x00010000)
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    expect(await sniffFontWeight(arrayBuffer)).toBe(500)
  })

  it('reads a raw (uncompressed) WOFF 1 OS/2 table', async () => {
    const buf = await buildWoff(600, false)
    expect(await sniffFontWeight(buf)).toBe(600)
  })

  it('CRITICAL: reads a zlib-deflated WOFF 1 OS/2 table (WOFF actually compresses tables)', async () => {
    // If inflate is wired wrong (or skipped), this either throws or reads garbage
    // instead of 900 — a raw-only implementation would pass the "raw" test above and
    // silently fail every real-world WOFF, which almost always compresses OS/2.
    const buf = await buildWoff(900, true)
    expect(await sniffFontWeight(buf)).toBe(900)
  })

  it('returns null for WOFF2 (wOF2), by design', async () => {
    const buf = new Uint8Array(16)
    buf.set([0x77, 0x4f, 0x46, 0x32], 0) // 'wOF2'
    expect(await sniffFontWeight(buf)).toBeNull()
  })

  it('returns null for an unrecognised format instead of throwing', async () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(await sniffFontWeight(buf)).toBeNull()
  })

  it('returns null for a truncated/corrupt sfnt rather than throwing', async () => {
    const full = buildSfnt(400, 0x00010000)
    const truncated = full.slice(0, 14) // header claims a table the buffer doesn't hold
    await expect(sniffFontWeight(truncated)).resolves.toBeNull()
  })

  it('returns null when the file is too short to hold even a header', async () => {
    expect(await sniffFontWeight(new Uint8Array([0, 1, 2]))).toBeNull()
  })

  it('CRITICAL: a weight outside 100–900 reads as UNKNOWN, so the upload asks instead of failing', async () => {
    // The file is the manager's, not ours: OpenType allows 1–1000 and real fonts ship 950
    // (Extra Black), 1000, and garbage like 0 or a legacy 1–9 scale. The column is 100–900,
    // so passing any of these on made the upload fail ("Font weight must be between 100 and
    // 900") and delete the file. Unknown is honest; a clamp would name a weight the file
    // never said (0 → "Thin", with a false "no Bold" on the row).
    for (const w of [950, 1000, 65535, 50, 0, 5]) {
      expect(await sniffFontWeight(buildSfnt(w, 0x00010000)), `sfnt ${w}`).toBeNull()
      expect(await sniffFontWeight(await buildWoff(w, true)), `woff ${w}`).toBeNull()
    }
  })

  it('the range edges and an odd in-range value are kept as the file says them', async () => {
    for (const w of [100, 900, 350]) {
      expect(await sniffFontWeight(buildSfnt(w, 0x00010000)), `sfnt ${w}`).toBe(w)
      expect(await sniffFontWeight(await buildWoff(w, false)), `woff ${w}`).toBe(w)
    }
  })

  it('returns null when the format is recognised but has no OS/2 table', async () => {
    // sfnt header claiming zero tables.
    const buf = new Uint8Array(12)
    const view = new DataView(buf.buffer)
    view.setUint32(0, 0x00010000)
    view.setUint16(4, 0)
    expect(await sniffFontWeight(buf)).toBeNull()
  })
})

/**
 * The table walk, the bounds and the catch-all (a 2026-09-23 mutation run found every one of
 * these unwatched: each fixture above has ONE table, OS/2, first). Real fonts carry a dozen
 * tables and OS/2 is rarely first.
 */
const TAG = (t: string) => [...t].map((c) => c.charCodeAt(0))

/** An sfnt whose directory lists `tags` in order; OS/2 (if listed) points at a 6-byte
 *  table carrying `weight`. `phantom` appends one more OS/2-looking record AFTER the ones
 *  numTables counts, pointing at a table that says 700. */
function sfntWith(tags: string[], weight: number, phantom = false): Uint8Array {
  const records = tags.length + (phantom ? 1 : 0)
  const tableAt = 12 + records * 16
  const buf = new Uint8Array(tableAt + 12)
  const view = new DataView(buf.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint16(4, tags.length)
  const record = (i: number, tag: string, offset: number) => {
    buf.set(TAG(tag), 12 + i * 16)
    view.setUint32(12 + i * 16 + 8, offset)
    view.setUint32(12 + i * 16 + 12, 6)
  }
  tags.forEach((t, i) => record(i, t, t === 'OS/2' ? tableAt : 0))
  if (phantom) record(tags.length, 'OS/2', tableAt + 6)
  view.setUint16(tableAt + 4, weight)
  view.setUint16(tableAt + 6 + 4, 700)
  return buf
}

/** A WOFF 1 whose directory lists `tags`; OS/2's table is `table` stored as given
 *  (`compressed`: zlib, else raw). */
async function woffWith(tags: string[], table: Uint8Array, compressed: boolean, signature = 'wOFF'): Promise<Uint8Array> {
  const data = compressed ? await deflateZlib(table) : table
  const tableAt = 44 + tags.length * 20
  const buf = new Uint8Array(tableAt + data.length)
  const view = new DataView(buf.buffer)
  buf.set(TAG(signature), 0)
  view.setUint16(12, tags.length)
  tags.forEach((t, i) => {
    const r = 44 + i * 20
    buf.set(TAG(t), r)
    if (t !== 'OS/2') return
    view.setUint32(r + 4, tableAt)
    view.setUint32(r + 8, data.length)
    view.setUint32(r + 12, table.length)
  })
  buf.set(data, tableAt)
  return buf
}

const os2 = (weight: number, size = 6) => {
  const t = new Uint8Array(size)
  new DataView(t.buffer).setUint16(4, weight)
  return t
}

describe('sniffFontWeight — real-shaped files', () => {
  it('CRITICAL: finds OS/2 wherever it sits in the directory (sfnt and WOFF)', async () => {
    expect(await sniffFontWeight(sfntWith(['cmap', 'head', 'OS/2', 'post'], 300))).toBe(300)
    expect(await sniffFontWeight(await woffWith(['cmap', 'head', 'OS/2'], os2(600), false))).toBe(600)
    expect(await sniffFontWeight(await woffWith(['GDEF', 'OS/2'], os2(800), true))).toBe(800)
  })

  it('reads only the records the header counts — bytes after the directory are not a record', async () => {
    // numTables says 2 (no OS/2); an OS/2-shaped record sits just past them. It is table
    // data, not directory: the weight is unknown, not 700.
    expect(await sniffFontWeight(sfntWith(['cmap', 'head'], 400, true))).toBeNull()
    // The same for WOFF: a real OS/2 record, but one past the count the header gives.
    const woff = await woffWith(['head', 'OS/2'], os2(700), false)
    new DataView(woff.buffer).setUint16(12, 1)
    expect(await sniffFontWeight(woff)).toBeNull()
  })

  it('a big, deflated OS/2 table (inflated in several chunks) still reads', async () => {
    // Real OS/2 tables are ~100 bytes; this one is padded so the inflater hands it back in
    // more than one piece — the reassembly offsets are what is on trial.
    expect(await sniffFontWeight(await woffWith(['OS/2'], os2(500, 200_000), true))).toBe(500)
  })

  it('a WOFF table that claims more bytes than the file has is unknown', async () => {
    const buf = await woffWith(['OS/2'], os2(700), false)
    new DataView(buf.buffer).setUint32(44 + 8, 64) // compLength past the end
    new DataView(buf.buffer).setUint32(44 + 12, 64) // …and "stored raw"
    expect(await sniffFontWeight(buf)).toBeNull()
  })

  it('CRITICAL: a corrupt compressed table is unknown (null) — never a throw, never undefined', async () => {
    const buf = await woffWith(['OS/2'], os2(700), false)
    new DataView(buf.buffer).setUint32(44 + 12, 9999) // origLength ≠ compLength → "deflated", but it is not
    await expect(sniffFontWeight(buf)).resolves.toBeNull()
  })

  it('WOFF2 is unknown even when its bytes would parse as WOFF; so is an unknown signature', async () => {
    // "By design" is a claim about the SIGNATURE, not about the bytes failing to parse.
    for (const sig of ['wOF2', 'XXXX']) expect(await sniffFontWeight(await woffWith(['OS/2'], os2(700), false, sig)), sig).toBeNull()
  })
})

describe('usableWeight', () => {
  it('keeps a whole weight from 100 to 900, and nothing else', () => {
    expect([100, 400, 900].map(usableWeight)).toEqual([100, 400, 900])
    // A fraction reaches the column's smallint as a refusal, not a weight.
    expect([99, 901, 450.5, Number.NaN, null].map(usableWeight)).toEqual([null, null, null, null, null])
  })
})

describe('weightName', () => {
  it('names the nine standard weights exactly', () => {
    expect(weightName(100)).toBe('Thin')
    expect(weightName(200)).toBe('Extra Light')
    expect(weightName(300)).toBe('Light')
    expect(weightName(400)).toBe('Regular')
    expect(weightName(500)).toBe('Medium')
    expect(weightName(600)).toBe('Semi Bold')
    expect(weightName(700)).toBe('Bold')
    expect(weightName(800)).toBe('Extra Bold')
    expect(weightName(900)).toBe('Black')
  })

  it('rounds an odd value (a font that ships usWeightClass=350) to the nearest name', () => {
    expect(weightName(350)).toBe('Light') // equidistant from Light(300)/Regular(400)? no: 50 vs 50 -> ties favour lower
    expect(weightName(380)).toBe('Regular') // 80 vs 20 -> Regular wins outright
  })

  it('CRITICAL: 401 is Regular, not Medium (off-by-one on the boundary)', () => {
    expect(weightName(401)).toBe('Regular')
  })
})
