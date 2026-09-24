// @vitest-environment jsdom
// The logo editor's board and its fixed-shape modal (BRAND_PAGE_PLAN.md, Sam 2026-09-23).
/**
 * ModalBoard: a 320px square on a checkerboard; under it, centred, background circles —
 * Transparent · Light · Dark · one per brand colour — with hover labels ABOVE them;
 * controlled. A colour that is not a clean hex never reaches a style.
 *
 * BrandModal: a fixed shape — board left, controls right; at most the viewport minus 32px
 * tall, with ONLY the middle scrolling (header and Save stay put); the footer says Save,
 * never Done; built on PortalModal (portaled, Escape closes).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { BOARD_BACKGROUNDS, ModalBoard } from '@/app/artists/[id]/(dashboard)/brand/_ui/modal-board'
import { BrandModal } from '@/app/artists/[id]/(dashboard)/brand/_ui/brand-modal'

afterEach(cleanup)

const SWATCHES = [
  { key: 'c1', name: 'Our black', hex: '#0d0d0d' },
  { key: 'c2', name: 'Warm cream', hex: '#f4f1ea' },
]
const board = () => document.querySelector('[data-board]') as HTMLElement
const circles = () => within(screen.getByRole('group', { name: 'Background' })).getAllByRole('button')

describe('ModalBoard', () => {
  it('is a 320px square holding the thing', () => {
    render(<ModalBoard value="transparent" onChange={vi.fn()}><span>LOGO</span></ModalBoard>)
    expect(board().className).toContain('h-[320px]')
    expect(board().className).toContain('w-[320px]')
    expect(within(board()).getByText('LOGO')).toBeTruthy()
  })

  it('CRITICAL: circles are Transparent · Light · Dark, then each brand colour by NAME, in order', () => {
    render(<ModalBoard value="transparent" onChange={vi.fn()} swatches={SWATCHES} />)
    const expected = [...BOARD_BACKGROUNDS.map((b) => b.name), ...SWATCHES.map((s) => s.name)]
    expect(expected.slice(0, 3)).toEqual(['Transparent', 'Light', 'Dark'])
    expect(circles().map((c) => c.getAttribute('aria-label'))).toEqual(expected)
  })

  it('controlled: a click asks for the key, and only `value` is pressed', () => {
    const onChange = vi.fn()
    render(<ModalBoard value="c2" onChange={onChange} swatches={SWATCHES} />)
    const byName = (n: string) => circles().find((c) => c.getAttribute('aria-label') === n)!
    expect(byName('Warm cream').getAttribute('aria-pressed')).toBe('true')
    expect(circles().filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    fireEvent.click(byName('Dark'))
    expect(onChange).toHaveBeenCalledWith('dark')
    // Controlled: nothing changes until the parent says so.
    expect(byName('Warm cream').getAttribute('aria-pressed')).toBe('true')
  })

  it('CRITICAL: the circles\' hover labels prefer ABOVE them and name them', () => {
    // The chip itself is portaled (tests/components/brand/hover-label.test.tsx); the
    // circle carries the preference on its marker.
    render(<ModalBoard value="transparent" onChange={vi.fn()} swatches={SWATCHES} />)
    for (const c of circles()) {
      expect(c.querySelector(':scope > [data-side]')!.getAttribute('data-side')).toBe('top')
      fireEvent.pointerEnter(c)
      expect(document.body.querySelector('[data-hover-label]')!.textContent).toBe(c.getAttribute('aria-label'))
      fireEvent.pointerLeave(c)
    }
  })

  it('the board wears the chosen background: checkerboard, light, dark, a brand colour', () => {
    const { rerender } = render(<ModalBoard value="transparent" onChange={vi.fn()} swatches={SWATCHES} />)
    expect(board().style.backgroundImage).toContain('linear-gradient')
    rerender(<ModalBoard value="light" onChange={vi.fn()} swatches={SWATCHES} />)
    expect(board().style.backgroundImage).toBe('')
    expect(board().style.backgroundColor).toBe('rgb(255, 255, 255)')
    rerender(<ModalBoard value="dark" onChange={vi.fn()} swatches={SWATCHES} />)
    expect(board().style.backgroundColor).toBe('rgb(17, 17, 17)')
    rerender(<ModalBoard value="c1" onChange={vi.fn()} swatches={SWATCHES} />)
    expect(board().style.backgroundColor).toBe('rgb(13, 13, 13)')
  })

  it('CRITICAL: a colour that is not a clean hex is never offered and never styled', () => {
    const bad = [{ key: 'x', name: 'Sneaky', hex: 'red;background-image:url(https://evil.test/x)' }]
    render(<ModalBoard value="x" onChange={vi.fn()} swatches={[...SWATCHES, ...bad]} />)
    expect(circles().map((c) => c.getAttribute('aria-label'))).not.toContain('Sneaky')
    expect(board().getAttribute('style') ?? '').not.toContain('evil')
    // An unknown value falls back to the checkerboard rather than to nothing.
    expect(board().style.backgroundImage).toContain('linear-gradient')
  })

  it('backgrounds={false} drops the circles (the Tab icon editor)', () => {
    render(<ModalBoard value="transparent" onChange={vi.fn()} backgrounds={false} />)
    expect(screen.queryByRole('group', { name: 'Background' })).toBeNull()
  })
})

describe('BrandModal', () => {
  const open = (props: Partial<Parameters<typeof BrandModal>[0]> = {}) => {
    const onClose = vi.fn()
    render(
      <BrandModal label="Primary logo" meta="edit" onClose={onClose} board={<div>BOARD</div>} {...props}>
        <button type="button">Upload new</button>
      </BrandModal>,
    )
    return { onClose, dialog: screen.getByRole('dialog', { name: 'Primary logo' }) }
  }

  it('CRITICAL: the footer says Save, never Done, and Save closes when there is no onSave', () => {
    const { dialog, onClose } = open()
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Save runs onSave when given', () => {
    const onSave = vi.fn()
    const { dialog, onClose } = open({ onSave })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('header: the thing\'s name and a mono meta line', () => {
    const { dialog } = open()
    expect(within(dialog).getByRole('heading', { name: 'Primary logo' })).toBeTruthy()
    expect(within(dialog).getByText('edit').className).toContain('font-space')
  })

  it('CRITICAL: a fixed shape — capped at the viewport minus 32px, ONLY the middle scrolls', () => {
    const { dialog } = open()
    const card = dialog.firstElementChild as HTMLElement
    expect(card.className).toContain('max-h-[calc(100dvh-32px)]')
    expect(card.className).toMatch(/(^|\s)overflow-hidden(\s|$)/)
    const body = dialog.querySelector('[data-modal-body]') as HTMLElement
    expect(body.className).toMatch(/(^|\s)overflow-auto(\s|$)/)
    expect(body.className).toContain('min-h-0')
    // Header and Save live OUTSIDE the scroller, so they never scroll away.
    expect(within(body).queryByRole('heading', { name: 'Primary logo' })).toBeNull()
    expect(within(body).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(body).getByText('BOARD')).toBeTruthy()
    expect(within(body).getByRole('button', { name: 'Upload new' })).toBeTruthy()
  })

  it('two columns, board left and controls right, stacking on a narrow screen', () => {
    const { dialog } = open()
    const grid = (dialog.querySelector('[data-modal-body]') as HTMLElement).firstElementChild as HTMLElement
    expect(grid.className).toMatch(/(^|\s)grid-cols-1(\s|$)/)
    expect(grid.className).toContain('min-[760px]:grid-cols-[320px_minmax(0,1fr)]')
    expect(grid.children[0].textContent).toBe('BOARD')
    expect(within(grid.children[1] as HTMLElement).getByRole('button', { name: 'Upload new' })).toBeTruthy()
  })

  it('CRITICAL: controlsAlign — centred beside the board by default; `start` tops the controls with the board', () => {
    // The icon editor's controls (source, sliders, Reset) read as floating halfway down a
    // tall board; Sam wants them to start level with the board's top edge (2026-09-23).
    const grid = () => (screen.getByRole('dialog').querySelector('[data-modal-body]') as HTMLElement).firstElementChild as HTMLElement
    open()
    expect(grid().className.split(/\s+/)).toContain('items-center')
    expect(grid().className.split(/\s+/)).not.toContain('items-start')
    cleanup()

    open({ controlsAlign: 'start' })
    const cls = grid().className.split(/\s+/)
    expect(cls).toContain('items-start')
    expect(cls).not.toContain('items-center')
    // Still board left, controls right.
    expect(grid().children[0].textContent).toBe('BOARD')
    expect(within(grid().children[1] as HTMLElement).getByRole('button', { name: 'Upload new' })).toBeTruthy()
  })

  it('CRITICAL: beforeSave sits in the footer IMMEDIATELY left of Save, grouped with it on the right', () => {
    const { dialog } = open({ beforeSave: <button type="button">Reset</button>, footerLeft: <span>LEFT</span> })
    const save = within(dialog).getByRole('button', { name: 'Save' })
    const reset = within(dialog).getByRole('button', { name: 'Reset' })
    expect(save.previousElementSibling).toBe(reset)
    const footer = dialog.querySelector('footer')!
    // Grouped with Save — the footer's right-hand item — not in the far-left slot.
    expect(footer.lastElementChild!.contains(reset)).toBe(true)
    expect(footer.lastElementChild!.contains(save)).toBe(true)
    expect(footer.firstElementChild!.contains(reset)).toBe(false)
    expect(within(footer.firstElementChild as HTMLElement).getByText('LEFT')).toBeTruthy()
  })

  it('without beforeSave the footer is what it was: Save is its own right-hand item', () => {
    const { dialog } = open()
    const footer = dialog.querySelector('footer')!
    expect(footer.lastElementChild).toBe(within(dialog).getByRole('button', { name: 'Save' }))
  })

  it('is PortalModal underneath: portaled to the body, Escape closes it', () => {
    const { dialog, onClose } = open()
    expect(dialog.parentElement).toBe(document.body)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
