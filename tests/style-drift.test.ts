/**
 * DRIFT: a styled region left behind by the site's own design.
 *
 * A section override REPLACES the base, so the moment a manager styles a region its
 * string is frozen at whatever the design looked like then. Every later improvement is
 * invisible to it, and the only symptoms are indirect — a control that reads wrong, a
 * layout that will not respond. Sam reported skeen's footer as two separate bugs before
 * the cause turned out to be one stale override (2026-08-15).
 */
import { describe, expect, it } from 'vitest'
import { driftedRegions } from '@/lib/site-editor/rebase-override'
import { buildStyleControls, controlsForRegion } from '@/lib/site-editor/style-controls'
import type { ManifestStyleRegion } from '@/lib/site-editor/manifest'

const CONTROLS = buildStyleControls({
  fonts: [],
  textColors: [{ value: 'text-muted', label: 'Warm gray', hex: '#a8a39b' }],
  bgColors: [{ value: 'bg-background', label: 'Black', hex: '#0a0a0a' }],
})
const controlsFor = (r: { key: string; label: string; base?: string; scope?: string }) =>
  controlsForRegion(CONTROLS, r as ManifestStyleRegion)

const FOOTER = {
  key: 'footer',
  label: 'Footer bar',
  base: 'mt-auto grid content-center border-t border-border bg-background px-6 py-16 text-center',
  scope: 'chrome',
}

describe('driftedRegions', () => {
  it('CRITICAL: reports a styled region that is behind, and what it would pick up', () => {
    const drift = driftedRegions([FOOTER], {
      footer: 'mt-auto border-border text-center border-t pad-[52px] sech-[448px]',
    }, controlsFor)
    expect(drift).toHaveLength(1)
    expect(drift[0].label).toBe('Footer bar')
    expect(drift[0].adds).toContain('grid')
    expect(drift[0].adds).toContain('content-center')
    expect(drift[0].adds).toContain('bg-background')
    // The manager's own choices are not listed as changes — nothing they set is touched.
    expect(drift[0].adds).not.toContain('pad-[52px]')
    expect(drift[0].next).toContain('pad-[52px]')
  })

  it('CRITICAL: an UNSTYLED region is never drift — it already renders the live base', () => {
    // The common case by far. Reporting it would put a "your site changed" banner in
    // front of every manager forever, on sites where nothing is wrong.
    expect(driftedRegions([FOOTER], {}, controlsFor)).toEqual([])
    expect(driftedRegions([FOOTER], { footer: '' }, controlsFor)).toEqual([])
    expect(driftedRegions([FOOTER], { footer: '   ' }, controlsFor)).toEqual([])
  })

  it('CRITICAL: a region already carrying the current design is not drift', () => {
    const drift = driftedRegions([FOOTER], { footer: `${FOOTER.base} sech-[448px]` }, controlsFor)
    expect(drift).toEqual([])
  })
})
