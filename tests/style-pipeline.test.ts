/**
 * The style PIPELINE, end to end: every control the editor offers must emit a token the
 * bridge actually LIFTS to real CSS — and a control must never be offered where it can't
 * take effect. This is the guard against the "control does nothing" bug class (Sam,
 * 2026-08-14: the footer's Alignment did nothing because the region wasn't flex; and
 * `pady-` did nothing on a site whose bridge couldn't lift it).
 *
 * Two halves:
 *  • LIFT MATRIX — each managed token resolves to the CSS property it promises.
 *  • CONTEXT GUARDS — controlsForRegion only offers a control where its token works.
 */
import { describe, expect, it } from 'vitest'
import { resolveRegionStyle, resolveStyle } from '@samfox1/site-bridge/styles'
import { buildStyleControls, buildItemStyleControls, controlsForRegion } from '@/lib/site-editor/style-controls'
import type { ManifestStyleRegion } from '@/lib/site-editor/manifest'

/** Resolve a region override the way a deployed site does (base baked into the override
 *  for a styled non-item region — mergeStyle returns the override). */
const regionStyle = (override: string) => resolveRegionStyle('r', '', override).style as Record<string, string>

describe('lift matrix — every managed region token becomes the CSS it promises', () => {
  const cases: [string, string, string][] = [
    // token,                     CSS key,             expected value
    ['pad-[24px]', 'padding', '24px'],
    ['gap-[48px]', 'gap', '48px'],
    ['iconsize-[28px]', '--lse-icon-size', '28px'],
    ['just-[center]', 'justifyContent', 'center'],
    ['just-[start]', 'justifyContent', 'start'],
    ['just-[end]', 'justifyContent', 'end'],
    ['secw-[60%]', 'width', '60%'],
    ['sech-[300px]', 'minHeight', '300px'],
    ['hovercolor-[#ff0000]', '--lse-hover-color', '#ff0000'],
    ['bg-[#3366cc]', 'backgroundColor', '#3366cc'],
    ['text-[#3366cc]', 'color', '#3366cc'],
  ]
  it.each(cases)('%s → %s', (token, key, expected) => {
    const style = regionStyle(token)
    expect(style[key]).toBe(expected)
    // And it does NOT survive as a dead class — the whole point of an inline lift.
    expect(resolveRegionStyle('r', '', token).className).not.toContain(token)
  })

  it('a narrowed section (secw) also centres itself (auto margins)', () => {
    const s = regionStyle('secw-[60%]')
    expect(s.marginLeft).toBe('auto')
    expect(s.marginRight).toBe('auto')
  })

  it('item tokens lift too (shape, feather, stroke)', () => {
    expect(resolveStyle('shape-circle').style.clipPath).toBeTruthy()
    expect(resolveStyle('feather-30').style.maskImage).toBeTruthy()
    expect(resolveStyle('textstroke-[0.5px]').style.WebkitTextStroke).toBe('0.5px currentColor')
  })
})

describe('no control leaves a MANAGED token unlifted (would render as a dead class)', () => {
  // The token prefixes the bridge lifts to inline style. If a control emits one of these
  // and it survives in the resolved className, it does nothing on the site — the bug.
  const MANAGED = ['pad-[', 'pady-[', 'gap-[', 'iconsize-[', 'secw-[', 'sech-[', 'just-[', 'frost-[', 'hovercolor-[', 'bggrad-[', 'textstroke-[', 'bg-[#', 'text-[#', 'border-[#']
  const sample = (control: ReturnType<typeof buildStyleControls>[number]): string | null => {
    if (control.kind === 'toggle') return control.onClass
    if (control.kind === 'select') return control.options.find((o) => o.value)?.value ?? null
    if (control.kind === 'slider') return control.steps.find((s) => s.value)?.value ?? null
    if (control.kind === 'color') return control.toToken ? control.toToken('#3366cc', '') : null
    return null
  }
  const scopes: [string, ReturnType<typeof buildStyleControls>][] = [
    ['element', buildStyleControls()],
    ['item', buildItemStyleControls()],
    ['site', controlsForRegion(buildStyleControls(), { key: 'page', label: 'Page', base: 'bg-paper', scope: 'site' })],
    ['chrome', controlsForRegion(buildStyleControls(), { key: 'bar', label: 'Bar', base: 'flex justify-center gap-4 border-t py-4 px-6', scope: 'chrome' })],
    ['icons', controlsForRegion(buildStyleControls(), { key: 'soc', label: 'Soc', base: 'flex gap-4 text-ink/60', scope: 'icons' })],
  ]
  for (const [scopeName, controls] of scopes) {
    it(`${scopeName} scope: no offered control emits a dead managed token`, () => {
      for (const control of controls) {
        const v = sample(control)
        if (!v) continue
        const token = v.split(/\s+/).find((t) => MANAGED.some((p) => t.startsWith(p)))
        if (!token) continue // control emits a compiled utility (font, size, align) — site CSS handles it
        const resolved = resolveRegionStyle('r', '', token)
        expect(resolved.className, `${scopeName}/${control.id} emitted ${token} but it was not lifted`).not.toContain(token)
        expect(Object.keys(resolved.style).length, `${scopeName}/${control.id}: ${token} lifted to no CSS`).toBeGreaterThan(0)
      }
    })
  }
})

describe('context guards — a control is only offered where its token can work', () => {
  const controls = buildStyleControls()
  const region = (base: string, scope: ManifestStyleRegion['scope']): ManifestStyleRegion => ({ key: 'r', label: 'R', base, scope })

  it('Alignment appears on a FLEX/GRID region with justify-center, and NOT on a block one', () => {
    expect(controlsForRegion(controls, region('flex justify-center', 'chrome')).some((c) => c.id === 'justify')).toBe(true)
    expect(controlsForRegion(controls, region('grid grid-cols-2 justify-center', 'chrome')).some((c) => c.id === 'justify')).toBe(true)
    // The footer bug: justify-center in a BLOCK base — the control must NOT appear.
    expect(controlsForRegion(controls, region('block justify-center text-center', 'chrome')).some((c) => c.id === 'justify')).toBe(false)
    expect(controlsForRegion(controls, region('justify-center', 'chrome')).some((c) => c.id === 'justify')).toBe(false)
  })

  it('Gap appears only on a FLEX/GRID region with a gap-* base', () => {
    expect(controlsForRegion(controls, region('flex gap-4', 'chrome')).some((c) => c.id === 'gap')).toBe(true)
    expect(controlsForRegion(controls, region('gap-4', 'chrome')).some((c) => c.id === 'gap')).toBe(false) // gap-4 without flex does nothing
    expect(controlsForRegion(controls, region('flex', 'chrome')).some((c) => c.id === 'gap')).toBe(false) // flex but no gap in base
  })

  it("a bar's intrinsic justify-between never sprouts Alignment", () => {
    expect(controlsForRegion(controls, region('flex justify-between', 'chrome')).some((c) => c.id === 'justify')).toBe(false)
  })
})
