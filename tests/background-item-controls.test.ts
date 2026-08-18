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
