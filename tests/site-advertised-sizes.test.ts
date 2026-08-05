/**
 * A SITE DECIDES WHICH SIZES IT CAN RENDER.
 *
 * Three times on 2026-08-05 the editor offered a size the site could not compile. Tailwind
 * only builds classes it can see, so a step this repo invented lands on the element, has no
 * CSS behind it, and the text does not move. The manager drags, nothing happens, and
 * nothing anywhere reports a problem — the worst shape a bug can take.
 *
 * The cause was structural, not careless. Two lists in two repositories: `SIZE_OPTIONS`
 * here, an `@source inline(…)` block over there. Nothing connected them, so every step
 * added here silently broke until someone noticed the slider doing nothing.
 *
 * So the site advertises its own scale in the manifest, and the editor offers exactly
 * that. A size the site cannot render is now unreachable rather than merely discouraged.
 *
 * The built-in scale remains the fallback — a site that advertises nothing (an older skeen
 * build, or lone-star's own templates) keeps working exactly as before.
 */
import { describe, expect, it } from 'vitest'
import {
  buildStyleControls,
  buildTextItemStyleControls,
  sliderSteps,
  type SiteStyleOptions,
} from '@/lib/site-editor/style-controls'

const sizeOf = (controls: ReturnType<typeof buildStyleControls>) =>
  controls.find((c) => c.id === 'size')!

/** A site with a deliberately SHORT scale, so "did it use these?" cannot be confused with
 *  "did it use the built-in ones?" — the two differ in length as well as in content. */
const SITE: SiteStyleOptions = {
  fonts: [{ value: 'font-alt', label: 'Alt' }],
  textSizes: [
    { value: 'text-[clamp(1rem,3vw,1.25rem)]', label: 'Small' },
    { value: 'text-[clamp(2rem,8vw,3.75rem)]', label: 'Big' },
    { value: 'text-[clamp(4rem,18vw,11rem)]', label: 'Hero' },
  ],
}

describe('the size scale a site advertises', () => {
  it('CRITICAL: the text editor offers the SITE’s sizes, not this repo’s', () => {
    const steps = sliderSteps(sizeOf(buildTextItemStyleControls(SITE)))
    expect(steps.map((s) => s.value)).toEqual(SITE.textSizes!.map((s) => s.value))
  })

  it('CRITICAL: so does the Style panel', () => {
    // Two builders, one rule. The Style panel is how a SECTION gets sized, and it was
    // reading the built-in list too.
    const options = sizeOf(buildStyleControls(SITE)).kind === 'select'
      ? (sizeOf(buildStyleControls(SITE)) as { options: { value: string }[] }).options
      : []
    // Default first, then the site's own — and nothing else.
    expect(options.map((o) => o.value)).toEqual(['', ...SITE.textSizes!.map((s) => s.value)])
  })

  it('CRITICAL: a site that advertises nothing keeps the built-in scale', () => {
    // Older skeen builds announce no sizes, and lone-star's own templates never will.
    // Falling through to an empty scale would leave those managers with no Size control at
    // all — a worse failure than the one this fixes.
    const steps = sliderSteps(sizeOf(buildTextItemStyleControls({ fonts: [] })))
    expect(steps.length).toBeGreaterThan(10)
    expect(steps.every((s) => /^text-\[clamp\(/.test(s.value))).toBe(true)
  })

  it('an EMPTY advertised list is treated as "not advertised", not as "no sizes"', () => {
    // A site mid-migration can announce `textSizes: []`. Honouring that literally would
    // render a slider with nothing on it.
    const steps = sliderSteps(sizeOf(buildTextItemStyleControls({ textSizes: [] })))
    expect(steps.length).toBeGreaterThan(10)
  })

  it('the advertised sizes are still OWNED, so picking one replaces the last', () => {
    // The control owns any text size by SHAPE, not by membership of its own list — which
    // is what lets it replace a site's own base class. Worth pinning here: if `owns` were
    // ever narrowed to the offered list, an advertised size would stack on top of the base
    // instead of replacing it, and source order would decide which won.
    const control = sizeOf(buildTextItemStyleControls(SITE))
    for (const s of SITE.textSizes!) expect(control.owns(s.value), s.value).toBe(true)
  })

  it('a site can advertise a size this repo has never heard of', () => {
    // The whole point. The site is the authority on what it can render, so the editor must
    // not filter its list against a local one.
    const exotic: SiteStyleOptions = { textSizes: [{ value: 'text-[42vmin]', label: 'Huge' }] }
    const steps = sliderSteps(sizeOf(buildTextItemStyleControls(exotic)))
    expect(steps.map((s) => s.value)).toEqual(['text-[42vmin]'])
  })
})
