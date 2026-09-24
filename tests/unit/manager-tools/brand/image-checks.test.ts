// Logo-upload checks on tiny, hand-built RGBA bitmaps (no canvas, no DOM — the whole
// point of image-checks.ts is to run identically in a browser and in vitest's node
// environment). Every fixture is built pixel-by-pixel below so the exact colours and
// shapes each assertion depends on are visible right next to the assertion.
import { describe, expect, it } from 'vitest'
import {
  analyzeLogo,
  removeFlatBackground,
  MIN_LOGO_EDGE_PX,
  HUGE_LOGO_BYTES,
  type LogoImage,
} from '@/lib/manager-tools/brand/image-checks'

/** Builds a bitmap from an ASCII grid: one character per pixel. `key` maps a character
 *  to an [r,g,b,a] tuple; any character not in `key` is an error (fixtures should be
 *  exhaustive, not silently defaulted). */
function grid(rows: string[], key: Record<string, [number, number, number, number]>): LogoImage {
  const height = rows.length
  const width = rows[0].length
  const data = new Uint8ClampedArray(width * height * 4)
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y} has length ${row.length}, expected ${width}`)
    ;[...row].forEach((ch, x) => {
      const rgba = key[ch]
      if (!rgba) throw new Error(`no colour mapped for '${ch}'`)
      const i = (y * width + x) * 4
      data.set(rgba, i)
    })
  })
  return { width, height, data }
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255]
const BLACK: [number, number, number, number] = [0, 0, 0, 255]

describe('analyzeLogo', () => {
  it('flags an image below the minimum edge as lowRes', () => {
    const img = grid(['WW', 'WW'], { W: WHITE })
    expect(img.width).toBeLessThan(MIN_LOGO_EDGE_PX)
    expect(analyzeLogo(img).lowRes).toBe(true)
  })

  it('does not flag an image at/above the minimum edge as lowRes', () => {
    const img: LogoImage = {
      width: MIN_LOGO_EDGE_PX,
      height: 10,
      data: new Uint8ClampedArray(MIN_LOGO_EDGE_PX * 10 * 4).fill(255),
    }
    expect(analyzeLogo(img).lowRes).toBe(false)
  })

  it('CRITICAL: flags a file over HUGE_LOGO_BYTES, not under', () => {
    const img = grid(['WW', 'WW'], { W: WHITE })
    expect(analyzeLogo(img, HUGE_LOGO_BYTES).huge).toBe(false) // exactly at the line: not huge
    expect(analyzeLogo(img, HUGE_LOGO_BYTES + 1).huge).toBe(true)
  })

  it('huge reads false when no byte size is given at all', () => {
    const img = grid(['WW', 'WW'], { W: WHITE })
    expect(analyzeLogo(img).huge).toBe(false)
  })

  it('detects a white background around a black square as flat', () => {
    // 6x6: solid white with a 2x2 black square in the middle.
    const img = grid(
      ['WWWWWW', 'WWWWWW', 'WWBBWW', 'WWBBWW', 'WWWWWW', 'WWWWWW'],
      { W: WHITE, B: BLACK },
    )
    const result = analyzeLogo(img)
    expect(result.flatBackground).toBe('#ffffff')
    expect(result.hasTransparency).toBe(false)
  })

  it('CRITICAL: a gradient border is not flat (null), not a false positive', () => {
    // Every border pixel a different grey — far enough apart that no two are within
    // FLAT_BORDER_TOLERANCE (10) of each other, let alone the whole ring.
    const img = grid(
      ['ABCDEF', 'GWWWWH', 'GWWWWH', 'GWWWWH', 'GWWWWH', 'IJKLMN'],
      {
        A: [10, 10, 10, 255],
        B: [40, 40, 40, 255],
        C: [70, 70, 70, 255],
        D: [100, 100, 100, 255],
        E: [130, 130, 130, 255],
        F: [160, 160, 160, 255],
        G: [190, 190, 190, 255],
        H: [220, 220, 220, 255],
        I: [15, 60, 15, 255],
        J: [45, 90, 45, 255],
        K: [75, 120, 75, 255],
        L: [105, 150, 105, 255],
        M: [135, 180, 135, 255],
        N: [165, 210, 165, 255],
        W: WHITE,
      },
    )
    expect(analyzeLogo(img).flatBackground).toBeNull()
  })

  it('CRITICAL: a transparent border reports hasTransparency and no flatBackground', () => {
    const TRANSPARENT: [number, number, number, number] = [255, 255, 255, 0]
    const img = grid(['TTTT', 'TBBT', 'TBBT', 'TTTT'], { T: TRANSPARENT, B: BLACK })
    const result = analyzeLogo(img)
    expect(result.hasTransparency).toBe(true)
    expect(result.flatBackground).toBeNull()
  })
})

describe('removeFlatBackground', () => {
  it('returns null when the background is not flat (mirrors analyzeLogo)', () => {
    const img = grid(
      ['ABCDEF', 'GWWWWH', 'GWWWWH', 'GWWWWH', 'GWWWWH', 'IJKLMN'],
      {
        A: [10, 10, 10, 255],
        B: [40, 40, 40, 255],
        C: [70, 70, 70, 255],
        D: [100, 100, 100, 255],
        E: [130, 130, 130, 255],
        F: [160, 160, 160, 255],
        G: [190, 190, 190, 255],
        H: [220, 220, 220, 255],
        I: [15, 60, 15, 255],
        J: [45, 90, 45, 255],
        K: [75, 120, 75, 255],
        L: [105, 150, 105, 255],
        M: [135, 180, 135, 255],
        N: [165, 210, 165, 255],
        W: WHITE,
      },
    )
    expect(removeFlatBackground(img)).toBeNull()
  })

  it('CRITICAL: makes the white background around a black square transparent, keeps the square opaque', () => {
    const img = grid(
      ['WWWWWW', 'WWWWWW', 'WWBBWW', 'WWBBWW', 'WWWWWW', 'WWWWWW'],
      { W: WHITE, B: BLACK },
    )
    const out = removeFlatBackground(img)
    expect(out).not.toBeNull()
    const alphaAt = (x: number, y: number) => out!.data[(y * out!.width + x) * 4 + 3]
    expect(alphaAt(0, 0)).toBe(0) // corner background: gone
    expect(alphaAt(2, 2)).toBe(255) // black square: untouched
    expect(alphaAt(3, 3)).toBe(255)
  })

  it('CRITICAL: a white area enclosed by a black ring stays opaque (flood never crosses the ring)', () => {
    // Outer 1px white border, then a black ring, then an inner white 3x3 pocket the
    // flood can only reach by crossing the ring — which its colour distance forbids.
    const img = grid(
      [
        'WWWWWWW',
        'WBBBBBW',
        'WBWWWBW',
        'WBWWWBW',
        'WBWWWBW',
        'WBBBBBW',
        'WWWWWWW',
      ],
      { W: WHITE, B: BLACK },
    )
    const out = removeFlatBackground(img)
    expect(out).not.toBeNull()
    const alphaAt = (x: number, y: number) => out!.data[(y * out!.width + x) * 4 + 3]
    expect(alphaAt(0, 0)).toBe(0) // outer border: cut out
    expect(alphaAt(3, 3)).toBe(255) // enclosed pocket centre: untouched
    expect(alphaAt(2, 2)).toBe(255) // enclosed pocket corner: untouched
    expect(alphaAt(1, 1)).toBe(255) // the ring itself: untouched (it's the logo)
  })

  it('gives an anti-aliased edge pixel partial alpha, neither 0 nor untouched', () => {
    // 3x3: a white ring around one blended centre pixel, sitting midway (in colour
    // distance) between the background and a hypothetical black ink — with a tolerance
    // wide enough that the centre pixel is flooded, but past the soft-edge inner
    // fraction, so it lands on the ramp rather than snapping to fully transparent.
    const BLEND: [number, number, number, number] = [140, 140, 140, 255]
    const img = grid(['WWW', 'WXW', 'WWW'], { W: WHITE, X: BLEND })
    const tolerance = 200 // distance(white, BLEND) ≈ 199.2 — inside this tolerance
    const out = removeFlatBackground(img, { tolerance })
    expect(out).not.toBeNull()
    const centreAlpha = out!.data[(1 * 3 + 1) * 4 + 3]
    expect(centreAlpha).toBeGreaterThan(0)
    expect(centreAlpha).toBeLessThan(255)
    // The pure background corners go fully transparent, for contrast with the above.
    const cornerAlpha = out!.data[0 * 4 + 3]
    expect(cornerAlpha).toBe(0)
  })
})

/**
 * The edges a 2026-09-23 mutation run found unwatched: every fixture above has a border
 * that is either all one colour or wrong in its TOP-LEFT pixel, and a background the seeds
 * reach from every side at once. These plant the fault in one place at a time.
 */
describe('the border, one fault at a time', () => {
  const W = WHITE
  const flat = (rows: string[], key: Record<string, [number, number, number, number]>) => analyzeLogo(grid(rows, key)).flatBackground

  it('CRITICAL: a wrong pixel ANYWHERE on the edge — bottom row, right column, left column, top row — is not flat', () => {
    const X: [number, number, number, number] = [200, 30, 30, 255]
    const at = (x: number, y: number) => {
      const rows = ['WWWW', 'WWWW', 'WWWW', 'WWWW'].map((r) => [...r])
      rows[y][x] = 'X'
      return rows.map((r) => r.join(''))
    }
    for (const [x, y] of [[2, 3], [3, 2], [0, 2], [2, 0]]) expect(flat(at(x, y), { W, X }), `(${x},${y})`).toBeNull()
    expect(flat(at(1, 1), { W, X }), 'inside is fine').toBe('#ffffff')
  })

  it('a pixel off by 11 in ONE channel is not flat; off by exactly 10 still is', () => {
    for (const off of [[255, 255, 244, 255], [255, 244, 255, 255], [244, 255, 255, 255]] as [number, number, number, number][])
      expect(flat(['WWW', 'WWW', 'WWO'], { W, O: off }), String(off)).toBeNull()
    expect(flat(['WWW', 'WWW', 'WWO'], { W, O: [255, 255, 245, 255] })).not.toBeNull()
  })

  it('the reported colour is the border\'s AVERAGE, per channel', () => {
    expect(flat(['CC', 'CC'], { C: [100, 150, 200, 255] })).toBe('#6496c8')
    expect(flat(['AB', 'BA'], { A: [100, 100, 100, 255], B: [106, 104, 102, 255] })).toBe('#676665')
  })

  it('opacity: 250 counts as opaque, 249 does not — for the FIRST edge pixel and for any other', () => {
    const a = (alpha: number): [number, number, number, number] => [255, 255, 255, alpha]
    expect(flat(['FWW', 'WWW', 'WWW'], { W, F: a(250) })).toBe('#ffffff')
    expect(flat(['FWW', 'WWW', 'WWW'], { W, F: a(249) })).toBeNull()
    expect(flat(['WWW', 'WWW', 'WWF'], { W, F: a(250) })).toBe('#ffffff')
    expect(flat(['WWW', 'WWW', 'WWF'], { W, F: a(249) })).toBeNull()
  })

  it('a one-pixel-wide or one-pixel-tall image still has a border to judge', () => {
    expect(flat(['W', 'W', 'W'], { W })).toBe('#ffffff')
    expect(flat(['WWW'], { W })).toBe('#ffffff')
    expect(flat(['W'], { W })).toBe('#ffffff')
  })

  it('an empty image has no background — nor does one with no width, or no height', () => {
    for (const [width, height] of [[0, 0], [0, 5], [5, 0]])
      expect(analyzeLogo({ width, height, data: new Uint8ClampedArray(0) }).flatBackground, `${width}×${height}`).toBeNull()
  })

  it('each edge pixel counts ONCE in the average — the corners too', () => {
    // 3×3 grey with one corner 10 redder: 8 edge pixels, r = (7×100 + 110) / 8 = 101.25.
    // Counting the bottom corners twice would make it (810 + 110 + 100) / 10 = 102.
    const G: [number, number, number, number] = [100, 100, 100, 255]
    const R: [number, number, number, number] = [110, 100, 100, 255]
    expect(flat(['GGG', 'GGG', 'RGG'], { G, R })).toBe('#656464')
  })
})

describe('the cut-out, one path at a time', () => {
  const alpha = (out: { width: number; data: Uint8ClampedArray } | null, x: number, y: number) => out!.data[(y * out!.width + x) * 4 + 3]

  it('CRITICAL: the flood walks a winding corridor — down, right, up, right, down, left — to its far end', () => {
    // A white ring (the seeds), an ink wall inside it with ONE gap at (2,1), and a corridor
    // behind the gap. A walk missing any one direction leaves the corridor's end opaque.
    const rows = [
      'WWWWWWWWW',
      'WK.KKKKKW',
      'WK.K...KW',
      'WK.K.K.KW',
      'WK...K.KW',
      'WKKKKK.KW',
      'WK.....KW',
      'WKKKKKKKW',
      'WWWWWWWWW',
    ].map((r) => r.replace(/\./g, 'C'))
    const out = removeFlatBackground(grid(rows, { W: WHITE, K: BLACK, C: WHITE }))
    for (const [x, y] of [[2, 1], [2, 4], [4, 4], [4, 2], [6, 2], [6, 5], [6, 6], [2, 6]]) expect(alpha(out, x, y), `(${x},${y})`).toBe(0)
    expect(alpha(out, 3, 2), 'a wall').toBe(255)
  })

  it('a pixel exactly at the tolerance is flooded THROUGH, so the pocket behind it is reached', () => {
    // (255,255,215) is exactly 40 from white. The ring of it is on the ramp (kept opaque at
    // its far end), but the flood passes it and clears the white pocket inside.
    const R: [number, number, number, number] = [255, 255, 215, 255]
    const out = removeFlatBackground(grid(['WWWWW', 'WRRRW', 'WRWRW', 'WRRRW', 'WWWWW'], { W: WHITE, R }))
    expect(alpha(out, 2, 2)).toBe(0)
  })

  it('the soft edge is exactly the ramp: a blend 199 from white at tolerance 200 keeps 253 of its alpha — its OWN alpha, not a neighbour\'s', () => {
    // inner = 80, span = 120: (199.19 - 80) / 120 = 0.9932 → round(255 × 0.9932) = 253. The
    // ink pixel just before it in memory is there so reading the wrong byte shows.
    const BLEND: [number, number, number, number] = [140, 140, 140, 255]
    const out = removeFlatBackground(grid(['WWWWW', 'WKXWW', 'WWWWW'], { W: WHITE, K: BLACK, X: BLEND }), { tolerance: 200 })
    expect(alpha(out, 2, 1)).toBe(253)
    expect(alpha(out, 1, 1)).toBe(255) // the ink (441 away) is never flooded
  })
})
