// @vitest-environment jsdom
/**
 * An UNSET colour must not look like a colour.
 *
 * Sam, 2026-08-15, on skeen's footer: "the background color is said to be the white, it is
 * not that color." The region declared no background at all, and the swatch painted an
 * unset value as `transparent` — which, sitting on the panel's white paper, is
 * indistinguishable from someone having chosen white. The picker was reporting a choice
 * nobody made.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ColorPalette } from '@/app/artists/[id]/(dashboard)/editor/color-picker'

afterEach(cleanup)

const swatch = () => screen.getByLabelText('Footer Background color palette') as HTMLElement

describe('the colour swatch, with nothing set', () => {
  it('CRITICAL: an unset colour is NOT painted as a flat background', () => {
    render(
      <ColorPalette label="" aria="Footer Background color" value="" used={[]} onChange={vi.fn()} />,
    )
    const el = swatch()
    // No background-color at all: any flat fill here is read as "this is the colour".
    expect(el.style.backgroundColor).toBe('')
    // …and it carries a visible mark instead, so "none" is a state you can SEE.
    expect(el.style.backgroundImage).not.toBe('')
  })

  it('CRITICAL: a SET colour still paints that exact colour', () => {
    // The other half — without it, a swatch that painted nothing ever would also pass.
    render(
      <ColorPalette label="" aria="Footer Background color" value="#0a0a0a" used={[]} onChange={vi.fn()} />,
    )
    const el = swatch()
    expect(el.style.backgroundColor).toBe('rgb(10, 10, 10)') // jsdom normalises hex
    expect(el.style.backgroundImage).toBe('')
  })
})
