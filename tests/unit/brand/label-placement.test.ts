// Where a Brand hover label goes: its preferred side and alignment, unless that would leave
// the screen or the scroll box it sits in (Sam, 2026-09-23: the icon editor's "Upload new"
// was cut off by the modal body's top edge).
/**
 * placeLabel is pure: the anchor's rect, the chip's size, the viewport and the nearest
 * clipping ancestor's rect in; a side and a fixed-position top/left out. What has to hold:
 *   - the preferred side and alignment when they fit;
 *   - FLIP to the other side when the preferred one would leave the viewport OR the clip
 *     rect, and when neither fits, the side with more room;
 *   - SHIFT sideways to stay inside both (the kit link at the page's right edge, the
 *     eraser at the modal's right edge), never past the left edge;
 *   - not shown at all when the anchor itself has scrolled out of the clip rect.
 */
import { describe, expect, it } from 'vitest'
import { LABEL_GAP, LABEL_MARGIN, placeLabel, type Box } from '@/app/artists/[id]/(dashboard)/brand/_ui/label-placement'

const VIEW = { width: 1440, height: 900 }
const SIZE = { width: 120, height: 24 }
/** A 36px control at (x, y). */
const at = (x: number, y: number, s = 36): Box => ({ left: x, top: y, right: x + s, bottom: y + s })

describe('placeLabel — the preference, when it fits', () => {
  it('below: gap under the anchor, centred on it', () => {
    const p = placeLabel({ anchor: at(600, 400), size: SIZE, viewport: VIEW, side: 'bottom', align: 'center' })
    expect(p).toEqual({ side: 'bottom', top: 436 + LABEL_GAP, left: 618 - 60, visible: true })
  })

  it('above: gap over the anchor', () => {
    const p = placeLabel({ anchor: at(600, 400), size: SIZE, viewport: VIEW, side: 'top', align: 'center' })
    expect(p.side).toBe('top')
    expect(p.top).toBe(400 - LABEL_GAP - SIZE.height)
  })

  it('start lines the chip up with the anchor\'s left edge, end with its right', () => {
    expect(placeLabel({ anchor: at(600, 400), size: SIZE, viewport: VIEW, side: 'bottom', align: 'start' }).left).toBe(600)
    expect(placeLabel({ anchor: at(600, 400), size: SIZE, viewport: VIEW, side: 'bottom', align: 'end' }).left).toBe(636 - 120)
  })
})

describe('placeLabel — flipping', () => {
  it('CRITICAL: above would leave the VIEWPORT → below', () => {
    const p = placeLabel({ anchor: at(600, 10), size: SIZE, viewport: VIEW, side: 'top', align: 'center' })
    expect(p.side).toBe('bottom')
    expect(p.top).toBe(46 + LABEL_GAP)
  })

  it('CRITICAL: above would leave the CLIP rect (the icon editor\'s + at the top of the modal body) → below', () => {
    // The body scrolls from y=120; the + sits 4px under its top edge. Above, the chip would
    // be drawn over the header — the body clips it there, and so it must not go there.
    const body: Box = { top: 120, left: 400, right: 1040, bottom: 700 }
    const p = placeLabel({ anchor: at(430, 124), size: SIZE, viewport: VIEW, clip: body, side: 'top', align: 'center' })
    expect(p.side).toBe('bottom')
    expect(p.top).toBe(160 + LABEL_GAP)
  })

  it('CRITICAL: below would leave the viewport or the clip rect → above', () => {
    expect(placeLabel({ anchor: at(600, 860), size: SIZE, viewport: VIEW, side: 'bottom', align: 'center' }).side).toBe('top')
    const body: Box = { top: 100, left: 0, right: 1440, bottom: 500 }
    expect(placeLabel({ anchor: at(600, 450), size: SIZE, viewport: VIEW, clip: body, side: 'bottom', align: 'center' }).side).toBe('top')
  })

  it('neither side fits: the side with more room', () => {
    const squat: Box = { top: 100, left: 0, right: 1440, bottom: 170 }
    // 26px of room above the anchor, none below: above wins, even though below was preferred.
    const p = placeLabel({ anchor: at(600, 130), size: SIZE, viewport: VIEW, clip: squat, side: 'bottom', align: 'center' })
    expect(p.side).toBe('top')
    // And the other way round, it keeps to the roomier side too.
    const q = placeLabel({ anchor: at(600, 104), size: SIZE, viewport: VIEW, clip: squat, side: 'top', align: 'center' })
    expect(q.side).toBe('bottom')
  })
})

describe('placeLabel — shifting sideways', () => {
  it('CRITICAL: a centred chip at the viewport\'s right edge shifts left to stay on screen', () => {
    const p = placeLabel({ anchor: at(1400, 60), size: SIZE, viewport: VIEW, side: 'bottom', align: 'center' })
    expect(p.left + SIZE.width).toBe(VIEW.width - LABEL_MARGIN)
  })

  it('CRITICAL: …and at the left edge shifts right', () => {
    const p = placeLabel({ anchor: at(2, 60), size: SIZE, viewport: VIEW, side: 'bottom', align: 'center' })
    expect(p.left).toBe(LABEL_MARGIN)
  })

  it('CRITICAL: stays inside the CLIP rect too (the eraser at the modal body\'s right edge)', () => {
    const body: Box = { top: 100, left: 400, right: 800, bottom: 700 }
    const p = placeLabel({ anchor: at(760, 600), size: { width: 140, height: 24 }, viewport: VIEW, clip: body, side: 'top', align: 'center' })
    expect(p.left + 140).toBe(800 - LABEL_MARGIN)
    const q = placeLabel({ anchor: at(402, 600), size: { width: 140, height: 24 }, viewport: VIEW, clip: body, side: 'top', align: 'center' })
    expect(q.left).toBe(400 + LABEL_MARGIN)
  })

  it('a chip wider than the room starts at the left edge rather than past it', () => {
    const body: Box = { top: 100, left: 400, right: 480, bottom: 700 }
    const p = placeLabel({ anchor: at(420, 300), size: SIZE, viewport: VIEW, clip: body, side: 'top', align: 'center' })
    expect(p.left).toBe(400 + LABEL_MARGIN)
  })

  it('a clip rect larger than the viewport does not let the chip off screen', () => {
    const tall: Box = { top: -500, left: -100, right: 2000, bottom: 3000 }
    const p = placeLabel({ anchor: at(1420, 870, 16), size: SIZE, viewport: VIEW, clip: tall, side: 'bottom', align: 'center' })
    expect(p.side).toBe('top')
    expect(p.left + SIZE.width).toBe(VIEW.width - LABEL_MARGIN)
  })
})

describe('placeLabel — an anchor out of sight', () => {
  it('CRITICAL: not shown when the anchor has scrolled out of its clip rect; shown while any of it is in', () => {
    const body: Box = { top: 100, left: 0, right: 1440, bottom: 500 }
    expect(placeLabel({ anchor: at(600, 520), size: SIZE, viewport: VIEW, clip: body, side: 'top', align: 'center' }).visible).toBe(false)
    expect(placeLabel({ anchor: at(600, 40), size: SIZE, viewport: VIEW, clip: body, side: 'top', align: 'center' }).visible).toBe(false)
    expect(placeLabel({ anchor: at(600, 480), size: SIZE, viewport: VIEW, clip: body, side: 'top', align: 'center' }).visible).toBe(true)
  })
})

/**
 * The exact edges (a 2026-09-23 mutation run left each one unwatched). Two survivors there
 * are EQUIVALENT and stay: `other` — whenever the preferred side misses and the other side
 * fits, the other side also has more room, so the "more room" rule gives the same answer
 * and the whole `fits[other]` step could go; and `>=`/`<=` in the two sideways clamps,
 * where equality assigns the value `left` already has.
 */
describe('placeLabel — exact edges', () => {
  const clip = { top: 100, left: 100, right: 700, bottom: 500 }
  const place = (anchor: Box, side: 'top' | 'bottom' = 'top', align: 'center' | 'start' | 'end' = 'center') =>
    placeLabel({ anchor, size: SIZE, viewport: VIEW, clip, side, align })

  it('a chip that ends exactly at the margin fits, above and below; one pixel more does not', () => {
    const topFits = clip.top + LABEL_MARGIN + SIZE.height + LABEL_GAP // anchor.top at which "above" just fits
    expect(place(at(300, topFits), 'top').side).toBe('top')
    expect(place(at(300, topFits - 1), 'top').side).toBe('bottom')
    const bottomFits = clip.bottom - LABEL_MARGIN - SIZE.height - LABEL_GAP - 36 // anchor.top at which "below" just fits
    expect(place(at(300, bottomFits), 'bottom').side).toBe('bottom')
    expect(place(at(300, bottomFits + 1), 'bottom').side).toBe('top')
  })

  it('neither side fits and the room is equal: below', () => {
    // A 400px-tall anchor filling the clip box's middle: 0 room above and below it.
    const tall = { left: 300, right: 336, top: clip.top + LABEL_MARGIN, bottom: clip.bottom - LABEL_MARGIN }
    expect(place(tall, 'top').side).toBe('bottom')
  })

  it('sideways, the chip keeps the MARGIN from the room\'s edges', () => {
    expect(place(at(clip.right - 36, 300), 'top', 'start').left).toBe(clip.right - LABEL_MARGIN - SIZE.width)
    expect(place(at(clip.left, 300), 'top', 'end').left).toBe(clip.left + LABEL_MARGIN)
  })

  it('an anchor that only TOUCHES the room, on any side, is not in it', () => {
    const s = 36
    const touching: [string, Box][] = [
      ['above', { left: 300, right: 300 + s, top: clip.top - s, bottom: clip.top }],
      ['below', { left: 300, right: 300 + s, top: clip.bottom, bottom: clip.bottom + s }],
      ['left of', { left: clip.left - s, right: clip.left, top: 300, bottom: 300 + s }],
      ['right of', { left: clip.right, right: clip.right + s, top: 300, bottom: 300 + s }],
    ]
    for (const [where, anchor] of touching) expect(place(anchor).visible, where).toBe(false)
    // One pixel in, on each side, and it is shown.
    const inside: Box[] = [
      { left: 300, right: 300 + s, top: clip.top - s + 1, bottom: clip.top + 1 },
      { left: 300, right: 300 + s, top: clip.bottom - 1, bottom: clip.bottom - 1 + s },
      { left: clip.left - s + 1, right: clip.left + 1, top: 300, bottom: 300 + s },
      { left: clip.right - 1, right: clip.right - 1 + s, top: 300, bottom: 300 + s },
    ]
    for (const anchor of inside) expect(place(anchor).visible).toBe(true)
  })
})
