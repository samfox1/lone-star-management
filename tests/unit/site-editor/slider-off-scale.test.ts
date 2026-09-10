// Where a slider handle sits when the current value is not one of its steps.
/**
 * WHERE THE HANDLE SITS when the current value is not one of the slider's steps.
 *
 * Sam, 2026-08-05: "Skeen text slider starts in the middle, but when I move it one to the
 * right it gets much smaller."
 *
 * He is right and it is not a rounding wobble. skeen's hero wordmark carries
 * `text-[clamp(4rem,18vw,11rem)]` — 11rem at desktop, LARGER than the largest step this
 * editor offers (8rem). It matched no step, so the handle fell to the mid-scale resting
 * position and the first nudge right applied `4xl` (2.25rem). An 11rem headline became a
 * 2.25rem one, from a drag the manager read as "slightly bigger".
 *
 * This is not specific to size, and not specific to the hero. A site's base classes are
 * the site's OWN vocabulary — `leading-none` where our scale emits `!leading-none`,
 * `text-[12px]` on the polaroid captions, an arbitrary `tracking-[-0.04em]`. Every one of
 * those is off-scale, so every slider on every region opened at the middle regardless of
 * what the text actually looked like.
 *
 * The rule: a slider whose value it can MEASURE puts the handle at the nearest step, so
 * one notch right is always a little bigger/looser/wider than what is on screen. Only a
 * genuinely unmeasurable value falls back to the middle.
 */
import { describe, expect, it } from 'vitest'
import {
  buildStyleControls,
  buildTextItemStyleControls,
  buildItemStyleControls,
  controlsForRegion,
  readStyleValue,
  sliderIndex,
  sliderSteps,
  type StyleControl,
} from '@/lib/site-editor/style-controls'
import { clampMaxRem } from '@tests/helpers/clamp'

const OPTIONS = { fonts: [{ value: 'font-alt', label: 'Alt' }] }
const textControl = (id: string) =>
  buildTextItemStyleControls(OPTIONS).find((c) => c.id === id) as StyleControl
const itemControl = (id: string) => buildItemStyleControls().find((c) => c.id === id) as StyleControl

describe('sliderIndex — a value that is not a step', () => {
  it('CRITICAL: a size above the ceiling lands at the TOP of the scale, not the middle', () => {
    const size = textControl('size')
    const steps = sliderSteps(size)
    // skeen's own 11rem hero is an exact step now (the scale was extended for it on
    // 2026-08-05, see text-region-and-scale.test.ts), so this uses a size beyond even the
    // new ceiling. The point is what it rules out: the middle, from which one notch right
    // is a fifteen-fold shrink.
    const { idx } = sliderIndex(size, 'text-[clamp(8rem,30vw,20rem)]')
    expect(idx).toBe(steps.length - 1)
  })

  it('CRITICAL: one notch right of an off-scale value is BIGGER than that value', () => {
    // The property the manager actually experiences, asserted directly rather than via
    // an index. Walk every step's own max size and check the drag direction is honest.
    const size = textControl('size')
    const steps = sliderSteps(size)
    // A real base from skeen's polaroid captions: 12px = 0.75rem.
    const { idx } = sliderIndex(size, 'text-[12px]')
    const next = steps[Math.min(idx + 1, steps.length - 1)]
    expect(clampMaxRem(next.value)).toBeGreaterThanOrEqual(0.75)
    // and not a leap: the step below it must still be at or under where we started.
    expect(idx).toBeLessThan(3)
  })

  it('measures a legacy fixed Tailwind size', () => {
    // Rows stored before the scale went fluid hold `text-4xl`. It is off-scale now, but it
    // is 2.25rem and we know that, so the handle belongs beside the clamp whose max is
    // 2.25rem — not at the middle, and not shown as "Default".
    const size = textControl('size')
    const steps = sliderSteps(size)
    const { idx, exact } = sliderIndex(size, 'text-4xl')
    expect(exact).toBe(false)
    expect(clampMaxRem(steps[idx].value)).toBe(2.25)
  })

  it('an exact step still reports exact, so Reset stays available', () => {
    const size = textControl('size')
    const steps = sliderSteps(size)
    const { idx, exact } = sliderIndex(size, steps[4].value)
    expect({ idx, exact }).toEqual({ idx: 4, exact: true })
  })

  it('no value at all rests in the middle and reads Default', () => {
    const size = textControl('size')
    const steps = sliderSteps(size)
    const r = sliderIndex(size, '')
    expect(r.label).toBe('Default')
    expect(r.idx).toBe(Math.floor((steps.length - 1) / 2))
  })

  it('an unmeasurable value falls back to the middle rather than guessing', () => {
    const size = textControl('size')
    const steps = sliderSteps(size)
    // `text-[calc(...)]` is a size we own but cannot resolve to a number.
    const r = sliderIndex(size, 'text-[calc(1rem+2vw)]')
    expect(r.idx).toBe(Math.floor((steps.length - 1) / 2))
  })

  it('CRITICAL: line spacing measures the site’s un-important form', () => {
    // Our steps emit `!leading-none`; skeen's hero base is plain `leading-none`. Same
    // 1.0, different string — so it matched nothing and opened at 1.1, and dragging left
    // to "tighter" was the only way to reach the value already on screen.
    const leading = textControl('leading')
    const steps = sliderSteps(leading)
    const { idx } = sliderIndex(leading, 'leading-none')
    // Asserted by LABEL: the step's value changed spelling twice now (!leading-none,
    // then lead-[1.0]) while its meaning — the 1.0 position — never moved.
    expect(steps[idx].label).toBe('1.0')
  })

  it('line spacing measures an arbitrary ratio', () => {
    const leading = textControl('leading')
    const steps = sliderSteps(leading)
    // skeen's polaroid captions sit at leading-[0.95].
    expect(steps[sliderIndex(leading, 'leading-[0.95]').idx].label).toBe('0.95')
  })

  it('letter spacing measures a named step against the arbitrary scale', () => {
    const tracking = textControl('tracking')
    const steps = sliderSteps(tracking)
    // `tracking-tight` IS -0.025em, which is a step; the interesting case is a value
    // between two stops.
    expect(steps[sliderIndex(tracking, 'tracking-[-0.055em]').idx].label).toBe('-0.06')
  })

  it('thickness measures nothing off-scale because it owns only the nine named weights', () => {
    // Pinning the reasoning, not adding a rank: `owns` cannot match anything but a
    // WEIGHTS name, so an off-scale weight is unreachable. If that changes, this fails.
    const weight = textControl('weight')
    expect(weight.kind === 'slider' && weight.owns('font-[550]')).toBe(false)
  })

  it('an item slider measures an odd px value between its stops', () => {
    // Corners step by 2px; a site base of 5px is between 4 and 6.
    const radius = itemControl('radius')
    const steps = sliderSteps(radius)
    expect(steps[sliderIndex(radius, 'rounded-[5px]').idx].label).toBe('4px')
  })

  it('an item slider measures a percentage off its 5% grid', () => {
    const opacity = itemControl('opacity')
    const steps = sliderSteps(opacity)
    expect(steps[sliderIndex(opacity, 'opacity-72').idx].label).toBe('70%')
  })
})


describe('a base wearing SEVERAL owned tokens measures the LARGEST (Sam, 2026-08-17)', () => {
  // Fourth occurrence of the drag-right-shrinks bug class, this time skeen's footer:
  // its base is `… px-6 py-16 …`, first-owned measuring parked the handle at px-6
  // (24px) while the bar visibly wears 64px of vertical padding — one nudge right
  // shrank it. The general rule: with nothing SAVED, open on the largest owned value,
  // so right of the handle is bigger than everything on screen, whatever the base's
  // token order. (A saved value still wins outright — family-bearing tokens first.)
  const region = { key: 'footer', label: 'Footer', scope: 'chrome' as const }
  const pad = () => {
    const c = controlsForRegion(buildStyleControls(), region).find((x) => x.id === 'pad')!
    if (c.kind !== 'slider') throw new Error('unreachable')
    return c
  }

  it("CRITICAL: skeen's real footer base opens at 64px, not 24px", () => {
    const SKEEN_FOOTER = 'mt-auto grid content-center border-t border-border bg-background px-6 py-16 text-center'
    const c = pad()
    const { idx } = sliderIndex(c, readStyleValue(c, SKEEN_FOOTER))
    const steps = sliderSteps(c)
    expect(c.rank!(steps[idx].value)).toBeGreaterThanOrEqual(64)
    // …and the next notch right is bigger still — the property Sam keeps having to ask for.
    if (idx < steps.length - 1) {
      expect(c.rank!(steps[idx + 1].value)!).toBeGreaterThan(64)
    }
  })

  it('order does not matter: py-first and px-first bases measure the same', () => {
    const c = pad()
    expect(readStyleValue(c, 'px-6 py-16')).toBe(readStyleValue(c, 'py-16 px-6'))
  })

  it('a SAVED value still beats every base token, whatever its size', () => {
    const c = pad()
    expect(readStyleValue(c, 'px-6 py-16 pad-[8px]')).toBe('pad-[8px]')
  })
})

/**
 * MEASURED PARKING (bridge 0.25.0). The class-string rules above still leave one hole:
 * a value living in site CSS, a breakpoint, or the browser default declares NOTHING in
 * the class string, so the handle rested mid-scale and the first drag lied. Sam hit it
 * six times; the last was Line spacing (2026-08-18: "i moved right and it got smaller").
 * The frame now measures the clicked element (getComputedStyle) and the select carries
 * it — a slider with no owned token parks on the MEASURED value instead of the middle.
 */
describe('sliderIndex — measured parking (bridge 0.25.0)', () => {
  /** Narrow to the slider variant's rank — every control in this suite is a slider. */
  const rankOf = (c: StyleControl) => (c.kind === 'slider' ? c.rank! : () => null)

  const MEASURED = {
    fontSizePx: 16,
    lineHeightPx: 27.2, // 1.7 ratio — atlas's bio, the exact region Sam dragged
    letterSpacingPx: 0.64, // 0.04em
    padTopPx: 64,
    padBottomPx: 64,
    padLeftPx: 24,
    padRightPx: 24,
    gapPx: 24,
    childWidthPx: 22,
  }

  it('CRITICAL: Line spacing with NO owned token parks at the measured ratio — right drags LOOSER', () => {
    const c = textControl('leading')
    const steps = sliderSteps(c)
    const { idx, exact } = sliderIndex(c, '', MEASURED)
    expect(exact).toBe(false)
    // Parked at the nearest step to 1.7, and the next notch right is LOOSER than what
    // is on screen — the property every parking fix exists to guarantee.
    expect(rankOf(c)(steps[idx].value)!).toBeGreaterThan(1.4)
    if (idx < steps.length - 1) {
      expect(rankOf(c)(steps[idx + 1].value)!).toBeGreaterThan(1.7)
    }
  })

  it('Padding with no owned token parks at the measured inset', () => {
    const region = { key: 'footer', label: 'Footer', base: 'grid text-center', scope: 'chrome' as const }
    const c = controlsForRegion(buildStyleControls(), region).find((x) => x.id === 'pad')!
    const steps = sliderSteps(c)
    const { idx } = sliderIndex(c, '', MEASURED)
    expect(rankOf(c)(steps[idx].value)!).toBeGreaterThanOrEqual(48)
  })

  it('a STORED value still beats the measurement', () => {
    const c = textControl('leading')
    const withToken = sliderIndex(c, 'lead-[1.25]', MEASURED)
    const steps = sliderSteps(c)
    expect(rankOf(c)(steps[withToken.idx].value)).toBe(1.25)
  })

  it('no measurement (an older frame) keeps the old middle-Default fallback', () => {
    const c = textControl('leading')
    const { idx, label } = sliderIndex(c, '')
    expect(idx).toBe(Math.floor((sliderSteps(c).length - 1) / 2))
    expect(label).toBe('Default')
  })

  it("a phone twin parks from the same measurement — the frame's phone layout IS phone reality", () => {
    const phone = buildTextItemStyleControls({
      ...OPTIONS,
      styleVars: true, textVars: true, mobileVars: true, mobileTextVars: true, mobileView: true,
    } as Parameters<typeof buildTextItemStyleControls>[0]).find((c) => c.id === 'leading')!
    const steps = sliderSteps(phone)
    const { idx } = sliderIndex(phone, '', MEASURED)
    // Same rank space as the desktop control (a ratio), so the same park point.
    expect(rankOf(phone)(steps[idx].value)!).toBeGreaterThan(1.4)
  })
})
