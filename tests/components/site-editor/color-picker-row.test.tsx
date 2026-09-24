// @vitest-environment jsdom
// The Brand row's colour control is ColorPalette itself, in its `row` presentation.
/**
 * ColorPalette, variant="row" (BRAND_PAGE_PLAN.md, Colors tab). The standing rule is ONE
 * colour control everywhere, so the Brand row is a presentation of ColorPalette, not a
 * second picker. What has to hold:
 *   - the row shows a swatch and a hex field; there is no "none" clear, and no modal;
 *   - the swatch opens a panel to the LEFT of itself (never over the row's own swatch and
 *     hex), or BELOW when the viewport has no room on the left;
 *   - the panel is the site-styled one: "On the site" swatches, a shade square, a hue bar
 *     and a hex box;
 *   - an on-site swatch applies and closes; the hex on the row + Enter applies; an empty
 *     hex is not a colour and puts the old one back;
 *   - Escape and a press outside close it; a press inside does not;
 *   - with no value, the row shows the caller's empty state instead, which opens the same
 *     panel. The FIRST colour replaces it at once, panel open or not (Sam, 2026-09-23: the
 *     row said "No color yet +" until the panel closed) — except while a pointer gesture
 *     that started in the panel is still down, so a drag never has its panel moved under it.
 *   - the panel opens LEFT of the swatch and TOP-aligned with it, growing down: centred, a
 *     tall panel reached up over the row above (the Browser bar's covered the Home-screen
 *     icon).
 * jsdom does no layout: the side is decided from the anchor's measured box, so tests stub
 * that box, and the placement is pinned by its class contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ColorPalette, rowPanelSide } from '@/app/artists/[id]/(dashboard)/editor/color-picker'

afterEach(cleanup)

/** Ring classes on `el` that can never paint (Tailwind v4: `outline-none`/`outline-hidden`
 *  set --tw-outline-style:none, which every `outline-<n>` reads) — the rule
 *  tests/components/brand/focus-rings.test.tsx pins for the shell's controls. */
function deadRings(el: Element): string[] {
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
  if (!cls.some((c) => c === 'outline-none' || c === 'outline-hidden')) return []
  return cls.filter((c) => {
    const m = /^((?:[^:\s]+:)*)outline(?:-(?:\d+|\[[^\]]+\]))?$/.exec(c)
    return m ? m[1] === '' || !cls.includes(`${m[1]}outline-solid`) : false
  })
}
const everyDeadRing = (root: Element) =>
  [...root.querySelectorAll('*')].flatMap((el) => deadRings(el).map((c) => `<${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? ''}> ${c}`))

/** Stub the measured box of the element holding the swatch. */
function placeAnchorAt(swatch: HTMLElement, left: number) {
  const anchor = swatch.closest('[data-color-anchor]') as HTMLElement
  anchor.getBoundingClientRect = () =>
    ({ left, right: left + 32, top: 200, bottom: 232, width: 32, height: 32, x: left, y: 200, toJSON() {} }) as DOMRect
  return anchor
}

function renderRow(props: Partial<Parameters<typeof ColorPalette>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <div>
      <span>Row title</span>
      <ColorPalette variant="row" label="Color 1" aria="Color 1" value="#0d0d0d" used={['#f4f1ea', '#e5484d']} onChange={onChange} {...props} />
    </div>,
  )
  return { onChange, swatch: screen.getByRole('button', { name: 'Color 1 palette' }), hex: screen.getByLabelText('Color 1 hex') as HTMLInputElement }
}

function openAt(left = 640, props: Partial<Parameters<typeof ColorPalette>[0]> = {}) {
  const r = renderRow(props)
  placeAnchorAt(r.swatch, left)
  fireEvent.click(r.swatch)
  return { ...r, panel: screen.getByRole('dialog', { name: 'Color 1 palette' }) }
}

describe('rowPanelSide — where the panel goes', () => {
  it('left when the panel and its gap fit before the anchor, below when they do not', () => {
    // 232px panel + 12px gap + a 16px page gutter = 260px needed.
    expect(rowPanelSide(260)).toBe('left')
    expect(rowPanelSide(259)).toBe('below')
    expect(rowPanelSide(0)).toBe('below')
  })
})

describe('ColorPalette variant="row" — on the row', () => {
  it('shows a swatch painted with the colour and its hex, with no clear and no modal', () => {
    const { swatch, hex } = renderRow()
    expect(swatch.style.backgroundColor).toBe('rgb(13, 13, 13)')
    expect(hex.value).toBe('#0d0d0d')
    // No "none" control: a brand colour always has one.
    expect(screen.queryByRole('button', { name: 'Color 1 none' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('CRITICAL: the hex on the row + Enter applies the typed colour', () => {
    const { hex, onChange } = renderRow()
    fireEvent.change(hex, { target: { value: 'E5484D' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('#e5484d')
  })

  it('an EMPTY hex is not a colour: nothing is sent and the old hex comes back', () => {
    const { hex, onChange } = renderRow()
    fireEvent.change(hex, { target: { value: '   ' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    expect(hex.value).toBe('#0d0d0d')
  })
})

describe('ColorPalette variant="row" — the panel', () => {
  it('CRITICAL: opens to the LEFT of the swatch, anchored beside it and clear of the row hex', () => {
    const { panel, swatch, hex } = openAt(640)
    expect(panel.getAttribute('data-side')).toBe('left')
    // Its right edge sits 12px left of the swatch's left edge.
    expect(panel.className).toContain('right-[calc(100%+12px)]')
    expect(panel.className).not.toMatch(/(^|\s)left-/)
    expect(panel.className).toContain('absolute')
    // The anchor holds the swatch and the panel ONLY — the row's hex is outside it, to the
    // right, so a panel ending left of the swatch cannot cover either of them.
    const anchor = swatch.closest('[data-color-anchor]') as HTMLElement
    expect(anchor.className).toContain('relative')
    expect(anchor.contains(panel)).toBe(true)
    expect(anchor.contains(hex)).toBe(false)
    expect(panel.contains(hex)).toBe(false)
    expect(anchor.compareDocumentPosition(hex) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A non-modal panel: the page behind it is not taken over.
    expect(panel.getAttribute('aria-modal')).toBeNull()
  })

  it('CRITICAL: vertically it is anchored to its OWN row: top-aligned with the swatch, growing down — never centred up over the row above', () => {
    // A centred 280px panel on a ~64px row reached ~110px up: the Browser bar's covered the
    // Home-screen icon's tile (Sam's screenshot, 2026-09-23).
    const { panel } = openAt(640)
    expect(panel.className).toMatch(/(^|\s)top-0(\s|$)/)
    expect(panel.className).not.toContain('top-1/2')
    expect(panel.className).not.toContain('-translate-y-1/2')
    expect(panel.className).not.toMatch(/(^|\s)bottom-/)
  })

  it('opens BELOW when the viewport has no room on the left (a stacked, narrow row)', () => {
    const { panel } = openAt(24)
    expect(panel.getAttribute('data-side')).toBe('below')
    expect(panel.className).toContain('top-[calc(100%+8px)]')
    expect(panel.className).not.toContain('right-[calc(100%+12px)]')
  })

  it('holds "On the site" swatches, a shade square, a hue bar and a hex box', () => {
    const { panel } = openAt()
    expect(within(panel).getByText('On the site')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Color 1 #f4f1ea' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Color 1 #e5484d' })).toBeTruthy()
    expect(within(panel).getByRole('slider', { name: 'Color 1 saturation and brightness' })).toBeTruthy()
    expect(within(panel).getByLabelText('Color 1 hue')).toBeTruthy()
    expect((within(panel).getByLabelText('Hex') as HTMLInputElement).value).toBe('#0d0d0d')
  })

  it('no site colours: the swatch heading is left out rather than shown empty', () => {
    const { panel } = openAt(640, { used: [] })
    expect(within(panel).queryByText('On the site')).toBeNull()
  })

  it('CRITICAL: an on-site swatch applies its colour and closes the panel', () => {
    const { panel, onChange } = openAt()
    fireEvent.click(within(panel).getByRole('button', { name: 'Color 1 #e5484d' }))
    expect(onChange).toHaveBeenCalledWith('#e5484d')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the hue bar mixes live, through the same onChange', () => {
    const { panel, onChange } = openAt(640, { value: '#ff0000' })
    fireEvent.change(within(panel).getByLabelText('Color 1 hue'), { target: { value: '240' } })
    expect(onChange).toHaveBeenLastCalledWith('#0000ff')
    // Still open: mixing is a gesture, not a pick.
    expect(screen.getByRole('dialog', { name: 'Color 1 palette' })).toBeTruthy()
  })

  it('the panel hex box applies a typed colour', () => {
    const { panel, onChange } = openAt()
    const box = within(panel).getByLabelText('Hex')
    fireEvent.change(box, { target: { value: '#2563eb' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('#2563eb')
  })

  it('Escape closes it and hands focus back to the swatch', () => {
    const { panel, swatch } = openAt()
    fireEvent.keyDown(within(panel).getByLabelText('Hex'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(swatch)
  })

  it('CRITICAL: every ring in the row and its panel paints — the swatch’s focus ring and the picked on-site colour’s ring', () => {
    const { panel, swatch } = openAt(640, { value: '#e5484d' })
    expect(everyDeadRing(document.body)).toEqual([])
    expect(swatch.className).toContain('focus-visible:outline-solid')
    const picked = within(panel).getByRole('button', { name: 'Color 1 #e5484d' })
    expect(picked.getAttribute('aria-pressed')).toBe('true')
    expect(picked.className.split(' ')).toEqual(expect.arrayContaining(['outline-solid', 'outline-2', 'outline-ink']))
  })

  it('a press OUTSIDE closes it; a press INSIDE does not', () => {
    const { panel } = openAt()
    fireEvent.pointerDown(within(panel).getByRole('slider', { name: 'Color 1 saturation and brightness' }))
    fireEvent.pointerUp(window)
    expect(screen.getByRole('dialog', { name: 'Color 1 palette' })).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('Row title'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the swatch toggles it', () => {
    const { swatch } = openAt()
    expect(swatch.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(swatch)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(swatch.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('ColorPalette variant="row" — no colour yet', () => {
  function renderEmpty() {
    const onChange = vi.fn<(hex: string) => void>()
    const view = render(
      <ColorPalette
        variant="row"
        label="Color 3"
        aria="Color 3"
        value=""
        used={['#e5484d']}
        onChange={onChange}
        renderEmpty={(open) => (
          <>
            <span>No color yet</span>
            <button type="button" onClick={open}>
              Add color
            </button>
          </>
        )}
      />,
    )
    return { onChange, view }
  }

  it('shows the caller\'s empty state instead of a swatch and a hex', () => {
    renderEmpty()
    expect(screen.getByText('No color yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Color 3 palette' })).toBeNull()
    expect(screen.queryByLabelText('Color 3 hex')).toBeNull()
  })

  /** The parent's answer to a pick: it now holds that colour. */
  function holdValue(view: ReturnType<typeof render>, onChange: ReturnType<typeof vi.fn<(hex: string) => void>>) {
    view.rerender(
      <ColorPalette
        variant="row"
        label="Color 3"
        aria="Color 3"
        value={onChange.mock.lastCall![0]}
        used={['#e5484d']}
        onChange={onChange}
        renderEmpty={(open) => (
          <button type="button" onClick={open}>
            Add color
          </button>
        )}
      />,
    )
  }

  function openEmpty() {
    const r = renderEmpty()
    const add = screen.getByRole('button', { name: 'Add color' })
    placeAnchorAt(add, 640)
    fireEvent.click(add)
    return { ...r, panel: screen.getByRole('dialog', { name: 'Color 3 palette' }) }
  }

  it('CRITICAL: its + opens the same panel, and the FIRST colour shows on the row at once — panel still open', () => {
    const { onChange, view, panel } = openEmpty()
    expect(panel.getAttribute('data-side')).toBe('left')
    const box = within(panel).getByLabelText('Hex')
    fireEvent.change(box, { target: { value: '#2563eb' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('#2563eb')
    holdValue(view, onChange)
    // The row is the colour now: swatch + hex, and the SAME panel still open.
    expect(screen.queryByRole('button', { name: 'Add color' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Color 3 palette' }).style.backgroundColor).toBe('rgb(37, 99, 235)')
    expect((screen.getByLabelText('Color 3 hex') as HTMLInputElement).value).toBe('#2563eb')
    expect(screen.getByRole('dialog', { name: 'Color 3 palette' })).toBe(panel)
  })

  it('CRITICAL: …but not under a drag: the empty state holds until the pointer that started in the panel lets go', () => {
    const { onChange, view, panel } = openEmpty()
    const square = within(panel).getByRole('slider', { name: 'Color 3 saturation and brightness' })
    fireEvent.pointerDown(square, { clientX: 10, clientY: 10 })
    expect(onChange).toHaveBeenCalled()
    holdValue(view, onChange)
    expect(screen.getByRole('button', { name: 'Add color' })).toBeTruthy() // nothing moves mid-drag
    fireEvent.pointerUp(window)
    expect(screen.queryByRole('button', { name: 'Add color' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Color 3 palette' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Color 3 palette' })).toBe(panel) // still open
    // And once swapped it stays swapped: a second drag does not bring the empty state back.
    fireEvent.pointerDown(within(panel).getByLabelText('Color 3 hue'))
    expect(screen.queryByRole('button', { name: 'Add color' })).toBeNull()
    fireEvent.pointerUp(window)
  })

  it('while the panel is open, the trigger’s own hover label is hidden (the panel cut it off)', () => {
    const view = render(
      <ColorPalette
        variant="row"
        label="Browser bar"
        aria="Browser bar"
        value=""
        onChange={() => {}}
        renderEmpty={(open) => (
          <button type="button" aria-label="Pick a color" onClick={open}>
            +<span aria-hidden="true" data-side="bottom">Pick a color</span>
          </button>
        )}
      />,
    )
    const plus = screen.getByRole('button', { name: 'Pick a color' })
    const anchor = placeAnchorAt(plus, 640)
    const HIDE = '[&>button>[data-side]]:hidden'
    expect(anchor.className).not.toContain(HIDE)
    fireEvent.click(plus)
    // The rule reaches the label (a direct child of the trigger) and not the panel, which
    // carries a data-side of its own but is no button's child.
    expect(anchor.className).toContain(HIDE)
    expect(anchor.querySelector(':scope > button > [data-side]')).not.toBeNull()
    expect(screen.getByRole('dialog').matches(':scope > button > [data-side]')).toBe(false)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(anchor.className).not.toContain(HIDE)
    view.unmount()
  })

  it('a hue drag counts as a drag too', () => {
    const { onChange, view, panel } = openEmpty()
    const hue = within(panel).getByLabelText('Color 3 hue')
    fireEvent.pointerDown(hue)
    fireEvent.change(hue, { target: { value: '120' } })
    holdValue(view, onChange)
    expect(screen.getByRole('button', { name: 'Add color' })).toBeTruthy()
    fireEvent.pointerCancel(window)
    expect(screen.queryByRole('button', { name: 'Add color' })).toBeNull()
  })
})
