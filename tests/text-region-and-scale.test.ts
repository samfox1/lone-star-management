/**
 * TWO faults Sam hit on 2026-08-05, both about the Text panel offering the wrong thing.
 *
 * 1. "the tour text is not for the TOUR header like it should be. When I increase the size
 *    it increases the height of the container."
 *
 *    It was not the TOUR heading. It was skeen's `shows_section` — the whole section
 *    WRAPPER, `relative z-10 mx-auto w-full max-w-6xl bg-background px-6 pb-24 pt-16
 *    text-center`. The panel listed it as text because it carried `text-center`, and the
 *    old detector counted any `text-*` as evidence of type. Setting a size on a wrapper
 *    sets font-size on everything inside it, which is exactly why the section got taller.
 *
 *    Alignment and colour describe words; they do not SET TYPE, and every section
 *    container on skeen carries one of them. Only a family, a size, a weight, tracking,
 *    leading or a casing means "this element is the words".
 *
 * 2. "The header text needs to start at a bigger size and be able to be a bigger size."
 *
 *    The scale topped out at 8rem. skeen's hero is 11rem. So the largest size the editor
 *    could offer was SMALLER than what the hero already was — every drag was a shrink, and
 *    there was no way back up. A scale whose ceiling is below the thing it styles is not a
 *    scale.
 */
import { describe, expect, it } from 'vitest'
import { isTextRegion, textPanelEntries } from '@/lib/site-editor/text-panel'
import { buildTextItemStyleControls, sliderIndex, sliderSteps } from '@/lib/site-editor/style-controls'
import type { ManifestStyleRegion } from '@/lib/site-editor/manifest'
import { clampMaxRem, clampMinRem, stepCss } from './helpers/clamp'

/** skeen's real bases, verbatim from its lib/styles.ts. Copied rather than imported (it is
 *  another repo), so each is quoted in full and can be re-checked by eye against source. */
const SKEEN: Record<string, string> = {
  hero_wordmark: 'fx-glitch-mono font-alt text-[clamp(4rem,18vw,11rem)] font-black uppercase leading-none',
  hero_video: 'absolute inset-0 h-full w-full object-cover',
  hero_nav: 'absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-10 py-3 sm:gap-20 sm:py-4',
  shows_section: 'relative z-10 mx-auto w-full max-w-6xl bg-background px-6 pb-24 pt-16 text-center',
  work_section: 'relative z-0 bg-background text-foreground',
  about_section: 'relative z-10 overflow-hidden bg-background text-foreground',
  polaroid_wall: 'mx-auto flex max-w-[1400px] flex-wrap items-start justify-center gap-x-8 px-6',
  polaroid_1_caption:
    'flex items-center justify-center px-2 text-center font-alt text-[12px] font-semibold leading-[0.95] tracking-[-0.04em] text-black sm:text-[14px]',
  videos_section: 'relative z-0 bg-background',
  footer: 'mt-auto border-t border-border px-6 py-16 text-center',
  footer_socials: 'mt-8 flex flex-wrap items-center justify-center gap-6',
}
const region = (key: string): ManifestStyleRegion => ({ key, label: key, base: SKEEN[key] })

describe('isTextRegion — a wrapper is not the words', () => {
  it('CRITICAL: a section container that only CENTRES text is not text', () => {
    // The one Sam styled. Sizing it grew the whole section.
    expect(isTextRegion(region('shows_section'))).toBe(false)
  })

  it('CRITICAL: a section container that only COLOURS text is not text', () => {
    expect(isTextRegion(region('work_section'))).toBe(false)
    expect(isTextRegion(region('about_section'))).toBe(false)
  })

  it('the footer wrapper is not text either', () => {
    expect(isTextRegion(region('footer'))).toBe(false)
  })

  it('CRITICAL: the wordmark and the captions still ARE text', () => {
    // The other half of the rule. Tightening the detector must not empty the panel.
    expect(isTextRegion(region('hero_wordmark'))).toBe(true)
    expect(isTextRegion(region('polaroid_1_caption'))).toBe(true)
  })

  it('layout and media regions stay out, as before', () => {
    for (const key of ['hero_video', 'hero_nav', 'polaroid_wall', 'videos_section', 'footer_socials'])
      expect(isTextRegion(region(key)), key).toBe(false)
  })

  it('a size behind a responsive variant still counts as type', () => {
    // `sm:text-[14px]` is the only type utility on a region that sets its base size
    // elsewhere. Reading tokens without stripping the variant would miss it.
    expect(isTextRegion({ key: 'x', label: 'x', base: 'block sm:text-[14px]' })).toBe(true)
  })

  it('an arbitrary text COLOUR is not a size, however it is written', () => {
    // `text-[#fff]` shares the arbitrary-value shape with `text-[12px]`. Counting it would
    // put the section wrappers straight back in the panel via a different door.
    expect(isTextRegion({ key: 'x', label: 'x', base: 'block text-[#ffffff]' })).toBe(false)
  })

  it('CRITICAL: regions ALONE list nothing — the Text panel is fields', () => {
    // `isTextRegion` still decides which region can PAIR with a field (and so carry that
    // row's type controls), but a region no field speaks for is no longer a row of its
    // own: it filled the panel with "Set by the site — restyle only" lines that are not
    // text to type (Sam, 2026-08-15). Those elements stay reachable by clicking them.
    expect(textPanelEntries([], Object.keys(SKEEN).map(region))).toEqual([])
  })

  it('CRITICAL: a field still PAIRS with its text region, so the row keeps its type controls', () => {
    // The positive half. Without it, a function that returned [] for everything would
    // pass the rule above and empty the Text panel completely.
    const regions = Object.keys(SKEEN).map(region)
    const field = { key: 'hero_wordmark', label: 'Hero wordmark', type: 'text' as const, target: { store: 'site_content' as const, key: 'hero_wordmark' } }
    const [entry] = textPanelEntries([field], regions)
    expect(entry.key).toBe('hero_wordmark')
    expect(entry.styleRegion?.key).toBe('hero_wordmark')
  })
})

describe('the size scale reaches past what the site already uses', () => {
  const size = buildTextItemStyleControls({ fonts: [] }).find((c) => c.id === 'size')!
  const steps = sliderSteps(size)

  it('CRITICAL: the ceiling is above skeen’s 11rem hero, so it can grow', () => {
    // The complaint: "needs to be able to be a bigger size". At 8rem the biggest offer was
    // a 27% shrink.
    expect(clampMaxRem(steps[steps.length - 1].value)).toBeGreaterThan(11)
  })

  it('CRITICAL: the hero’s own size is a step, so the handle opens ON it', () => {
    const { idx, exact } = sliderIndex(size, 'text-[clamp(4rem,18vw,11rem)]')
    expect(clampMaxRem(steps[idx].value)).toBe(11)
    // NOT exact, since the migration to value tokens (2026-08-16): this string is the
    // SITE's base, not something the manager set, and `exact` is what gates Reset. There
    // is nothing of theirs to clear yet. Once they pick a size it stores `size-[176px]`,
    // which is a step literally — asserted below.
    expect(exact).toBe(false)
    expect(sliderIndex(size, steps[idx].value).exact).toBe(true)
  })

  it('there is room to drag UP from the hero, not just down', () => {
    // "start at a bigger size AND be able to be a bigger size" — a handle pinned to the
    // last step satisfies neither.
    const { idx } = sliderIndex(size, 'text-[clamp(4rem,18vw,11rem)]')
    expect(steps.length - 1 - idx).toBeGreaterThanOrEqual(3)
  })

  it('every step still ascends, and every one is a clamp', () => {
    // Pinned here as well as in text-tools-styling: adding six steps by hand is exactly
    // where a transposed digit would go unnoticed.
    for (const s of steps) expect(stepCss(s.value), s.label).toMatch(/^clamp\([\d.]+rem,[\d.]+vw,[\d.]+rem\)$/)
    const maxes = steps.map((s) => clampMaxRem(s.value))
    for (let i = 1; i < maxes.length; i++) expect(maxes[i], steps[i].label).toBeGreaterThan(maxes[i - 1])
    // The mobile floor must ascend too, or a bigger choice could render SMALLER on a phone.
    const mins = steps.map((s) => clampMinRem(s.value))
    for (let i = 1; i < mins.length; i++) expect(mins[i], steps[i].label).toBeGreaterThanOrEqual(mins[i - 1])
  })

  it('every step stays fluid: the floor is genuinely below the ceiling', () => {
    // A clamp whose min equals its max is a fixed size wearing a costume, and would run
    // off a phone exactly like the old text-4xl did.
    for (const s of steps) {
      const [, min, , max] = /clamp\(([\d.]+)rem,([\d.]+)vw,([\d.]+)rem\)/.exec(stepCss(s.value))!.map(Number) as unknown as number[]
      expect(min, s.label).toBeLessThan(max)
    }
  })
})
