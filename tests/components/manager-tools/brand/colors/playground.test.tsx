// @vitest-environment jsdom
// Brand → Colors → eye: a playground for trying the palette together. It saves nothing.
/**
 * The colour playground (BRAND_PAGE_PLAN.md, Colors: "Eye → playground modal"). What has
 * to hold:
 *   - the eye opens it, named for the colour, with THAT colour as the Background;
 *   - a sample card — an editable "Test" title, a line of text, a link, a Tickets button;
 *   - four part pickers, Background · Text · Border · Accent, each offering the palette as
 *     named dots, the current one checked;
 *   - picking a dot repaints the card at once;
 *   - under it, plain words: "Easy to read" or a red "Hard to read", for TEXT on
 *     BACKGROUND at WCAG's 4.5:1 — and no numbers anywhere;
 *   - it saves nothing.
 * The readability threshold is pinned from both sides with a pair of greys a hair apart:
 * #767676 on white is 4.54:1, #777777 is 4.48:1.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ColorsLedger } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/colors/colors-ledger'
import * as actions from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions'
import { contrastRatio } from '@/lib/color'
import type { BrandColor } from '@/lib/manager-tools/brand/brand-colors'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions', () => ({
  addBrandColorAction: vi.fn(async () => ({})),
  renameBrandColorAction: vi.fn(async () => ({})),
  setBrandColorHexAction: vi.fn(async () => ({})),
  setBrandColorNoteAction: vi.fn(async () => ({})),
  deleteBrandColorAction: vi.fn(async () => ({})),
  setBrandColorSlotAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(cleanup)

const c = (id: string, name: string, hex: string, i: number): BrandColor => ({ id, name, hex, note: null, sortOrder: i, slot: null })
const PALETTE = [
  c('paper', 'Paper', '#ffffff', 0),
  c('grey', 'Grey', '#767676', 1),
  c('lighter', 'Lighter grey', '#777777', 2),
  c('ink', 'Ink', '#111111', 3),
]

function openFor(name: string) {
  render(<ColorsLedger artistId="a1" colors={PALETTE} siteSwatches={[]} />)
  const row = screen.getByText(name).closest('[data-ledger-row]') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Preview' }))
  const modal = screen.getByRole('dialog', { name })
  const card = modal.querySelector('[data-sample-card]') as HTMLElement
  const part = (label: string) => within(modal).getByRole('radiogroup', { name: label })
  const pick = (label: string, colour: string) =>
    act(() => {
      fireEvent.click(within(part(label)).getByRole('radio', { name: colour }))
    })
  return { modal, card, part, pick }
}

describe('the playground', () => {
  it('self-check: the two greys straddle 4.5:1 on white, the way the tests below assume', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5)
  })

  it('CRITICAL: the eye opens it on THAT colour, as the Background', () => {
    const { part, card } = openFor('Grey')
    expect(within(part('Background')).getByRole('radio', { name: 'Grey' }).getAttribute('aria-checked')).toBe('true')
    expect(card.style.backgroundColor).toBe('rgb(118, 118, 118)')
  })

  it('a sample card: an editable "Test" title, a line of text, a link, a Tickets button', () => {
    const { card } = openFor('Paper')
    const title = within(card).getByRole('textbox', { name: 'Title' })
    expect(title.textContent).toBe('Test')
    expect(title.getAttribute('contenteditable')).toBe('true')
    expect(within(card).getByText('Listen now')).toBeTruthy()
    expect(within(card).getByText('Tickets')).toBeTruthy()
    expect(card.querySelector('p')?.textContent?.length).toBeGreaterThan(0)
  })

  it('four parts, each offering every colour by name, exactly one checked', () => {
    const { part } = openFor('Paper')
    for (const label of ['Background', 'Text', 'Border', 'Accent']) {
      const radios = within(part(label)).getAllByRole('radio')
      expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(PALETTE.map((p) => p.name))
      expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1)
    }
  })

  it('opens readable where the palette allows: Text starts on the colour that reads best', () => {
    const { part, modal } = openFor('Paper')
    expect(within(part('Text')).getByRole('radio', { name: 'Ink' }).getAttribute('aria-checked')).toBe('true')
    expect(within(modal).getByText('Easy to read')).toBeTruthy()
  })

  it('CRITICAL: picking a part repaints the card at once', () => {
    const { card, pick } = openFor('Paper')
    pick('Text', 'Grey')
    expect(card.style.color).toBe('rgb(118, 118, 118)')
    pick('Border', 'Ink')
    expect(card.style.borderColor).toBe('rgb(17, 17, 17)')
    pick('Accent', 'Lighter grey')
    expect((within(card).getByText('Listen now') as HTMLElement).style.color).toBe('rgb(119, 119, 119)')
    expect((within(card).getByText('Tickets') as HTMLElement).style.backgroundColor).toBe('rgb(119, 119, 119)')
    pick('Background', 'Ink')
    expect(card.style.backgroundColor).toBe('rgb(17, 17, 17)')
  })

  it('CRITICAL: the words flip at 4.5:1 — Easy just above, a red Hard just below', () => {
    const { modal, pick } = openFor('Paper')
    pick('Text', 'Grey') // 4.54:1
    expect(within(modal).getByText('Easy to read')).toBeTruthy()
    expect(within(modal).queryByText('Hard to read')).toBeNull()
    pick('Text', 'Lighter grey') // 4.48:1
    const hard = within(modal).getByText('Hard to read')
    expect(hard.className).toContain('text-accent-red')
    expect(within(modal).queryByText('Easy to read')).toBeNull()
  })

  it('reads TEXT against BACKGROUND — not the border, not the accent', () => {
    const { modal, pick } = openFor('Ink')
    pick('Text', 'Paper') // white on ink: easily readable…
    pick('Border', 'Lighter grey') // …though white on this grey would not be,
    pick('Accent', 'Paper') // …nor white on white.
    expect(within(modal).getByText('Easy to read')).toBeTruthy()
  })

  it('no numbers: no ratio is shown anywhere', () => {
    const { modal, pick } = openFor('Paper')
    pick('Text', 'Lighter grey')
    expect(modal.textContent).not.toMatch(/\d\s*:\s*1|\d\.\d/)
  })

  it('CRITICAL: trying combinations saves nothing', () => {
    const { pick, modal } = openFor('Paper')
    pick('Background', 'Ink')
    pick('Text', 'Paper')
    pick('Border', 'Grey')
    pick('Accent', 'Lighter grey')
    fireEvent.click(within(modal).getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    for (const a of Object.values(actions)) expect(a).not.toHaveBeenCalled()
  })

  it('a colour with no hex yet has no eye', () => {
    render(<ColorsLedger artistId="a1" colors={PALETTE} siteSwatches={[]} />)
    const add = screen.getAllByRole('button', { name: 'Add color' }).find((b) => !b.closest('[data-ledger-row]'))!
    fireEvent.click(add)
    const name = screen.getAllByRole('textbox', { name: 'Name' }).find((el) => el.tagName === 'INPUT')!
    fireEvent.keyDown(name, { key: 'Enter' })
    // Every empty row: the new one, and the unpicked Primary and Secondary.
    const rows = screen.getAllByText('No color yet').map((el) => el.closest('[data-ledger-row]') as HTMLElement)
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(within(row).queryByRole('button', { name: 'Preview' })).toBeNull()
  })
})
