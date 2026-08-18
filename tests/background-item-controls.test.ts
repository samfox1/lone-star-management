/**
 * The BACKGROUND image control set (Sam, 2026-08-18): "if an image is being used as a
 * background, there doesnt need to be certain editable tools like edges or borders …
 * you can zoom in, but the zoom out shouldn't be available because then it would cover
 * the background." Chosen by the slot's manifest `background: true` (bridge 0.25.1).
 */
import { describe, expect, it } from 'vitest'
import {
  buildBackgroundItemStyleControls,
  buildItemStyleControls,
  sliderSteps,
} from '@/lib/site-editor/style-controls'

describe('buildBackgroundItemStyleControls', () => {
  const controls = buildBackgroundItemStyleControls()
  const ids = controls.map((c) => c.id)

  it('CRITICAL: offers NO frame tools — border, corners, shadow, matte, shape, feather, crop, tilt', () => {
    for (const banned of ['borderWidth', 'borderColor', 'radius', 'shadow', 'pad', 'shape', 'feather', 'tilt']) {
      expect(ids, `${banned} has no meaning on a frameless fill`).not.toContain(banned)
    }
    // …while the normal image set still has them, so this is a real reduction.
    const imageIds = buildItemStyleControls().map((c) => c.id)
    expect(imageIds).toContain('borderWidth')
    expect(imageIds).toContain('radius')
  })

  it('CRITICAL: Zoom floors at 100% — a background can never zoom OUT', () => {
    const zoom = controls.find((c) => c.id === 'size')!
    expect(zoom.label).toBe('Zoom')
    const steps = sliderSteps(zoom)
    expect(steps.length).toBeGreaterThan(1) // zooming IN still works
    for (const s of steps) {
      const pct = zoom.kind === 'slider' ? zoom.rank!(s.value)! : NaN
      expect(pct, `${s.value} would uncover the page behind the background`).toBeGreaterThanOrEqual(100)
    }
  })

  it('keeps what a background can honestly use: transparency and the photo filters', () => {
    expect(ids).toContain('opacity')
    expect(ids).toContain('brightness') // representative filter — the set rides filterControls()
  })
})

/**
 * MEASURE-ON-OPEN parking (bridge 0.25.2). Sam, 2026-08-18: "The transparency slider
 * isnt lined up properly, same error as before." An item's real opacity/zoom lives in
 * site code — invisible to the class string — and a panel-opened editor has no frame
 * click to carry a measurement, so the editor now ASKS the frame and parks on the answer.
 */
import { sliderIndex } from '@/lib/site-editor/style-controls'

describe('item sliders park on measured reality', () => {
  const MEASURED = {
    fontSizePx: 16, lineHeightPx: null, letterSpacingPx: 0,
    padTopPx: 0, padBottomPx: 0, padLeftPx: 0, padRightPx: 0,
    gapPx: null, childWidthPx: null,
    opacity: 0.4, transformScale: null, borderWidthPx: 0, radiusPx: 12,
  }
  const item = (id: string) => buildItemStyleControls().find((c) => c.id === id)!

  it("CRITICAL: Transparency with nothing stored parks at the element's real 40%", () => {
    const c = item('opacity')
    const steps = sliderSteps(c)
    const { idx, exact } = sliderIndex(c, '', MEASURED)
    expect(exact).toBe(false)
    expect(c.kind === 'slider' && c.rank!(steps[idx].value)).toBe(40)
    // …and one notch right is MORE opaque than what is on screen.
    expect(c.kind === 'slider' && c.rank!(steps[idx + 1].value)!).toBeGreaterThan(40)
  })

  it('an untransformed image parks Zoom/Size at 100%, not mid-scale', () => {
    const c = item('size')
    const steps = sliderSteps(c)
    const { idx } = sliderIndex(c, '', MEASURED)
    expect(c.kind === 'slider' && c.rank!(steps[idx].value)).toBe(100)
  })

  it('Corners park at the measured radius', () => {
    const c = item('radius')
    const steps = sliderSteps(c)
    const { idx } = sliderIndex(c, '', MEASURED)
    expect(c.kind === 'slider' && c.rank!(steps[idx].value)).toBe(12)
  })

  it("an OLDER frame (no item fields) keeps the old '' behaviour — the 100% step", () => {
    // Opacity's scale encodes 100% as the empty class, so with no measurement an unset
    // item parks fully opaque — true for a normal image, and exactly the pre-0.25.2 rule.
    const c = item('opacity')
    const { opacity: _o, transformScale: _t, borderWidthPx: _b, radiusPx: _r, ...old } = MEASURED
    const steps = sliderSteps(c)
    const { idx, exact } = sliderIndex(c, '', old)
    expect(exact).toBe(true)
    expect(steps[idx].label).toBe('100%')
  })

  it('a STORED value still beats the measurement', () => {
    const c = item('opacity')
    const steps = sliderSteps(c)
    const { idx } = sliderIndex(c, 'opacity-80', MEASURED)
    expect(c.kind === 'slider' && c.rank!(steps[idx].value)).toBe(80)
  })
})
