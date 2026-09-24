// @vitest-environment jsdom
// Every Brand hover label escapes whatever box it sits in (Sam, 2026-09-23: the icon
// editor's "Upload new" was cut off by the modal body's top edge).
/**
 * HoverLabel (brand/_ui/row-icon.tsx). What has to hold:
 *   - the chip is PORTALED to document.body and `position: fixed`, so no scrolling or
 *     overflow-hidden ancestor can clip it; the control keeps only a zero-size marker;
 *   - it exists only while its control is hovered by a mouse or keyboard-focused — never
 *     on touch, never on a disabled control, never while the marker is hidden (the fonts
 *     menu and the colour panel hide it while they are open) — so a hidden chip cannot
 *     widen the page (item 2 of the 2026-09-23 visual check);
 *   - it is placed by placeLabel (pure, tests/unit/brand/label-placement.test.ts) from the
 *     control's rect, the viewport and the nearest clipping ancestor's rect, and re-placed
 *     on scroll and resize while shown.
 * jsdom does no layout, so rects and the chip's size are stubbed; what is pinned is that the
 * component hands the REAL rects to the placement and writes back what it answers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RowIcon } from '@/app/artists/[id]/(dashboard)/brand/_ui/row-icon'
import { ModalBoard } from '@/app/artists/[id]/(dashboard)/brand/_ui/modal-board'
import { ColorPlayground } from '@/app/artists/[id]/(dashboard)/brand/colors/playground'
import { LABEL_GAP, LABEL_MARGIN } from '@/app/artists/[id]/(dashboard)/brand/_ui/label-placement'

const CHIP = { width: 100, height: 24 }
const originals = {
  w: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  h: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
}
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-hover-label') ? CHIP.width : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-hover-label') ? CHIP.height : 0
    },
  })
})
afterAll(() => {
  if (originals.w) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originals.w)
  if (originals.h) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originals.h)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const chip = () => document.body.querySelector('[data-hover-label]') as HTMLElement | null
const rect = (left: number, top: number, w = 36, h = 36) =>
  ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => ({}) }) as DOMRect
const placeAt = (el: Element, r: DOMRect) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r)

describe('HoverLabel — shown, and where it lives', () => {
  it('CRITICAL: hover mounts the chip in document.body, fixed; leaving removes it', () => {
    render(<RowIcon icon="edit" label="Edit" />)
    const btn = screen.getByRole('button', { name: 'Edit' })
    expect(chip()).toBeNull()
    fireEvent.pointerEnter(btn)
    const c = chip()!
    expect(c.parentElement).toBe(document.body)
    expect(c.className.split(/\s+/)).toContain('fixed')
    expect(c.textContent).toBe('Edit')
    fireEvent.pointerLeave(btn)
    expect(chip()).toBeNull()
  })

  it('CRITICAL: while hidden there is NO chip anywhere, only a zero-size marker in the control', () => {
    // The 2026-09-23 horizontal scrollbar came from a transparent chip that still took up
    // room. Hidden now means absent; the marker has no size and no words.
    render(<RowIcon icon="download" label="Download brand kit" href="/artists/a1/brand/kit" labelAlign="end" />)
    const link = screen.getByRole('link', { name: 'Download brand kit' })
    expect(document.body.textContent).not.toContain('Download brand kit')
    const m = link.querySelector(':scope > [data-side]') as HTMLElement
    expect(m.textContent).toBe('')
    expect(m.className.split(/\s+/)).toEqual(expect.arrayContaining(['absolute', 'h-0', 'w-0']))
  })

  it('keyboard focus shows it, blur hides it; a TOUCH does not show it', () => {
    render(<RowIcon icon="edit" label="Edit" />)
    const btn = screen.getByRole('button', { name: 'Edit' })
    fireEvent.pointerEnter(btn, { pointerType: 'touch' })
    expect(chip()).toBeNull()
    act(() => btn.focus())
    expect(chip()?.textContent).toBe('Edit')
    act(() => btn.blur())
    expect(chip()).toBeNull()
  })

  it('CRITICAL: hiding the marker keeps the chip away — the open-menu / open-panel contract', () => {
    // fonts-ledger's `[&>[data-side]]:hidden` and the colour picker's
    // `[&>button>[data-side]]:hidden` hide the marker while their menu/panel is open.
    render(<RowIcon icon="chevronsUpDown" label="Change font" />)
    const btn = screen.getByRole('button', { name: 'Change font' })
    placeAt(btn, rect(400, 300)) // on screen, so only the marker can be what hides it
    // Witness: unsuppressed, the chip shows.
    fireEvent.pointerEnter(btn)
    expect(chip()!.style.display).not.toBe('none')
    fireEvent.pointerLeave(btn)
    ;(btn.querySelector(':scope > [data-side]') as HTMLElement).style.display = 'none'
    fireEvent.pointerEnter(btn)
    expect(chip() === null || chip()!.style.display === 'none').toBe(true)
  })
})

describe('HoverLabel — placed from the real rects', () => {
  it('CRITICAL: preferred side when it fits, centred, written as fixed top/left', () => {
    render(<RowIcon icon="edit" label="Edit" />)
    const btn = screen.getByRole('button', { name: 'Edit' })
    placeAt(btn, rect(400, 300))
    fireEvent.pointerEnter(btn)
    const c = chip()!
    expect(c.getAttribute('data-placed')).toBe('bottom')
    expect(c.style.top).toBe(`${336 + LABEL_GAP}px`)
    expect(c.style.left).toBe(`${418 - CHIP.width / 2}px`)
  })

  it('CRITICAL: FLIPS off the clipping ancestor\'s edge (the icon editor\'s + under the header)', () => {
    render(
      <div data-testid="body" style={{ overflow: 'auto' }}>
        <RowIcon icon="plus" label="Upload new" labelSide="top" />
      </div>,
    )
    placeAt(screen.getByTestId('body'), rect(300, 120, 640, 500))
    const btn = screen.getByRole('button', { name: 'Upload new' })
    placeAt(btn, rect(330, 124))
    fireEvent.pointerEnter(btn)
    expect(chip()!.getAttribute('data-placed')).toBe('bottom')
    expect(chip()!.style.top).toBe(`${160 + LABEL_GAP}px`)
  })

  it('CRITICAL: shifts left at the page\'s right edge (a link at the far right)', () => {
    render(<RowIcon icon="download" label="Download brand kit" href="/artists/a1/brand/kit" labelAlign="end" />)
    const link = screen.getByRole('link', { name: 'Download brand kit' })
    placeAt(link, rect(window.innerWidth - 40, 20))
    fireEvent.pointerEnter(link)
    const left = parseFloat(chip()!.style.left)
    expect(left + CHIP.width).toBeLessThanOrEqual(window.innerWidth - LABEL_MARGIN)
  })

  it('re-placed on scroll while shown', () => {
    render(<RowIcon icon="edit" label="Edit" />)
    const btn = screen.getByRole('button', { name: 'Edit' })
    const spy = placeAt(btn, rect(400, 300))
    fireEvent.pointerEnter(btn)
    expect(chip()!.style.top).toBe(`${336 + LABEL_GAP}px`)
    spy.mockReturnValue(rect(400, 200))
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(chip()!.style.top).toBe(`${236 + LABEL_GAP}px`)
  })
})

describe('HoverLabel — every Brand label goes through it', () => {
  it('the logo board\'s background circles, above them by preference', () => {
    render(<ModalBoard value="transparent" onChange={vi.fn()} swatches={[{ key: 'c1', name: 'Our black', hex: '#0d0d0d' }]} />)
    for (const c of within(screen.getByRole('group', { name: 'Background' })).getAllByRole('button')) {
      expect(c.querySelector(':scope > [data-side]')!.getAttribute('data-side')).toBe('top')
      placeAt(c, rect(500, 400, 24, 24))
      fireEvent.pointerEnter(c)
      expect(chip()!.textContent).toBe(c.getAttribute('aria-label'))
      expect(chip()!.getAttribute('data-placed')).toBe('top')
      fireEvent.pointerLeave(c)
    }
  })

  it('the playground\'s colour dots', () => {
    render(<ColorPlayground palette={[{ key: 'p', name: 'Paper', hex: '#ffffff' }, { key: 'i', name: 'Ink', hex: '#111111' }]} startKey="p" onClose={vi.fn()} />)
    const dot = within(screen.getAllByRole('radiogroup')[0]).getByRole('radio', { name: 'Ink' })
    fireEvent.pointerEnter(dot)
    expect(chip()!.textContent).toBe('Ink')
    expect(chip()!.parentElement).toBe(document.body)
  })
})
