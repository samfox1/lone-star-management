// A brand swatch saves a brand colour token, but only for a site whose bridge (0.42+) can lift it.
/**
 * THE EDITOR HALF OF BRAND COLOUR TOKENS (bridge 0.42.0).
 *
 * The colour controls that write the three colour prefixes (text / bg / border) now take the
 * picked swatch's brand KEY and write `text-[brand-cream_#f4f1ea]`, which the site renders as
 * `var(--brand-cream, #f4f1ea)`. A typed or dragged colour has no key and stays a plain hex.
 *
 * THE GATE. A 0.41 applier does not know the token: it rides through as a dead class, the
 * pick silently does nothing on the live site, and `border-[brand-…]` even reads as a border
 * WIDTH there. So the editor writes brand tokens only to a site announcing 0.42.0 or later,
 * and the plain hex to anything older — the same pattern as every earlier token era.
 *
 * The brand-capable controls are DERIVED (AGENTS.md rule 4): every colour control whose plain
 * write is one of the three colour tokens, across every builder. A new colour control of that
 * kind joins this sweep the moment it exists.
 */
import { describe, expect, it } from 'vitest'
import { colorToken } from '@samfox1/site-bridge/styles'
import { bridgeSupportsBrandColors } from '@/lib/site-editor/manifest'
import {
  applyStyleValue,
  buildItemStyleControls,
  buildStyleControls,
  buildTextItemStyleControls,
  controlsForRegion,
  deltaFromEffective,
  withStyleVars,
  type SiteStyleOptions,
  type StyleControl,
} from '@/lib/site-editor/style-controls'
import { cleanClassText } from '@/lib/site-editor/save'

const PALETTE: SiteStyleOptions = {
  fonts: [],
  textColors: [{ value: 'text-foreground', label: 'Fg', hex: '#f4f1ea' }],
  bgColors: [{ value: 'bg-black', label: 'Black', hex: '#000000' }],
}

type ColorControl = Extract<StyleControl, { kind: 'color' }>

/** Every colour control the editor renders, for one site version. */
function colourControls(version: string | undefined): ColorControl[] {
  const opts = withStyleVars(PALETTE, version)
  const icons = { key: 'socials', label: 'Socials', scope: 'icons' as const, base: 'flex gap-4 iconsize-[18px] text-[#ffffff]' }
  return [
    ...buildStyleControls(opts),
    ...buildTextItemStyleControls(opts),
    ...buildItemStyleControls(opts),
    ...controlsForRegion(buildStyleControls(opts), icons, opts),
  ].filter((c): c is ColorControl => c.kind === 'color')
}

/** The ones whose PLAIN write is a text/bg/border colour token — derived, not listed. */
const brandCapable = (controls: ColorControl[]) =>
  controls.filter((c) => c.toToken && colorToken(c.toToken('#123456', ''))?.kind === 'hex')

describe('bridgeSupportsBrandColors — the 0.42.0 gate', () => {
  it('yes from 0.42.0 on', () => {
    for (const v of ['0.42.0', '0.42.3', '0.43.0', '1.0.0']) expect(bridgeSupportsBrandColors(v), v).toBe(true)
  })

  it('CRITICAL: no for an older, absent or malformed version (unknown writes the old form)', () => {
    for (const v of ['0.41.0', '0.41.9', '0.32.0', undefined, '', 'latest', '0.42.0-beta', 'v0.42.0'])
      expect(bridgeSupportsBrandColors(v), String(v)).toBe(false)
  })

  it('withStyleVars records it', () => {
    expect(withStyleVars(PALETTE, '0.42.0').brandColors).toBe(true)
    expect(withStyleVars(PALETTE, '0.41.0').brandColors).toBe(false)
  })
})

describe('the brand-capable colour controls', () => {
  const current = brandCapable(colourControls('0.42.0'))

  it('the sweep is not vacuous: text, background, border and icon colour are all in it', () => {
    expect(current.map((c) => c.id)).toEqual(expect.arrayContaining(['textColor', 'bgColor', 'borderColor']))
    expect(current.map((c) => c.label)).toEqual(expect.arrayContaining(['Icon color', 'Font color', 'Border color']))
  })

  for (const c of current) {
    it(`CRITICAL: ${c.id} (${c.label}) writes the brand token for a brand swatch on a 0.42 site`, () => {
      const plain = c.toToken!('#f4f1ea', '')
      const prefix = plain.slice(0, plain.indexOf('-['))
      const token = c.toToken!('#f4f1ea', '', 'cream')
      expect(token).toBe(`${prefix}-[brand-cream_#f4f1ea]`)
      expect(cleanClassText(`lse-delta ${token}`)).not.toBeNull() // the save validator keeps it
      // …reads it back as the key and the hex it carries…
      expect(c.brandOf?.(`grid ${token}`)).toBe('cream')
      expect(c.hexOf!(`grid ${token}`)).toBe('#f4f1ea')
      // …and owns it, so the next pick REPLACES it rather than stacking a second colour.
      expect(c.owns(token)).toBe(true)
      expect(applyStyleValue(`grid ${token}`, c, plain)).toBe(`grid ${plain}`)
      // A custom colour (no key) stays a plain hex, and so does clearing.
      expect(c.toToken!('#123456', '')).toBe(`${prefix}-[#123456]`)
      expect(c.toToken!('', '', 'cream')).toBe('')
      // A plain hex reads back with no key.
      expect(c.brandOf?.(`grid ${plain}`)).toBe('')
    })
  }

  it('CRITICAL: on a 0.41 site every one of them writes the plain hex, key or not', () => {
    const old = brandCapable(colourControls('0.41.0'))
    expect(old.length).toBe(current.length)
    for (const c of old) expect(c.toToken!('#f4f1ea', '', 'cream'), c.id).not.toContain('brand-')
  })

  it('the other colour controls (hover, line, gradient) ignore a key: they have no brand form yet', () => {
    const all = colourControls('0.42.0')
    const capable = new Set(brandCapable(all))
    const others = all.filter((c) => !capable.has(c))
    expect(others.length).toBeGreaterThan(0)
    for (const c of others) expect(c.toToken?.('#f4f1ea', '', 'cream') ?? '', c.id).not.toContain('brand-')
  })

  it('a brand token stores as a delta like the hex it replaces', () => {
    expect(deltaFromEffective('grid text-foreground', 'grid text-[brand-cream_#f4f1ea]')).toBe(
      'lse-delta text-[brand-cream_#f4f1ea]',
    )
  })
})
