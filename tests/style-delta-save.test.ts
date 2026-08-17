/**
 * THE EDITOR WRITES DELTAS (0.24) — only what the manager changed, against the base.
 *
 * deltaFromEffective is the diff: panels keep operating on the full EFFECTIVE string
 * (controls unchanged), and the save boils it down per FAMILY. Same value as the base —
 * canonically, so `font-black` ≡ `weight-[900]` — contributes nothing; a family the
 * manager emptied against a base that had it becomes an explicit `lse-not-[fam]`.
 *
 * Reset finally means "back to the site's default": a non-toggle control applied with
 * '' RESTORES the base's family token instead of deleting the property — killing
 * CONNECTING.md rough edge #2. Toggles keep removal ('' = forced off), which the diff
 * turns into lse-not.
 */
import { describe, expect, it } from 'vitest'
import {
  applyStyleValue,
  buildStyleControls,
  deltaFromEffective,
  withStyleVars,
  type StyleControl,
} from '@/lib/site-editor/style-controls'
import { cleanClassText } from '@/lib/site-editor/save'
import { mergeStyle } from '@samfox1/site-bridge'
import { bridgeSupportsDeltas } from '@/lib/site-editor/manifest'

const BASE =
  'tour-heading font-display size-[48px] sizesm-[28px] lse-owns-[size] font-black uppercase tracking-tight text-foreground'

const byId = (controls: StyleControl[], id: string) => controls.find((c) => c.id === id)!
const NOW = withStyleVars({ fonts: [{ value: 'font-momo', label: 'Momo', css: '"Momo", serif' }] }, '0.24.0')

describe('deltaFromEffective', () => {
  it('an untouched region diffs to nothing — the row is deleted, not pinned', () => {
    expect(deltaFromEffective(BASE, BASE)).toBe('')
  })

  it('one change stores one family, sentinel-led', () => {
    const effective = BASE.replace('size-[48px]', 'size-[60px]')
    expect(deltaFromEffective(BASE, effective)).toBe('lse-delta size-[60px]')
  })

  it('canonical equivalence across eras contributes nothing', () => {
    // The base says font-black; the control re-applied the same weight as its token.
    const effective = BASE.replace('font-black', 'weight-[900]')
    expect(deltaFromEffective(BASE, effective)).toBe('')
  })

  it('an emptied family against a base that had it becomes lse-not', () => {
    const effective = BASE.replace(' uppercase', '')
    expect(deltaFromEffective(BASE, effective)).toBe('lse-delta lse-not-[case]')
  })

  it('never includes the base-kept layout or hook classes', () => {
    const effective = `${BASE} align-[center]`
    const delta = deltaFromEffective(BASE, effective)
    expect(delta).toBe('lse-delta align-[center]')
  })

  it('CRITICAL: round-trips — merging the delta back yields the effective string', () => {
    // The property everything hangs on: save(delta) then render must show exactly what
    // the manager was looking at. Canonical, since families may re-spell.
    const effective = BASE
      .replace('size-[48px]', 'size-[96px]')
      .replace('font-display', 'fontfam-[Momo,_serif]')
      .replace(' uppercase', '') + ' align-[center] sizesm-[22px]'
    const delta = deltaFromEffective(BASE, effective)
    const rendered = mergeStyle('tour_heading', BASE, delta)
    expect(deltaFromEffective(BASE, rendered)).toBe(deltaFromEffective(BASE, effective))
    expect(rendered.split(/\s+/)).toContain('tour-heading')
    expect(rendered.split(/\s+/)).toContain('lse-owns-[size]')
  })

  it('every emitted delta survives the save validator', () => {
    const delta = deltaFromEffective(BASE, BASE.replace(' uppercase', '') + ' align-[center]')
    expect(cleanClassText(delta)).not.toBeNull()
  })
})

describe("Reset restores the site's default (rough edge #2 dies)", () => {
  it("a select applied with '' brings the BASE's family token back", () => {
    const font = byId(buildStyleControls(NOW), 'font')
    // The region currently wears a picked font; Default should return font-display,
    // not strip the family (which would have been an lse-not — a forced no-font).
    const effective = BASE.replace('font-display', 'fontfam-[Momo,_serif]')
    expect(applyStyleValue(effective, font, '', BASE).split(/\s+/)).toContain('font-display')
  })

  it("a toggle applied with '' still removes — forced off is a real intent", () => {
    const upper = byId(buildStyleControls(NOW), 'uppercase')
    const out = applyStyleValue(BASE, upper, '', BASE)
    expect(out.split(/\s+/)).not.toContain('uppercase')
  })
})

describe('the gate', () => {
  it('0.24 renders deltas; older sites must keep receiving full strings', () => {
    expect(bridgeSupportsDeltas('0.24.0')).toBe(true)
    expect(bridgeSupportsDeltas('0.23.0')).toBe(false)
    expect(bridgeSupportsDeltas(undefined)).toBe(false)
  })
})
