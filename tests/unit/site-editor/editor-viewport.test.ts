/**
 * The editor frame's viewport maths (S4). The frame renders the site at a real
 * desktop width and scales it down, so the manager edits the layout a desktop
 * visitor actually sees — not the tablet layout a ~900px iframe would trigger.
 */
import { describe, expect, it } from 'vitest'
import { CANVAS_WIDTH, DEVICE_OPTIONS, fitViewport, isPhone, zoomLabel, type Device } from '@/lib/site-editor/viewport'

describe('fitViewport — desktop', () => {
  it('gives the SITE a 1440px viewport even in a narrow panel, and scales to fit', () => {
    const v = fitViewport('desktop', 900, 800)
    expect(v.width).toBe(1440) // what the site's media queries see
    expect(v.scale).toBeCloseTo(900 / 1440) // 0.625
    expect(v.renderedWidth).toBeCloseTo(900) // fills the panel exactly
  })

  it('makes the canvas TALLER as it scales down, so it still fills the panel', () => {
    // Otherwise a scaled-down canvas would occupy only 62% of the height and sit
    // in a letterbox. The site should see a plausible desktop window: 1440x1280.
    const v = fitViewport('desktop', 900, 800)
    expect(v.height).toBeCloseTo(800 / v.scale)
    expect(v.renderedHeight).toBe(800)
  })

  it('never scales UP past 1:1 in a panel wider than the canvas', () => {
    const v = fitViewport('desktop', 2000, 900)
    expect(v.scale).toBe(1)
    expect(v.width).toBe(1440)
    expect(v.renderedWidth).toBe(1440) // centered by the wrapper, not stretched
  })
})

describe('fitViewport — mobile', () => {
  it('keeps a phone canvas at 390 and does not stretch it to the panel', () => {
    const v = fitViewport('mobile', 900, 800)
    expect(v.width).toBe(CANVAS_WIDTH.mobile)
    expect(v.scale).toBe(1)
    expect(v.renderedWidth).toBe(390)
  })

  it('scales a phone down only when the panel is narrower than the phone', () => {
    const v = fitViewport('mobile', 300, 800)
    expect(v.scale).toBeCloseTo(300 / 390)
    expect(v.renderedWidth).toBeCloseTo(300)
  })
})

describe('fitViewport — first paint', () => {
  it('returns a safe zero box before the panel has been measured', () => {
    // The ResizeObserver has not fired yet; dividing by a 0 box would put NaN into
    // the style attributes and the frame would never render.
    for (const v of [fitViewport('desktop', 0, 0), fitViewport('desktop', 900, 0)]) {
      expect(Number.isFinite(v.height)).toBe(true)
      expect(Number.isFinite(v.scale)).toBe(true)
      expect(v.renderedHeight).toBe(0)
    }
  })
})

describe('zoomLabel', () => {
  it('reads as a percentage', () => {
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(0.625)).toBe('63%')
  })
})


describe('the device menu (Sam, 2026-08-21: more phones)', () => {
  it('CRITICAL: every canvas width is offered — a device nobody can pick is not a device', () => {
    // Derived from CANVAS_WIDTH, so adding a width without a menu entry fails HERE
    // rather than being discovered by not finding it in the dropdown.
    expect(DEVICE_OPTIONS.map((d) => d.value).sort()).toEqual(Object.keys(CANVAS_WIDTH).sort())
  })

  it('CRITICAL: every PHONE canvas is phone-scoped — a phone edit cannot depend on which phone', () => {
    // The mobile style twins (`--lse-*-m`) key off isPhone, never off one device name.
    // One phone today (Sam, 2026-08-21); when a second width returns, it must be a phone
    // here too or editing there would silently write DESKTOP values.
    for (const d of Object.keys(CANVAS_WIDTH) as Device[]) {
      expect(isPhone(d), d).toBe(CANVAS_WIDTH[d] < 700)
    }
  })
})
