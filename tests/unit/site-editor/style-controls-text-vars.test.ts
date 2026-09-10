/**
 * The EDITOR half of the second-wave migration: boldness, alignment, line spacing,
 * letter spacing, uppercase and italic emit VALUE tokens the bridge lifts onto
 * variables — same recipe as size/font, one bridge era later.
 *
 * The eras matter: a 0.16 site lifts `size-[…]` but has never heard of `weight-[…]`,
 * so the gates are separate. A mixed-era site gets size tokens AND weight classes,
 * which is the combination most likely to be wrong by accident — pinned below.
 */
import { describe, expect, it } from 'vitest'
import {
  applyStyleValue,
  buildStyleControls,
  buildTextItemStyleControls,
  readStyleValue,
  sameClasses,
  sliderIndex,
  sliderSteps,
  withStyleVars,
  type StyleControl,
} from '@/lib/site-editor/style-controls'
import { cleanClassText } from '@/lib/site-editor/save'
import { bridgeSupportsTextVars } from '@/lib/site-editor/manifest'

const byId = (controls: StyleControl[], id: string) => controls.find((c) => c.id === id)!

// Current-era site (0.18+): everything emits tokens.
const NOW = withStyleVars({ fonts: [] }, '0.18.0')
// Mixed era: lifts size tokens, predates the text families.
const MID = withStyleVars({ fonts: [] }, '0.16.0')

describe('token emission, current era', () => {
  it('boldness offers weight tokens, labels unchanged', () => {
    const c = byId(buildStyleControls(NOW), 'weight')
    const offered = c.kind === 'select' ? c.options : []
    expect(offered.map((o) => o.label)).toContain('Bold')
    for (const o of offered.slice(1)) expect(o.value).toMatch(/^weight-\[\d{3}\]$/)
    expect(offered.find((o) => o.label === 'Bold')!.value).toBe('weight-[700]')
  })

  it('alignment offers align tokens', () => {
    const c = byId(buildStyleControls(NOW), 'align')
    const offered = c.kind === 'select' ? c.options : []
    expect(offered.map((o) => o.value)).toEqual(['', 'align-[left]', 'align-[center]', 'align-[right]'])
  })

  it('line spacing offers lead tokens — the ! era ends', () => {
    // The class form needed Tailwind's important prefix to beat text-* utilities and
    // parent pins. Inline beats both by construction, so the token carries no `!`.
    const c = byId(buildTextItemStyleControls(NOW), 'leading')
    for (const s of sliderSteps(c)) {
      if (s.value === '') continue
      expect(s.value).toMatch(/^lead-\[\d(?:\.\d{1,3})?\]$/)
    }
  })

  it('letter spacing offers track tokens, including the negative half', () => {
    const c = byId(buildTextItemStyleControls(NOW), 'tracking')
    const values = sliderSteps(c).map((s) => s.value).filter(Boolean)
    expect(values).toContain('track-[-0.04em]')
    expect(values).toContain('track-[0.1em]')
  })

  it('the toggles write case/fstyle tokens', () => {
    const upper = byId(buildStyleControls(NOW), 'uppercase')
    const italic = byId(buildStyleControls(NOW), 'italic')
    expect(upper.kind === 'toggle' && upper.onClass).toBe('case-[uppercase]')
    expect(italic.kind === 'toggle' && italic.onClass).toBe('fstyle-[italic]')
  })

  it('every emitted value survives the save validator', () => {
    const all = [
      ...buildStyleControls(NOW),
      ...buildTextItemStyleControls(NOW),
    ]
    for (const c of all) {
      const values =
        c.kind === 'select' ? c.options.map((o) => o.value)
        : c.kind === 'slider' ? sliderSteps(c).map((s) => s.value)
        : c.kind === 'toggle' ? [c.onClass]
        : []
      for (const v of values.filter(Boolean)) {
        expect(cleanClassText(`grid ${v}`), `${c.id}: ${v}`).not.toBeNull()
      }
    }
  })
})

describe('both shapes are owned — a stored class is replaced, never stacked', () => {
  it('weight: picking a token removes a legacy class, and back', () => {
    const c = byId(buildStyleControls(NOW), 'weight')
    expect(applyStyleValue('grid font-bold', c, 'weight-[900]')).toBe('grid weight-[900]')
    const old = byId(buildStyleControls(MID), 'weight')
    expect(applyStyleValue('grid weight-[900]', old, 'font-bold')).toBe('grid font-bold')
  })

  it('alignment: token replaces text-center', () => {
    const c = byId(buildStyleControls(NOW), 'align')
    expect(applyStyleValue('grid text-center', c, 'align-[right]')).toBe('grid align-[right]')
  })

  it('leading: token replaces the !important class form', () => {
    const c = byId(buildTextItemStyleControls(NOW), 'leading')
    expect(applyStyleValue('grid !leading-tight', c, 'lead-[1.5]')).toBe('grid lead-[1.5]')
    expect(applyStyleValue('grid leading-none', c, 'lead-[1.5]')).toBe('grid lead-[1.5]')
  })

  it('tracking: token replaces both named and arbitrary classes', () => {
    const c = byId(buildTextItemStyleControls(NOW), 'tracking')
    expect(applyStyleValue('grid tracking-wide', c, 'track-[0.05em]')).toBe('grid track-[0.05em]')
    expect(applyStyleValue('grid tracking-[-0.04em]', c, 'track-[0]')).toBe('grid track-[0]')
  })

  it('uppercase: a stored legacy class still reads ON, and off removes it', () => {
    // The trap: the toggle's onClass is the token now, but half the stored strings say
    // `uppercase`. Reading only the onClass would show OFF on a plainly uppercase region,
    // and the first click would ADD the token on top.
    const c = byId(buildStyleControls(NOW), 'uppercase')
    expect(readStyleValue(c, 'grid uppercase')).toBe('on')
    expect(applyStyleValue('grid uppercase', c, '')).toBe('grid')
    expect(applyStyleValue('grid uppercase', c, 'on')).toBe('grid case-[uppercase]')
  })

  it('italic: same in both directions', () => {
    const c = byId(buildStyleControls(NOW), 'italic')
    expect(readStyleValue(c, 'grid italic')).toBe('on')
    expect(applyStyleValue('grid italic', c, 'on')).toBe('grid fstyle-[italic]')
  })
})

describe('sliders place stored values of either shape', () => {
  it('a stored weight token and its legacy class light the SAME segment', () => {
    // Weight is a button row now; canonical equivalence is what lights the segment, so
    // both eras of a stored Bold press the same button.
    const c = byId(buildTextItemStyleControls(NOW), 'weight')
    if (c.kind !== 'select' || !c.segmented) throw new Error('weight must be segmented')
    const bold = c.options.find((o) => o.label === 'Bold')!
    expect(sameClasses(bold.value, 'weight-[700]')).toBe(true)
    expect(sameClasses(bold.value, 'font-bold')).toBe(true)
  })

  it('a stored lead token lands beside its ratio', () => {
    const c = byId(buildTextItemStyleControls(NOW), 'leading')
    const r = sliderIndex(c, 'lead-[1.25]')
    expect(sliderSteps(c)[r.idx].label).toBe('1.25')
  })

  it('a stored track token lands beside its em value', () => {
    const c = byId(buildTextItemStyleControls(NOW), 'tracking')
    const r = sliderIndex(c, 'track-[-0.04em]')
    expect(sliderSteps(c)[r.idx].label).toBe('-0.04')
  })
})

describe('sameClasses spans the eras', () => {
  it('a class and its token twin read as unchanged', () => {
    // The back-to-base rule: a string equal to the region's base saves '' so the
    // override row is DELETED, never pinned (a pinned copy wins forever over later base
    // improvements — the drift problem). The base wears CLASSES; the controls now emit
    // TOKENS; without this equivalence, returning to the base pins a copy every time.
    expect(sameClasses('uppercase font-black', 'case-[uppercase] weight-[900]')).toBe(true)
    expect(sameClasses('text-center leading-none', 'align-[center] lead-[1]')).toBe(true)
    expect(sameClasses('tracking-tight', 'track-[-0.025em]')).toBe(true)
    expect(sameClasses('italic', 'fstyle-[italic]')).toBe(true)
    expect(sameClasses('text-4xl', 'size-[36px]')).toBe(true)
    // …and different MEANINGS still differ.
    expect(sameClasses('font-black', 'weight-[700]')).toBe(false)
    expect(sameClasses('uppercase', 'case-[lowercase]')).toBe(false)
  })
})

describe('the mixed era keeps classes for the new families', () => {
  it('a 0.16 site gets weight/align/leading classes, not tokens', () => {
    expect(bridgeSupportsTextVars('0.16.0')).toBe(false)
    expect(bridgeSupportsTextVars('0.18.0')).toBe(true)
    expect(bridgeSupportsTextVars(undefined)).toBe(false)

    const weight = byId(buildStyleControls(MID), 'weight')
    const offered = weight.kind === 'select' ? weight.options : []
    expect(offered.find((o) => o.label === 'Bold')!.value).toBe('font-bold')
    const upper = byId(buildStyleControls(MID), 'uppercase')
    expect(upper.kind === 'toggle' && upper.onClass).toBe('uppercase')
    const leading = byId(buildTextItemStyleControls(MID), 'leading')
    expect(sliderSteps(leading).some((s) => s.value === '!leading-tight')).toBe(true)
  })
})
