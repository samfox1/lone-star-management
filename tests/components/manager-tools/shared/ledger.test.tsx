// @vitest-environment jsdom
// Layout A "Ledger": a mono section word on the left, rows split by hairlines on the right.
/**
 * LedgerSection + LedgerRow (BRAND_PAGE_PLAN.md, Sam 2026-09-23). What has to hold:
 *   - the section is a named region, its word in the left column, rows in the right;
 *     the two columns STACK at narrow widths;
 *   - a built-in row has a FIXED title and fixed grey guide text — neither is editable;
 *   - an added row's title is renamable and it carries a note instead of a guide;
 *   - the right-hand slot holds whatever controls the row passes;
 *   - the row is the hover group a `faint` RowIcon listens to.
 * jsdom does no layout, so the grid and breakpoint are pinned as the mechanism.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { LedgerRow, LedgerSection } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/ledger'
import { RowIcon } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/row-icon'
import { AddRow } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/add-row'

vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(cleanup)

describe('LedgerSection', () => {
  it('is a region named by its word, with the word left and the rows right', () => {
    render(
      <LedgerSection label="Colors">
        <p>row one</p>
      </LedgerSection>,
    )
    const region = screen.getByRole('region', { name: 'Colors' })
    const word = within(region).getByText('Colors')
    expect(word.className).toContain('font-space')
    expect(word.className).toContain('uppercase')
    expect(word.className).toContain('text-ink-faint')
    // The word and the rows are siblings in the grid, rows after the word.
    const rows = within(region).getByText('row one').parentElement!
    expect(word.parentElement).toBe(rows.parentElement)
  })

  it('CRITICAL: one column by default, the 150px word column only from 900px up', () => {
    render(<LedgerSection label="Logos" />)
    const cls = screen.getByRole('region', { name: 'Logos' }).className
    expect(cls).toMatch(/(^|\s)grid-cols-1(\s|$)/)
    expect(cls).toContain('min-[900px]:grid-cols-[150px_minmax(0,1fr)]')
  })

  it('the LAST section has no bottom rule, even with the Publish bar after it', () => {
    // The layout renders the bar after the page, so `:last-child` never matched and a lone
    // section wore a stray hairline (2026-09-23 screenshot). The prototype's rule is
    // `.sec:last-of-type`.
    render(
      <div>
        <LedgerSection label="Logos" />
        <LedgerSection label="Colors" />
        <div data-publish-riser="" />
      </div>,
    )
    for (const name of ['Logos', 'Colors']) {
      const cls = screen.getByRole('region', { name }).className
      expect(cls).toContain('border-b')
      expect(cls).toContain('last-of-type:border-b-0')
      expect(cls).not.toMatch(/(^|\s)last:border-b-0/)
    }
  })

  it('an empty section renders its word and no rows', () => {
    render(<LedgerSection label="Fonts" />)
    const region = screen.getByRole('region', { name: 'Fonts' })
    expect(within(region).getByText('Fonts')).toBeTruthy()
    expect(region.querySelectorAll('[data-ledger-row]')).toHaveLength(0)
  })
})

describe('LedgerRow', () => {
  it('CRITICAL: a built-in row has a FIXED title and fixed grey guide text — nothing to type into', () => {
    render(
      <LedgerRow title="Tab icon" guide="Browser tabs and bookmarks.">
        <button type="button">Edit</button>
      </LedgerRow>,
    )
    const row = screen.getByText('Tab icon').closest('[data-ledger-row]') as HTMLElement
    expect(within(row).queryByRole('textbox')).toBeNull()
    const guide = within(row).getByText('Browser tabs and bookmarks.')
    expect(guide.className).toContain('text-ink-muted')
    expect(guide.getAttribute('contenteditable')).toBeNull()
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeTruthy()
  })

  it('an added row has a renamable title and a note', () => {
    render(<LedgerRow title="Color 1" onRename={vi.fn()} note={{ value: 'Our black.', onSave: vi.fn() }} />)
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('Color 1')
    expect(screen.getByRole('textbox', { name: 'Note' }).textContent).toBe('Our black.')
    expect(screen.queryByText('Color 1', { selector: 'div' })).toBeNull()
  })

  it('meta sits under the note (a font\'s weights)', () => {
    render(<LedgerRow title="Archivo" onRename={vi.fn()} note={{ value: '', onSave: vi.fn() }} meta={<span>Medium · no Bold</span>} />)
    const note = screen.getByRole('textbox', { name: 'Note' })
    const meta = screen.getByText('Medium · no Bold')
    expect(note.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('CRITICAL: the row is the hover group a faint RowIcon listens to', () => {
    render(
      <LedgerRow title="Primary logo" guide="Site header and the press kit.">
        <RowIcon icon="edit" label="Edit" />
      </LedgerRow>,
    )
    const btn = screen.getByRole('button', { name: 'Edit' })
    const row = btn.closest('[data-ledger-row]') as HTMLElement
    // Named group: the faint icon's `group-hover/ledger:` only fires under `group/ledger`.
    expect(row.className).toMatch(/(^|\s)group\/ledger(\s|$)/)
    expect(btn.className).toContain('group-hover/ledger:opacity-100')
  })

  it('label left, controls right; stacks at narrow widths', () => {
    render(
      <LedgerRow title="Primary" guide="Headings and names.">
        <span>Instrument Sans</span>
      </LedgerRow>,
    )
    const row = screen.getByText('Primary').closest('[data-ledger-row]') as HTMLElement
    expect(row.className).toMatch(/(^|\s)grid-cols-1(\s|$)/)
    expect(row.className).toContain('min-[900px]:grid-cols-[minmax(180px,1fr)_minmax(0,1.4fr)]')
    const slot = screen.getByText('Instrument Sans').parentElement!
    expect(slot.className).toContain('min-[900px]:justify-end')
  })
})

describe('the trash column lines every row up (visual check, 2026-09-23)', () => {
  // Added rows end in a trash; built-in rows have none. With the controls pushed right, an
  // added row's tile/sample/swatch sat ~42px LEFT of the built-in rows' above it (one icon +
  // one gap). So the trash lives in an end slot of fixed width, and a row without one
  // reserves the same empty slot whenever its list can hold a trash — a list that already
  // has one, or one with an Add row that could make one. A list of built-ins only (the Tab
  // icon tab) reserves nothing. jsdom does no layout or :has(): the mechanism is pinned.
  const slotOf = (row: HTMLElement) => row.querySelector('[data-ledger-end]') as HTMLElement
  const rowOf = (title: string) => screen.getByText(title).closest('[data-ledger-row]') as HTMLElement
  const cls = (el: Element) => el.className.split(/\s+/)

  it('CRITICAL: `remove` sits in an end slot, after every other control, always shown', () => {
    render(
      <LedgerRow title="Poster logo" onRename={vi.fn()} note={{ value: '', onSave: vi.fn() }} remove={<RowIcon icon="trash" label="Remove" tone="danger" />}>
        <span>TILE</span>
        <RowIcon icon="edit" label="Edit" />
      </LedgerRow>,
    )
    const slot = slotOf(rowOf('Poster logo'))
    expect(slot.getAttribute('data-ledger-end')).toBe('remove')
    expect(within(slot).getByRole('button', { name: 'Remove' })).toBeTruthy()
    // The same flex row as the tile and the edit icon, and last in it.
    const controls = screen.getByText('TILE').parentElement!
    expect(slot.parentElement).toBe(controls)
    expect(controls.lastElementChild).toBe(slot)
    expect(cls(slot)).toContain('flex')
    expect(cls(slot)).not.toContain('hidden')
  })

  it('CRITICAL: a row without one reserves the SAME slot, shown when its list holds or can add a trash', () => {
    render(
      <LedgerRow title="Primary logo" guide="Site header and the press kit.">
        <span>TILE</span>
      </LedgerRow>,
    )
    const slot = slotOf(rowOf('Primary logo'))
    expect(slot, 'no reserved slot').not.toBeNull()
    expect(slot.getAttribute('data-ledger-end')).toBe('empty')
    expect(slot.children).toHaveLength(0)
    // Hidden on its own (a list of built-ins only reserves nothing)…
    expect(cls(slot)).toContain('hidden')
    // …and opened by the list: when any row in it has a trash, or it has an Add row.
    expect(cls(slot)).toContain('group-has-[[data-ledger-end=remove]]/ledger-list:flex')
    expect(cls(slot)).toContain('group-has-[[data-ledger-add]]/ledger-list:flex')
  })

  it('CRITICAL: the empty slot is exactly as wide as the trash it stands in for', () => {
    // A faint RowIcon is p-1.5 (6px a side) around a 20px glyph: 32px, which is w-8.
    render(
      <>
        <LedgerRow title="Built in" guide="g" />
        <LedgerRow title="Added" onRename={vi.fn()} note={{ value: '', onSave: vi.fn() }} remove={<RowIcon icon="trash" label="Remove" tone="danger" />} />
      </>,
    )
    const trash = screen.getByRole('button', { name: 'Remove' })
    expect(cls(trash)).toContain('p-1.5')
    expect(trash.querySelector('svg')!.getAttribute('width')).toBe('20')
    const px = 2 * 6 + 20
    for (const title of ['Built in', 'Added']) {
      const w = cls(slotOf(rowOf(title))).filter((c) => /^w-/.test(c))
      expect(w, title).toEqual([`w-${px / 4}`])
      expect(cls(slotOf(rowOf(title))), title).toContain('flex-none')
    }
  })

  it('CRITICAL: the list is the group the slot listens to, and an Add row marks it', () => {
    render(
      <LedgerSection label="Logos">
        <LedgerRow title="Primary logo" guide="g" />
        <AddRow noun="logo" onAdd={vi.fn()} />
      </LedgerSection>,
    )
    const region = screen.getByRole('region', { name: 'Logos' })
    expect(cls(region)).toContain('group/ledger-list')
    const add = screen.getByRole('button', { name: 'Add logo' })
    expect(add.closest('[data-ledger-add]'), 'Add row marker').not.toBeNull()
    expect(region.contains(add.closest('[data-ledger-add]'))).toBe(true)
  })
})
