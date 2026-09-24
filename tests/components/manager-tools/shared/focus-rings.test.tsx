// @vitest-environment jsdom
// Focus and selected rings on the Brand page must actually paint (visual check, 2026-09-23).
/**
 * THE BUG: in Tailwind v4, `outline-none` (and `outline-hidden`) set `--tw-outline-style:
 * none`, and every width utility (`outline-2`, `focus-visible:outline-2`) paints
 * `outline-style: var(--tw-outline-style)`. So an element that carries `outline-none` AND a
 * ring under some variant computes `outline-style: none` in every state: the ring never
 * shows. That is how the Brand page shipped with no keyboard focus ring on any row icon,
 * no ring on the Add control, and no ring on the selected logo background or playground dot.
 *
 * THE RULE PINNED HERE: on an element that hides the browser outline, a ring declared under
 * a variant is visible only if that SAME variant also says `outline-solid`; and an
 * always-on ring (the selected circle) must not share the element with a hide at all.
 *
 * jsdom computes no Tailwind CSS, so what is pinned is the class contract, read off every
 * element the components render. The contract was checked against Tailwind 4.3.1's own
 * definitions (node_modules/tailwindcss/dist/lib.js: `outline-hidden`/`outline-none` →
 * `--tw-outline-style:none`; `outline-<n>` → `outline-style:var(--tw-outline-style)`), and
 * by eye in the browser after the fix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RowIcon } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/row-icon'
import { AddRow } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/add-row'
import { ModalBoard } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/_ui/modal-board'
import { ColorPlayground } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/colors/playground'

afterEach(cleanup)

const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
const HIDES = new Set(['outline-none', 'outline-hidden'])

/** The ring classes on `el` that can never paint, for the reason above. */
function deadRings(el: Element): string[] {
  const cls = classes(el)
  if (!cls.some((c) => HIDES.has(c))) return [] // --tw-outline-style keeps its `solid` default
  return cls.filter((c) => {
    const m = /^((?:[^:\s]+:)*)outline(?:-(?:\d+|\[[^\]]+\]))?$/.exec(c)
    if (!m) return false
    const variant = m[1]
    // Unprefixed, it fights the hide at the same specificity; prefixed, it needs its own solid.
    return variant === '' || !cls.includes(`${variant}outline-solid`)
  })
}

/** Every element in the document whose ring cannot paint. */
function everyDeadRing(): string[] {
  return [...document.body.querySelectorAll('*')].flatMap((el) => deadRings(el).map((c) => `<${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? ''}> ${c}`))
}

/** A keyboard ring that paints: a width, a colour and a solid style, all under focus-visible. */
function expectFocusRing(el: Element) {
  const cls = classes(el)
  expect(cls, el.getAttribute('aria-label') ?? el.textContent ?? '').toEqual(expect.arrayContaining(['focus-visible:outline-2', 'focus-visible:outline-solid']))
  expect(deadRings(el)).toEqual([])
}

/** An always-on ring (the selected option) that paints: solid, 2px, and no hide beside it. */
function expectSelectedRing(el: Element) {
  const cls = classes(el)
  expect(cls, el.getAttribute('aria-label') ?? '').toEqual(expect.arrayContaining(['outline-solid', 'outline-2', 'outline-ink']))
  expect(cls.filter((c) => HIDES.has(c))).toEqual([])
}

describe('focus and selected rings paint (Tailwind v4 outline-style)', () => {
  it('self-check: the detector flags the shape that shipped and passes the fix', () => {
    const el = document.createElement('button')
    el.className = 'outline-none focus-visible:outline-2 focus-visible:outline-accent'
    expect(deadRings(el)).toEqual(['focus-visible:outline-2'])
    el.className = 'outline-hidden focus-visible:outline-solid focus-visible:outline-2'
    expect(deadRings(el)).toEqual([])
    el.className = 'outline-none outline-2 outline-ink'
    expect(deadRings(el)).toEqual(['outline-2'])
    el.className = 'outline-solid outline-2 outline-ink'
    expect(deadRings(el)).toEqual([])
  })

  it('CRITICAL: every RowIcon variant has a keyboard ring that paints', () => {
    render(
      <>
        <RowIcon icon="edit" label="Edit" variant="faint" />
        <RowIcon icon="plus" label="Add logo" variant="primary" />
        <RowIcon icon="trash" label="Remove" variant="boxed" />
        <RowIcon icon="download" label="Download brand kit" href="/k" variant="boxed" size="sm" />
      </>,
    )
    for (const name of ['Edit', 'Add logo', 'Remove']) expectFocusRing(screen.getByRole('button', { name }))
    expectFocusRing(screen.getByRole('link', { name: 'Download brand kit' }))
    expect(everyDeadRing()).toEqual([])
  })

  it('CRITICAL: the "+ Add" control has a keyboard ring that paints', () => {
    render(<AddRow noun="logo" onAdd={vi.fn()} />)
    expectFocusRing(screen.getByRole('button', { name: 'Add logo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add logo' }))
    expect(everyDeadRing()).toEqual([])
  })

  it('CRITICAL: the selected logo background is visibly ringed; the others ring on focus', () => {
    render(<ModalBoard value="dark" onChange={vi.fn()} swatches={[{ key: 'c1', name: 'Our black', hex: '#0d0d0d' }]} />)
    const circles = within(screen.getByRole('group', { name: 'Background' })).getAllByRole('button')
    for (const c of circles) {
      if (c.getAttribute('aria-pressed') === 'true') expectSelectedRing(c)
      else expectFocusRing(c)
    }
    expect(circles.filter((c) => c.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(everyDeadRing()).toEqual([])
  })

  it('CRITICAL: the picked playground dot is visibly ringed in every part', () => {
    const palette = [
      { key: 'p', name: 'Paper', hex: '#ffffff' },
      { key: 'i', name: 'Ink', hex: '#111111' },
      { key: 'r', name: 'Red', hex: '#d02020' },
    ]
    render(<ColorPlayground palette={palette} startKey="p" onClose={vi.fn()} />)
    const groups = screen.getAllByRole('radiogroup')
    expect(groups).toHaveLength(4)
    for (const g of groups) {
      const dots = within(g).getAllByRole('radio')
      expect(dots.filter((d) => d.getAttribute('aria-checked') === 'true')).toHaveLength(1)
      for (const d of dots) {
        if (d.getAttribute('aria-checked') === 'true') expectSelectedRing(d)
        else expectFocusRing(d)
      }
    }
    expect(everyDeadRing()).toEqual([])
  })
})
