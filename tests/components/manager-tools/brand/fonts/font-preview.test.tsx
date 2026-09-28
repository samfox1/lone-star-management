// @vitest-environment jsdom
/**
 * The font preview's weight toggle (Sam, 2026-09-28: "all real weights, but only on the
 * preview, via toggle"). A Google font offers exactly the upright weights Google has for
 * it; an upload is one file drawn at one weight, so it offers none — anything else would be
 * the browser faking bold, which the row's "no Bold" exists to warn about.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { BrandFont } from '@/lib/fonts'
import type { GoogleFontRow } from '@/lib/google-fonts'

const ROWS: GoogleFontRow[] = [
  ['Archivo', 's', '123456789'],
  ['Bebas Neue', 'd', '4'],
  ['Anton', 's', '4'],
  ['Oswald', 's', '234567'],
  ['Big Shoulders', 'd', '789'],
]
const loadGoogleFonts = vi.fn(async () => ROWS)
vi.mock('@/lib/google-fonts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/google-fonts')>()),
  loadGoogleFonts: () => loadGoogleFonts(),
}))

const { FontPreview } = await import('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/fonts/font-preview')

afterEach(() => {
  cleanup()
  loadGoogleFonts.mockClear()
})

const google = (googleFamily: string): BrandFont => ({
  id: 'g1',
  label: googleFamily,
  family: googleFamily.toLowerCase().replace(/ /g, '-'),
  format: null,
  storagePath: null,
  weight: null,
  source: 'google',
  googleFamily,
})
const SORG: BrandFont = {
  id: 'u1',
  label: 'Sorg Font',
  family: 'sorg-font',
  format: 'ttf',
  storagePath: 'a1/fonts/sorg.ttf',
  weight: 400,
  source: 'upload',
  googleFamily: null,
}

async function open(font: BrandFont) {
  render(<FontPreview title="Primary" font={font} onClose={() => {}} />)
  // Let the catalogue load (a dynamic import in the real module).
  await act(async () => {})
}
const sample = () => screen.getByRole('textbox', { name: 'Sample' })
const weightButtons = () => screen.queryByRole('group', { name: 'Weight' })?.querySelectorAll('button') ?? []

describe('FontPreview — weight toggle', () => {
  it('CRITICAL: a Google font offers exactly its real weights, by name, starting at Regular', async () => {
    await open(google('Oswald'))
    expect([...weightButtons()].map((b) => b.textContent)).toEqual(['Extra Light', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold'])
    expect(screen.getByRole('button', { name: 'Regular' }).getAttribute('aria-pressed')).toBe('true')
    expect(sample().style.fontWeight).toBe('400')
  })

  it('CRITICAL: picking a weight sets the sample in it, and only that one is pressed', async () => {
    await open(google('Archivo'))
    expect(weightButtons()).toHaveLength(9)
    fireEvent.click(screen.getByRole('button', { name: 'Black' }))
    expect(sample().style.fontWeight).toBe('900')
    const pressed = [...weightButtons()].filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed.map((b) => b.textContent)).toEqual(['Black'])
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(sample().style.fontWeight).toBe('700')
  })

  it('a family without Regular starts at its nearest real weight', async () => {
    await open(google('Big Shoulders'))
    expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true')
    expect(sample().style.fontWeight).toBe('700')
  })

  it('a one-weight Google font has nothing to toggle', async () => {
    await open(google('Bebas Neue'))
    expect(loadGoogleFonts).toHaveBeenCalled() // the catalogue WAS read, so the absence is real
    expect(screen.queryByRole('group', { name: 'Weight' })).toBeNull()
    expect(sample().style.fontWeight).toBe('400')
  })

  it('CRITICAL: an upload offers no toggle (one file, one weight; heavier would be faked)', async () => {
    await open(SORG)
    expect(screen.queryByRole('group', { name: 'Weight' })).toBeNull()
    expect(loadGoogleFonts).not.toHaveBeenCalled()
  })
})

describe('FontPreview — layout', () => {
  it('the font’s name sits ABOVE the sample (Sam, 2026-09-28), the weights below it', async () => {
    await open(google('Archivo'))
    const name = screen.getByText('Archivo', { selector: 'figcaption' })
    const group = screen.getByRole('group', { name: 'Weight' })
    expect(name.compareDocumentPosition(sample()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sample().compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
