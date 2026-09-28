// @vitest-environment jsdom
// A brand swatch links the region to the Brand page colour; the picker reads the link back at its CURRENT hex.
/**
 * BRAND-LINKED COLOURS IN THE PICKER (bridge 0.42.0; Sam, 2026-09-28: "if it changes on the
 * brand page, it should everywhere").
 *
 * The main path, light (AGENTS.md "Test depth": UI still being designed):
 *   - a brand swatch hands its KEY up with its hex; a typed colour hands up the hex alone;
 *   - a stored brand token reads back as that colour's CURRENT hex, by name, and its swatch
 *     is the pressed one — after Cream changed on the Brand page, not only before;
 *   - through the real style row, a brand pick saves the brand token on a 0.42 site and the
 *     plain hex on a 0.41 one (the gate).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { BrandSwatchProvider, ColorPalette } from '@/app/artists/[id]/(dashboard)/editor/color-picker'
import { StyleControlRow } from '@/app/artists/[id]/(dashboard)/editor/panels/style-tools'
import { buildStyleControls, withStyleVars } from '@/lib/site-editor/style-controls'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  saveEditorStyleAction: vi.fn(async () => ({ ok: true })),
}))

afterEach(cleanup)

const BRAND = [
  { key: 'primary', name: 'Primary', hex: '#c63a2a' },
  { key: 'cream', name: 'Cream', hex: '#f4f1ea' },
]
/** The same palette after the manager changed Cream on the Brand page. */
const BRAND_LATER = [BRAND[0], { key: 'cream', name: 'Cream', hex: '#fff8e8' }]

function openPalette() {
  fireEvent.click(screen.getByRole('button', { name: 'Hero Text color palette' }))
  return screen.getByRole('dialog', { name: 'Hero Text color palette' })
}

describe('ColorPalette with brand keys', () => {
  it('CRITICAL: a brand swatch hands up its hex AND its key; a typed colour, the hex alone', () => {
    const onChange = vi.fn()
    render(
      <BrandSwatchProvider colors={BRAND}>
        <ColorPalette label="Text color" aria="Hero Text color" value="" onChange={onChange} />
      </BrandSwatchProvider>,
    )
    fireEvent.click(within(openPalette()).getByRole('button', { name: 'Hero Text color Cream' }))
    expect(onChange.mock.calls.at(-1)).toEqual(['#f4f1ea', 'cream'])

    const field = screen.getByRole('textbox', { name: 'Hero Text color hex' })
    fireEvent.change(field, { target: { value: '#123456' } })
    fireEvent.blur(field)
    expect(onChange.mock.calls.at(-1)).toEqual(['#123456'])
  })

  it('CRITICAL: a linked colour reads back at its CURRENT hex, by name, and its swatch is pressed', () => {
    // Stored when Cream was #f4f1ea; the Brand page has since made it #fff8e8.
    render(
      <BrandSwatchProvider colors={BRAND_LATER}>
        <ColorPalette label="Text color" aria="Hero Text color" value="#f4f1ea" brandKey="cream" onChange={vi.fn()} />
      </BrandSwatchProvider>,
    )
    expect((screen.getByRole('textbox', { name: 'Hero Text color hex' }) as HTMLInputElement).value).toBe('#fff8e8')
    expect(screen.getByRole('button', { name: 'Hero Text color palette' }).style.backgroundColor).toBe('rgb(255, 248, 232)')
    expect(screen.getByText('Cream')).toBeTruthy()
    const dialog = openPalette()
    expect(within(dialog).getByRole('button', { name: 'Hero Text color Cream' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(dialog).getByRole('button', { name: 'Hero Text color Primary' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('a colour deleted from the Brand page falls back to the hex it carried, unnamed', () => {
    render(
      <BrandSwatchProvider colors={[BRAND[0]]}>
        <ColorPalette label="Text color" aria="Hero Text color" value="#f4f1ea" brandKey="cream" onChange={vi.fn()} />
      </BrandSwatchProvider>,
    )
    expect((screen.getByRole('textbox', { name: 'Hero Text color hex' }) as HTMLInputElement).value).toBe('#f4f1ea')
    expect(screen.queryByText('Cream')).toBeNull()
  })

  it('leaving the hex field untouched does not unlink the colour', () => {
    const onChange = vi.fn()
    render(
      <BrandSwatchProvider colors={BRAND_LATER}>
        <ColorPalette label="Text color" aria="Hero Text color" value="#f4f1ea" brandKey="cream" onChange={onChange} />
      </BrandSwatchProvider>,
    )
    fireEvent.blur(screen.getByRole('textbox', { name: 'Hero Text color hex' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('StyleControlRow: the brand pick is saved as the token the site can read', () => {
  const PALETTE = { fonts: [] }
  const textColor = (version: string) => buildStyleControls(withStyleVars(PALETTE, version)).find((c) => c.id === 'textColor')!

  function pick(version: string, cls = '') {
    const onChange = vi.fn()
    render(
      <BrandSwatchProvider colors={BRAND}>
        <StyleControlRow regionLabel="Hero" control={textColor(version)} cls={cls} onChange={onChange} />
      </BrandSwatchProvider>,
    )
    fireEvent.click(within(openPalette()).getByRole('button', { name: 'Hero Text color Cream' }))
    return onChange
  }

  it('CRITICAL: on a 0.42 site a brand swatch saves the brand token', () => {
    expect(pick('0.42.0')).toHaveBeenLastCalledWith('text-[brand-cream_#f4f1ea]')
  })

  it('CRITICAL: on a 0.41 site the same pick saves the plain hex (the gate)', () => {
    expect(pick('0.41.0')).toHaveBeenLastCalledWith('text-[#f4f1ea]')
  })

  it('a stored brand token shows the colour as the Brand page has it now', () => {
    render(
      <BrandSwatchProvider colors={BRAND_LATER}>
        <StyleControlRow regionLabel="Hero" control={textColor('0.42.0')} cls="grid text-[brand-cream_#f4f1ea]" onChange={vi.fn()} />
      </BrandSwatchProvider>,
    )
    expect((screen.getByRole('textbox', { name: 'Hero Text color hex' }) as HTMLInputElement).value).toBe('#fff8e8')
  })
})
