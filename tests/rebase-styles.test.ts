/**
 * `rebase` — folding a site's CURRENT base classes back into an override the manager
 * wrote against an older one.
 *
 * The trap it exists for (skeen's footer, 2026-08-15): a section override REPLACES the
 * base, so the stored string is frozen at whatever the design looked like when it was
 * written. The footer's base later gained `grid content-center` and `bg-background`; the
 * stored override had neither, so the contents stayed pinned to the top and the colour
 * picker read "none" — both of Sam's reports, one cause.
 *
 * The rule being pinned: pick up what the manager never touched, never overwrite what
 * they chose.
 */
import { describe, expect, it } from 'vitest'
import { rebaseOverride as rebase } from '@/lib/site-editor/rebase-override'
import { buildStyleControls, controlsForRegion, type StyleControl } from '@/lib/site-editor/style-controls'
import type { ManifestStyleRegion } from '@/lib/site-editor/manifest'

const SKEEN = buildStyleControls({
  fonts: [],
  textColors: [{ value: 'text-muted', label: 'Warm gray', hex: '#a8a39b' }],
  bgColors: [{ value: 'bg-background', label: 'Black', hex: '#0a0a0a' }],
})
const controlsFor = (base: string, scope?: string): StyleControl[] =>
  controlsForRegion(SKEEN, { key: 'footer', label: 'Footer bar', base, scope } as ManifestStyleRegion)

const FOOTER_BASE = 'mt-auto grid content-center border-t border-border bg-background px-6 py-16 text-center'

describe('rebase', () => {
  it('CRITICAL: picks up LAYOUT the manager never touched, and could not have removed', () => {
    // Skeen's real stored footer, verbatim. `grid content-center` is owned by no control,
    // so its absence can only mean "added to the base after this was saved".
    const stored = 'mt-auto border-border text-center border-t pad-[52px] sech-[448px]'
    const next = rebase(FOOTER_BASE, stored, controlsFor(FOOTER_BASE, 'chrome'))!
    expect(next).toContain('grid')
    expect(next).toContain('content-center')
  })

  it('CRITICAL: a colour the manager never set IS filled in from the design', () => {
    // "Not set" on a colour is a gap, not a decision to remove it. skeen's footer was
    // always meant to be bg-background; the override simply predated the declaration.
    const stored = 'mt-auto border-border text-center border-t pad-[52px] sech-[448px]'
    expect(rebase(FOOTER_BASE, stored, controlsFor(FOOTER_BASE, 'chrome'))).toContain('bg-background')
  })

  it('CRITICAL: never overwrites a choice the manager made', () => {
    // `pad-[52px]` and `sech-[448px]` ARE their choices, and the base's own `px-6 py-16`
    // is what the padding control replaced. Re-adding it would undo the edit and fight
    // the control for the same property.
    const stored = 'mt-auto border-border text-center border-t pad-[52px] sech-[448px]'
    const next = rebase(FOOTER_BASE, stored, controlsFor(FOOTER_BASE, 'chrome'))!
    expect(next).toContain('pad-[52px]')
    expect(next).not.toContain('px-6')
    expect(next).not.toContain('py-16')
  })

  it('CRITICAL: a REMOVED base token stays removed', () => {
    // The Divider toggle works by storing a string without `border-t`. Folding the base
    // back in blindly would switch every manager's divider back on.
    const stored = 'mt-auto grid content-center border-border bg-background pad-[52px] text-center'
    const next = rebase(FOOTER_BASE, stored, controlsFor(FOOTER_BASE, 'chrome'))
    expect(next === null || !next.includes('border-t')).toBe(true)
  })

  it('CRITICAL: never adds a second class for a property the manager already set', () => {
    // skeen's polaroid captions: the manager picked `font-sorg-font` and their own
    // tracking and leading. A control's `owns` is an option-list match, so those
    // ARBITRARY values read as unowned — and the base's `font-alt`, `tracking-[-0.04em]`
    // and `leading-[0.95]` were being folded in beside them, two classes fighting over
    // one property each.
    const base =
      'flex items-center justify-center px-2 text-center font-alt text-[clamp(0.78rem,1.9vw,0.875rem)] font-semibold leading-[0.95] tracking-[-0.04em] text-black'
    const stored = 'font-sorg-font tracking-[-0.03em] !leading-[0.9] text-[clamp(1.5rem,5.2vw,2.25rem)]'
    const next = rebase(base, stored, controlsFor(base), { includeOwned: true })!
    expect(next).not.toContain('font-alt')
    expect(next).not.toContain('tracking-[-0.04em]')
    expect(next).not.toContain('leading-[0.95]')
    // …while the layout the caption needs, which they never expressed, still arrives.
    expect(next).toContain('items-center')
    expect(next).toContain('justify-center')
  })

  it('returns null when the override is already current — an untouched row is never rewritten', () => {
    const stored = `${FOOTER_BASE} sech-[448px]`
    expect(rebase(FOOTER_BASE, stored, controlsFor(FOOTER_BASE, 'chrome'))).toBeNull()
  })

  it('an icon group picks up its declared size, colour and hover colour', () => {
    // skeen's hero socials: the manager had set only the gap, so everything the row
    // later declared about its icons was invisible to the panel.
    const base = 'flex gap-6 iconsize-[24px] text-[#ffffffcc] hovercolor-[#c63a2a] px-6'
    const stored = 'flex px-6 gap-[24px]'
    const next = rebase(base, stored, controlsFor(base, 'icons'), { includeOwned: true })!
    expect(next).toContain('iconsize-[24px]')
    expect(next).toContain('text-[#ffffffcc]')
    expect(next).toContain('hovercolor-[#c63a2a]')
    expect(next).toContain('gap-[24px]') // their gap survives…
    expect(next).not.toContain('gap-6') // …and the base's is not re-added beside it
  })
})
