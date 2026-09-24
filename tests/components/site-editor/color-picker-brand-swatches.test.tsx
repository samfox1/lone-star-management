// @vitest-environment jsdom
// The artist's brand colours lead every editor swatch row, by name.
/**
 * BRAND COLOURS FIRST (BRAND_PAGE_PLAN.md, Colors tab: "Colours … appear first in the site
 * editor's swatches, by name").
 *
 * Every swatch row in the editor is a ColorPalette, fed `used` by its panel from
 * `siteSwatches` (the site palette, then its one-offs). The brand colours reach all of
 * them through ONE provider the editor shell mounts, rather than a prop threaded through
 * five panels — so what has to hold is here, on the palette itself:
 *   - inside the provider, the brand colours come first, named, then the site's;
 *   - a site colour that IS a brand colour appears once, under the brand name;
 *   - a brand swatch applies its hex like any other;
 *   - outside a provider nothing changes (every existing caller and test).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { BrandSwatchProvider, ColorPalette, mergeSwatches } from '@/app/artists/[id]/(dashboard)/editor/color-picker'

afterEach(cleanup)

const BRAND = [
  { name: 'Our black', hex: '#0d0d0d' },
  { name: 'Warm cream', hex: '#F4F1EA' },
]

function openPalette(tree: React.ReactNode) {
  render(tree)
  fireEvent.click(screen.getByRole('button', { name: 'Hero Text color palette' }))
  const dialog = screen.getByRole('dialog', { name: 'Hero Text color palette' })
  const names = within(dialog)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? '')
    .filter((n) => n.startsWith('Hero Text color ') && !/palette|none|hue|saturation/.test(n))
  return { dialog, names }
}

describe('mergeSwatches', () => {
  it('brand first by name, then the site colours not already among them', () => {
    expect(mergeSwatches(BRAND, ['#f4f1ea', '#e5484d', '#0D0D0D', '#2563eb'])).toEqual([
      { hex: '#0d0d0d', name: 'Our black' },
      { hex: '#f4f1ea', name: 'Warm cream' },
      { hex: '#e5484d' },
      { hex: '#2563eb' },
    ])
  })

  it('two brand colours of one hex are one swatch, the first name kept; a bad hex is dropped', () => {
    expect(
      mergeSwatches([{ name: 'Ink', hex: '#111111' }, { name: 'Also ink', hex: '#111' }, { name: 'Broken', hex: 'red' }], []),
    ).toEqual([{ hex: '#111111', name: 'Ink' }])
  })

  it('no brand colours: the site list is unchanged', () => {
    expect(mergeSwatches([], ['#e5484d'])).toEqual([{ hex: '#e5484d' }])
  })
})

describe('ColorPalette inside a BrandSwatchProvider', () => {
  it('CRITICAL: the brand colours lead the swatch row, named, and a shared hex appears once', () => {
    const { names } = openPalette(
      <BrandSwatchProvider colors={BRAND}>
        <ColorPalette label="Text color" aria="Hero Text color" value="" used={['#e5484d', '#f4f1ea']} onChange={vi.fn()} />
      </BrandSwatchProvider>,
    )
    expect(names).toEqual(['Hero Text color Our black', 'Hero Text color Warm cream', 'Hero Text color #e5484d'])
  })

  it('the name is the hover text; the swatch paints the hex', () => {
    const { dialog } = openPalette(
      <BrandSwatchProvider colors={BRAND}>
        <ColorPalette label="Text color" aria="Hero Text color" value="" used={[]} onChange={vi.fn()} />
      </BrandSwatchProvider>,
    )
    const black = within(dialog).getByRole('button', { name: 'Hero Text color Our black' })
    expect(black.getAttribute('title')).toBe('Our black')
    expect(black.style.backgroundColor).toBe('rgb(13, 13, 13)')
    // Brand colours alone still earn the row — a site with nothing used yet has them.
    expect(within(dialog).getByText('On site')).toBeTruthy()
  })

  it('a brand swatch applies its hex, and is the pressed one when it is the value', () => {
    const onChange = vi.fn()
    const { dialog } = openPalette(
      <BrandSwatchProvider colors={BRAND}>
        <ColorPalette label="Text color" aria="Hero Text color" value="#0d0d0d" used={[]} onChange={onChange} />
      </BrandSwatchProvider>,
    )
    expect(within(dialog).getByRole('button', { name: 'Hero Text color Our black' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hero Text color Warm cream' }))
    expect(onChange).toHaveBeenLastCalledWith('#f4f1ea')
  })

  it('outside a provider the row is exactly the site list', () => {
    const { names } = openPalette(
      <ColorPalette label="Text color" aria="Hero Text color" value="" used={['#e5484d']} onChange={vi.fn()} />,
    )
    expect(names).toEqual(['Hero Text color #e5484d'])
  })
})
