// An artist's logos, and how the main one is framed and baked into a favicon.
/**
 * Brand: the artist's logos, and how the primary one is framed into a favicon.
 *
 * A favicon is a static image file — there is no CSS at display time, so the framing has
 * to be BAKED IN. The Brand page draws the logo into a canvas the manager can zoom and
 * nudge, and saves exactly what that canvas shows. This module is the maths behind both
 * the preview and the saved file, which is what makes "what you see is the file you get"
 * true rather than merely intended: one function drives both.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FRAMING,
  FAVICON_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
  cleanFraming,
  drawFavicon,
  faviconDrawBox,
} from '@/lib/brand'

const wide = { width: 1000, height: 200 } // a wordmark
const square = { width: 400, height: 400 }
const tall = { width: 200, height: 1000 }

describe('faviconDrawBox — where the logo lands on a square canvas', () => {
  const S = 100 // a round canvas size keeps the arithmetic readable

  it('at rest, CONTAINS the whole logo — you see all of it before you crop', () => {
    // Contain, not cover: the manager should start from the whole mark and zoom IN to
    // the part they want, rather than starting from an arbitrary crop.
    const box = faviconDrawBox(wide, DEFAULT_FRAMING, S)
    expect(box.width).toBe(100) // limited by the wide side
    expect(box.height).toBe(20)
    expect(box.x).toBe(0)
    expect(box.y).toBe(40) // vertically centred: (100 - 20) / 2
  })

  it('a square logo fills the canvas exactly at rest', () => {
    expect(faviconDrawBox(square, DEFAULT_FRAMING, S)).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('a tall logo is limited by its height and centred horizontally', () => {
    const box = faviconDrawBox(tall, DEFAULT_FRAMING, S)
    expect(box.height).toBe(100)
    expect(box.width).toBe(20)
    expect(box.x).toBe(40)
    expect(box.y).toBe(0)
  })

  it('zoom scales about the centre — the logo grows, it does not drift sideways', () => {
    const box = faviconDrawBox(wide, { zoom: 2, offsetY: 0 }, S)
    expect(box.width).toBe(200)
    expect(box.height).toBe(40)
    expect(box.x).toBe(-50) // (100 - 200) / 2 — overflow is symmetric, so it stays centred
    expect(box.y).toBe(30)
  })

  it('offsetY nudges vertically, as a fraction of the canvas — resolution-independent', () => {
    // The preview is 32px and the saved file is larger; a fraction means the manager's
    // nudge lands in the same PLACE in both, which a pixel offset would not.
    const down = faviconDrawBox(square, { zoom: 1, offsetY: 0.25 }, S)
    const up = faviconDrawBox(square, { zoom: 1, offsetY: -0.25 }, S)
    expect(down.y).toBe(25)
    expect(up.y).toBe(-25)
    expect(down.x).toBe(up.x) // vertical control only — nothing moves horizontally
  })

  it('scales with the canvas, so preview and saved file agree', () => {
    const small = faviconDrawBox(wide, { zoom: 1.5, offsetY: 0.1 }, 32)
    const large = faviconDrawBox(wide, { zoom: 1.5, offsetY: 0.1 }, 320)
    expect(large.width).toBeCloseTo(small.width * 10)
    expect(large.x).toBeCloseTo(small.x * 10)
    expect(large.y).toBeCloseTo(small.y * 10)
  })

  it('survives a zero-dimension image rather than dividing by zero', () => {
    const box = faviconDrawBox({ width: 0, height: 0 }, DEFAULT_FRAMING, S)
    expect(Number.isFinite(box.width)).toBe(true)
    expect(Number.isFinite(box.height)).toBe(true)
  })
})

describe('cleanFraming — what may be stored', () => {
  it('passes a sane framing through', () => {
    expect(cleanFraming({ zoom: 1.5, offsetY: -0.2 })).toEqual({ zoom: 1.5, offsetY: -0.2 })
  })

  it('falls back to the default for junk, so a bad row can never break the tab icon', () => {
    expect(cleanFraming(null)).toEqual(DEFAULT_FRAMING)
    expect(cleanFraming('nope')).toEqual(DEFAULT_FRAMING)
    expect(cleanFraming({ zoom: NaN, offsetY: NaN })).toEqual(DEFAULT_FRAMING)
    expect(cleanFraming({})).toEqual(DEFAULT_FRAMING)
  })

  it('clamps zoom to a usable range', () => {
    expect(cleanFraming({ zoom: 99, offsetY: 0 }).zoom).toBe(ZOOM_MAX)
    expect(cleanFraming({ zoom: 0, offsetY: 0 }).zoom).toBe(ZOOM_MIN)
    expect(cleanFraming({ zoom: -3, offsetY: 0 }).zoom).toBe(ZOOM_MIN)
  })

  it('clamps the nudge so the logo can never be pushed entirely out of frame', () => {
    expect(cleanFraming({ zoom: 1, offsetY: 5 }).offsetY).toBeLessThanOrEqual(1)
    expect(cleanFraming({ zoom: 1, offsetY: -5 }).offsetY).toBeGreaterThanOrEqual(-1)
  })
})

describe('drawFavicon — the preview and the export share one code path', () => {
  /** A canvas context stub that records what it was asked to do. */
  function fakeCtx() {
    const calls: { op: string; args: unknown[] }[] = []
    return {
      calls,
      ctx: {
        clearRect: (...args: unknown[]) => calls.push({ op: 'clearRect', args }),
        drawImage: (...args: unknown[]) => calls.push({ op: 'drawImage', args }),
      } as unknown as CanvasRenderingContext2D,
    }
  }

  const img = { width: 1000, height: 200 } as unknown as CanvasImageSource & { width: number; height: number }

  it('clears BEFORE drawing — a transparent logo must not smear across frames', () => {
    // Without the clear, dragging the zoom slider leaves every previous frame behind,
    // because a PNG logo's transparent pixels paint nothing over the old ones.
    const { ctx, calls } = fakeCtx()
    drawFavicon(ctx, img, DEFAULT_FRAMING, 100)
    expect(calls.map((c) => c.op)).toEqual(['clearRect', 'drawImage'])
    expect(calls[0].args).toEqual([0, 0, 100, 100])
  })

  it('draws at exactly the box faviconDrawBox computes', () => {
    const framing = { zoom: 2, offsetY: 0.1 }
    const { ctx, calls } = fakeCtx()
    drawFavicon(ctx, img, framing, 100)
    const box = faviconDrawBox(img, framing, 100)
    expect(calls[1].args).toEqual([img, box.x, box.y, box.width, box.height])
  })

  it('draws nothing but the clear when the image has no size', () => {
    const { ctx, calls } = fakeCtx()
    drawFavicon(ctx, { width: 0, height: 0 } as never, DEFAULT_FRAMING, 100)
    expect(calls.map((c) => c.op)).toEqual(['clearRect'])
  })
})

describe('the saved favicon size', () => {
  it('is bigger than the 32px tab, so one file also serves the home-screen icon', () => {
    expect(FAVICON_SIZE).toBeGreaterThanOrEqual(180)
  })
})
