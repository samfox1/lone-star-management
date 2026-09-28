// The one-off migration: stored colour hexes that ARE a brand colour become that colour's brand token.
/**
 * `scripts/link-brand-colors.ts` rewrites a live artist's working style rows, so its core is
 * pinned strictly (AGENTS.md "Test depth": data that can be lost). What must hold:
 *   - a plain text / bg / border hex equal to a published brand colour becomes that colour's
 *     brand token, and NOTHING else in the string moves;
 *   - everything that is not exactly such a token is left byte-for-byte alone: other colours,
 *     translucent versions, tokens already linked, hover/line colours, layout, the sentinel;
 *   - a brand colour with a bad key or hex is never written (the applier would drop it);
 *   - a result the editor's own save would refuse is reported, never written;
 *   - it is idempotent, and the rewritten string renders to the brand variable.
 */
import { describe, expect, it } from 'vitest'
import { familyOf, resolveRegionStyle } from '@samfox1/site-bridge/styles'
import { linkBrandColors, planBrandLinks } from '@/lib/site-editor/brand-link'

const BRAND = [
  { key: 'primary', name: 'Primary', hex: '#c63a2a' },
  { key: 'cream', name: 'Cream', hex: '#f4f1ea' },
  { key: 'white', name: 'White', hex: '#ffffff' },
]

describe('linkBrandColors', () => {
  it('CRITICAL: links text, background and border hexes that equal a brand colour, in place', () => {
    const r = linkBrandColors('lse-delta grid text-[#f4f1ea] bg-[#C63A2A] border-[#fff] px-6', BRAND)
    expect(r?.next).toBe(
      'lse-delta grid text-[brand-cream_#f4f1ea] bg-[brand-primary_#c63a2a] border-[brand-white_#ffffff] px-6',
    )
    expect(r?.links).toEqual([
      { from: 'text-[#f4f1ea]', to: 'text-[brand-cream_#f4f1ea]', key: 'cream', name: 'Cream' },
      { from: 'bg-[#C63A2A]', to: 'bg-[brand-primary_#c63a2a]', key: 'primary', name: 'Primary' },
      { from: 'border-[#fff]', to: 'border-[brand-white_#ffffff]', key: 'white', name: 'White' },
    ])
  })

  it('CRITICAL: leaves everything else exactly as it was', () => {
    const untouched = [
      'text-[#123456]', // not a brand colour
      'text-[#f4f1eacc]', // translucent Cream is not Cream
      'text-[brand-cream_#f4f1ea]', // already linked
      '!text-[#f4f1ea]', // important-prefixed: not a token the editor writes or lifts
      'hovercolor-[#f4f1ea]', // no brand form for hover yet
      'decocolor-[#f4f1ea]',
      'bggrad-[#f4f1ea_#c63a2a]',
      'text-foreground',
      'md:text-[#f4f1ea]',
    ]
    expect(linkBrandColors(untouched.join(' '), BRAND)).toBeNull()
  })

  it('the FIRST brand colour of a shared hex wins (the one the editor\'s swatch row shows)', () => {
    const twins = [
      { key: 'ink', name: 'Ink', hex: '#111111' },
      { key: 'also-ink', name: 'Also ink', hex: '#111' },
    ]
    expect(linkBrandColors('text-[#111111]', twins)?.next).toBe('text-[brand-ink_#111111]')
  })

  it('never writes a brand colour whose key or hex would be dropped by the applier', () => {
    const bad = [
      { key: 'Cream', name: 'Cream', hex: '#f4f1ea' },
      { key: 'x);color:red', name: 'X', hex: '#f4f1ea' },
      { key: 'ok', name: 'Bad hex', hex: 'red' },
    ]
    expect(linkBrandColors('text-[#f4f1ea] text-[#ff0000]', bad)).toBeNull()
    // A stored hex no colour maths can read (5 digits) must not meet a bad brand hex at ''.
    expect(linkBrandColors('text-[#12345]', bad)).toBeNull()
  })

  it('is idempotent, and the linked string renders the brand variable in the same families', () => {
    const stored = 'lse-delta text-[#f4f1ea] bg-[#c63a2a]'
    const once = linkBrandColors(stored, BRAND)!.next
    expect(linkBrandColors(once, BRAND)).toBeNull()
    const fams = (s: string) => s.split(' ').map(familyOf)
    expect(fams(once)).toEqual(fams(stored))
    const r = resolveRegionStyle('hero', 'text-ink bg-black', once)
    expect(r.style).toEqual({ color: 'var(--brand-cream, #f4f1ea)', backgroundColor: 'var(--brand-primary, #c63a2a)' })
  })

  it('stray whitespace collapses to single spaces (what the editor\'s own save stores)', () => {
    expect(linkBrandColors('  grid   text-[#f4f1ea] ', BRAND)?.next).toBe('grid text-[brand-cream_#f4f1ea]')
  })

  it('null for an empty string or no brand colours', () => {
    expect(linkBrandColors('', BRAND)).toBeNull()
    expect(linkBrandColors('text-[#f4f1ea]', [])).toBeNull()
  })
})

describe('planBrandLinks', () => {
  it('lists the rows that change, with before/after, and skips the rest', () => {
    const plan = planBrandLinks(
      [
        { id: '1', region_key: 'hero_title', class_names: 'lse-delta text-[#f4f1ea]' },
        { id: '2', region_key: 'footer', class_names: 'lse-delta bg-[#000000]' },
        { id: '3', region_key: 'image:abc', class_names: 'border-[#c63a2a] rounded-[8px]' },
        // A row the database handed back without a string is skipped, not a crash.
        { id: '4', region_key: 'odd', class_names: null as unknown as string },
      ],
      BRAND,
    )
    expect(plan.changes.map((c) => [c.id, c.region_key, c.before, c.after])).toEqual([
      ['1', 'hero_title', 'lse-delta text-[#f4f1ea]', 'lse-delta text-[brand-cream_#f4f1ea]'],
      ['3', 'image:abc', 'border-[#c63a2a] rounded-[8px]', 'border-[brand-primary_#c63a2a] rounded-[8px]'],
    ])
    expect(plan.refused).toEqual([])
  })

  it('CRITICAL: a result the editor\'s own save would refuse is reported, never planned', () => {
    // Linking lengthens each token; a row near the 500-character ceiling can cross it.
    const long = `lse-delta text-[#f4f1ea] ${'px-6 '.repeat(95).trim()}`
    expect(long.length).toBeLessThanOrEqual(500)
    const plan = planBrandLinks([{ id: '1', region_key: 'hero', class_names: long }], BRAND)
    expect(plan.changes).toEqual([])
    expect(plan.refused.map((r) => r.region_key)).toEqual(['hero'])
  })
})
