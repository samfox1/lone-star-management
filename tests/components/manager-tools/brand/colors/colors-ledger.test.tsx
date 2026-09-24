// @vitest-environment jsdom
// Brand → Colors: Primary and Secondary built in, then a palette that saves as you go, and an add flow that saves once, on the first colour.
/**
 * The Colors tab (BRAND_PAGE_PLAN.md, Sam 2026-09-23). What has to hold:
 *   - PRIMARY and SECONDARY first, always (Sam, later that day: "default on the colors page,
 *     they just dont have to be filled in yet"): fixed title, grey guide text, no note, no
 *     trash; "No color yet" and a + until picked, and the pick is ONE slot save
 *     (setBrandColorSlotAction) — every pick after it too. They render from the slot list
 *     alone, so an artist with no slotted rows (the database before 20260924130000) has
 *     them. Then the added colours, "Color 3, …", and no other role names anywhere;
 *   - a colour's title renames it, its note saves, its swatch + hex change it — and a
 *     change reaches the database only when it is REAL: picking the colour it already is
 *     calls nothing, and a drag is one save, not one per frame;
 *   - a refused save says so (an error toast) and the old colour comes back;
 *   - the trash is faint until the row is hovered and asks first;
 *   - ADD: "+ Add color" pre-fills the next free "Color N" → the row is client-only, "No
 *     color yet" with a +; focus walks name → note → +; the + opens the panel; NOTHING is
 *     saved until the first pick, which saves the row ONCE with its name and note — and
 *     every pick after that changes the row it made, never adds another;
 *   - abandoning an unsaved row leaves nothing behind;
 *   - at the cap the Add control is gone, with no words about it.
 * Actions are mocked; the saves are debounced, so the clock is faked and advanced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ColorsLedger } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/colors/colors-ledger'
import {
  addBrandColorAction,
  deleteBrandColorAction,
  renameBrandColorAction,
  setBrandColorHexAction,
  setBrandColorNoteAction,
  setBrandColorSlotAction,
} from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import { COLOR_SLOTS, COLOR_SLOT_NAMES, MAX_ADDED_COLORS, MAX_BRAND_COLORS, type BrandColor } from '@/lib/manager-tools/brand/brand-colors'
import { announceBrandRevert } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/_ui/brand-events'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions', () => ({
  addBrandColorAction: vi.fn(async (_artist: string, input: { name: string; hex: string; note?: string | null }) => ({
    color: { id: 'c-new', name: input.name, hex: input.hex, note: input.note ?? null, sortOrder: 9, slot: null },
  })),
  renameBrandColorAction: vi.fn(async () => ({})),
  setBrandColorHexAction: vi.fn(async () => ({})),
  setBrandColorNoteAction: vi.fn(async () => ({})),
  deleteBrandColorAction: vi.fn(async () => ({})),
  setBrandColorSlotAction: vi.fn(async (_artist: string, slot: 'primary' | 'secondary', hex: string) => ({
    color: { id: `c-${slot}`, name: slot === 'primary' ? 'Primary' : 'Secondary', hex, note: null, sortOrder: 0, slot },
  })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

const ALL_ACTIONS = [
  addBrandColorAction,
  renameBrandColorAction,
  setBrandColorHexAction,
  setBrandColorNoteAction,
  deleteBrandColorAction,
  setBrandColorSlotAction,
]

// Added colours (no slot). Their names predate "Color 3": a palette saved before the
// built-ins existed keeps whatever it was called.
const COLORS: BrandColor[] = [
  { id: 'c1', name: 'Color 1', hex: '#0d0d0d', note: 'Our black.', sortOrder: 0, slot: null },
  { id: 'c2', name: 'Color 2', hex: '#f4f1ea', note: null, sortOrder: 1, slot: null },
]
const PRIMARY: BrandColor = { id: 'cp', name: 'Primary', hex: '#e5484d', note: null, sortOrder: 0, slot: 'primary' }
/** `n` added colours named from "Color 3", as the page names them. */
const added = (n: number): BrandColor[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Color ${i + 3}`, hex: '#111111', note: null, sortOrder: i, slot: null }))
const SITE = ['#0d0d0d', '#e5484d', '#2563eb']

beforeEach(() => {
  vi.useFakeTimers()
  // Every panel opens to the left: the anchors sit well clear of the page edge.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 640, right: 672, top: 200, bottom: 232, width: 32, height: 32, x: 640, y: 200, toJSON() {},
  } as DOMRect)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Past the save debounce, with every resolved action's follow-up flushed. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(2000)
  })
  await act(async () => {})
}

function renderLedger(colors: BrandColor[] = COLORS) {
  return render(<ColorsLedger artistId="a1" colors={colors} siteSwatches={SITE} />)
}

const rowOf = (name: string) => screen.getByText(name).closest('[data-ledger-row]') as HTMLElement

/** Type into a contentEditable title or note and press Enter, as InlineText reads it. */
async function typeInto(field: HTMLElement, text: string) {
  act(() => field.focus())
  field.textContent = text
  await act(async () => {
    fireEvent.keyDown(field, { key: 'Enter' })
  })
}

describe('Primary and Secondary, built in', () => {
  it('CRITICAL: lead the page even with no slotted rows at all — derived from the slot list', () => {
    // No colour here has a slot: the database before 20260924130000, or an artist who has
    // picked neither yet. The built-ins must render anyway, empty.
    renderLedger()
    const titles = [...document.querySelectorAll('[data-ledger-row]')].map((r) => r.firstElementChild?.firstElementChild?.textContent)
    expect(titles).toEqual([...COLOR_SLOTS.map((s) => COLOR_SLOT_NAMES[s]), 'Color 1', 'Color 2'])
    for (const slot of COLOR_SLOTS) {
      const row = rowOf(COLOR_SLOT_NAMES[slot])
      expect(within(row).getByText('No color yet')).toBeTruthy()
      const plus = within(row).getByRole('button', { name: 'Add color' })
      expect(plus.className).not.toContain('opacity-40') // the empty row's one action, full ink
    }
  })

  it('CRITICAL: a fixed title and grey guide text — no rename, no note, no trash', () => {
    renderLedger([PRIMARY, ...COLORS])
    for (const title of ['Primary', 'Secondary']) {
      const row = rowOf(title)
      expect(within(row).queryByRole('textbox', { name: 'Name' }), title).toBeNull()
      expect(within(row).queryByRole('textbox', { name: 'Note' }), title).toBeNull()
      expect(within(row).queryByRole('button', { name: 'Remove' }), title).toBeNull()
    }
    expect(within(rowOf('Primary')).getByText('Your main color.')).toBeTruthy()
    expect(within(rowOf('Secondary')).getByText('Your second color.')).toBeTruthy()
    // An added colour keeps all three.
    const row = rowOf('Color 1')
    expect(within(row).getByRole('textbox', { name: 'Name' })).toBeTruthy()
    expect(within(row).getByRole('textbox', { name: 'Note' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeTruthy()
  })

  it('a saved Primary shows its swatch and hex, and its eye opens the playground', () => {
    renderLedger([...COLORS, PRIMARY]) // the server's order does not matter: the slot does
    const row = rowOf('Primary')
    expect(within(row).getByRole('button', { name: 'Primary palette' }).style.backgroundColor).toBe('rgb(229, 72, 77)')
    expect((within(row).getByLabelText('Primary hex') as HTMLInputElement).value).toBe('#e5484d')
    fireEvent.click(within(row).getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('dialog', { name: 'Primary' })).toBeTruthy()
    // Secondary is still empty, and still there.
    expect(within(rowOf('Secondary')).getByText('No color yet')).toBeTruthy()
  })

  it('CRITICAL: the first pick is ONE slot save — and so is every pick after it', async () => {
    renderLedger()
    fireEvent.click(within(rowOf('Secondary')).getByRole('button', { name: 'Add color' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Secondary palette' })).getByRole('button', { name: 'Secondary #0d0d0d' }))
    await settle()
    expect(setBrandColorSlotAction).toHaveBeenCalledTimes(1)
    expect(setBrandColorSlotAction).toHaveBeenCalledWith('a1', 'secondary', '#0d0d0d')
    const hex = within(rowOf('Secondary')).getByLabelText('Secondary hex')
    fireEvent.change(hex, { target: { value: '#2563eb' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await settle()
    expect(setBrandColorSlotAction).toHaveBeenCalledTimes(2)
    expect(vi.mocked(setBrandColorSlotAction).mock.calls[1]).toEqual(['a1', 'secondary', '#2563eb'])
    // Never through the added-colour doors: no second row, no id-keyed write.
    for (const a of [addBrandColorAction, setBrandColorHexAction, renameBrandColorAction, setBrandColorNoteAction]) expect(a).not.toHaveBeenCalled()
  })

  it('picking the colour Primary already is calls nothing', async () => {
    renderLedger([PRIMARY])
    const hex = screen.getByLabelText('Primary hex')
    fireEvent.change(hex, { target: { value: '#E5484D' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await settle()
    for (const a of ALL_ACTIONS) expect(a).not.toHaveBeenCalled()
  })

  it('a refused slot save is an error toast, and the row is back to "No color yet"', async () => {
    vi.mocked(setBrandColorSlotAction).mockResolvedValueOnce({ error: 'Could not save that color.' })
    renderLedger()
    fireEvent.click(within(rowOf('Primary')).getByRole('button', { name: 'Add color' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Primary palette' })).getByRole('button', { name: 'Primary #e5484d' }))
    await settle()
    expect(toast).toHaveBeenCalledWith('Could not save that color.', 'error')
    expect(within(rowOf('Primary')).getByText('No color yet')).toBeTruthy()
  })

  it('CRITICAL: the row shows the colour as soon as it is picked — while the panel is still open', async () => {
    // Sam: after a hex saved with the panel open, the row still said "No color yet +" until
    // the panel closed.
    renderLedger()
    fireEvent.click(within(rowOf('Primary')).getByRole('button', { name: 'Add color' }))
    const box = within(screen.getByRole('dialog', { name: 'Primary palette' })).getByLabelText('Hex')
    fireEvent.change(box, { target: { value: '#2563eb' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await settle()
    expect(setBrandColorSlotAction).toHaveBeenCalledWith('a1', 'primary', '#2563eb')
    expect(screen.getByRole('dialog', { name: 'Primary palette' })).toBeTruthy() // still open
    const row = rowOf('Primary')
    expect(within(row).queryByText('No color yet')).toBeNull()
    expect(within(row).getByRole('button', { name: 'Primary palette' }).style.backgroundColor).toBe('rgb(37, 99, 235)')
    expect((within(row).getByLabelText('Primary hex') as HTMLInputElement).value).toBe('#2563eb')
  })
})

describe('the palette', () => {
  it('CRITICAL: after the built-ins, plain rows with no other role names anywhere', () => {
    const { container } = renderLedger()
    expect(screen.getByText('Color 1')).toBeTruthy()
    expect(screen.getByText('Color 2')).toBeTruthy()
    // Primary and Secondary are the only roles (the playground's parts live in its modal).
    const ROLE = /\b(background|text|accent|border|brand|tertiary)\b/i
    expect(container.textContent).not.toMatch(ROLE)
    for (const el of container.querySelectorAll('[aria-label]')) expect(el.getAttribute('aria-label')).not.toMatch(ROLE)
    for (const el of container.querySelectorAll('[title]')) expect(el.getAttribute('title')).not.toMatch(ROLE)
  })

  it('each row: a renamable title, its note, a swatch painted with its colour, and its hex', () => {
    renderLedger()
    const row = rowOf('Color 1')
    expect(within(row).getByRole('textbox', { name: 'Name' }).textContent).toBe('Color 1')
    expect(within(row).getByRole('textbox', { name: 'Note' }).textContent).toBe('Our black.')
    expect(within(row).getByRole('button', { name: 'Color 1 palette' }).style.backgroundColor).toBe('rgb(13, 13, 13)')
    expect((within(row).getByLabelText('Color 1 hex') as HTMLInputElement).value).toBe('#0d0d0d')
    // An empty note shows its hint.
    expect(within(rowOf('Color 2')).getByRole('textbox', { name: 'Note' }).getAttribute('data-placeholder')).toBe('Add a note…')
  })

  it('renaming a colour saves the new name for THAT colour', async () => {
    renderLedger()
    await typeInto(within(rowOf('Color 1')).getByRole('textbox', { name: 'Name' }), 'Our black')
    expect(renameBrandColorAction).toHaveBeenCalledTimes(1)
    expect(renameBrandColorAction).toHaveBeenCalledWith('a1', 'c1', 'Our black')
  })

  it('its note saves for that colour; clearing it saves null', async () => {
    renderLedger()
    const note = within(rowOf('Color 2')).getByRole('textbox', { name: 'Note' })
    await typeInto(note, 'Warm cream.')
    expect(setBrandColorNoteAction).toHaveBeenLastCalledWith('a1', 'c2', 'Warm cream.')
    await typeInto(within(rowOf('Color 1')).getByRole('textbox', { name: 'Note' }), '')
    expect(setBrandColorNoteAction).toHaveBeenLastCalledWith('a1', 'c1', null)
  })
})

describe('changing a colour', () => {
  it('CRITICAL: a hex typed on the row + Enter saves that colour once', async () => {
    renderLedger()
    const hex = screen.getByLabelText('Color 1 hex')
    fireEvent.change(hex, { target: { value: 'E5484D' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    // The swatch follows at once; the save waits out the debounce.
    expect(screen.getByRole('button', { name: 'Color 1 palette' }).style.backgroundColor).toBe('rgb(229, 72, 77)')
    await settle()
    expect(setBrandColorHexAction).toHaveBeenCalledTimes(1)
    expect(setBrandColorHexAction).toHaveBeenCalledWith('a1', 'c1', '#e5484d')
  })

  it('CRITICAL: picking the colour it already is calls nothing — typed, or from the panel', async () => {
    renderLedger()
    const hex = screen.getByLabelText('Color 1 hex')
    fireEvent.change(hex, { target: { value: '#0D0D0D' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Color 1 palette' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Color 1 palette' })).getByRole('button', { name: 'Color 1 #0d0d0d' }))
    await settle()
    for (const a of ALL_ACTIONS) expect(a).not.toHaveBeenCalled()
  })

  it('a change and back again before the save is no change at all', async () => {
    renderLedger()
    const hex = screen.getByLabelText('Color 1 hex')
    fireEvent.change(hex, { target: { value: '#e5484d' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    fireEvent.change(hex, { target: { value: '#0d0d0d' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await settle()
    expect(setBrandColorHexAction).not.toHaveBeenCalled()
  })

  it('a drag is ONE save, of where it ended — not one per frame', async () => {
    renderLedger()
    fireEvent.click(screen.getByRole('button', { name: 'Color 1 palette' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Color 1 #e5484d' }))
    fireEvent.click(screen.getByRole('button', { name: 'Color 1 palette' }))
    const hue = screen.getByLabelText('Color 1 hue')
    for (const h of [10, 60, 120, 240]) fireEvent.change(hue, { target: { value: String(h) } })
    await settle()
    expect(setBrandColorHexAction).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(setBrandColorHexAction).mock.calls[0][2]
    expect(sent).toBe((screen.getByLabelText('Color 1 hex') as HTMLInputElement).value)
    expect(sent).not.toBe('#e5484d')
  })

  it('CRITICAL: one save at a time — a pick made while one is in flight goes when it returns, not beside it', async () => {
    // busyRef + the re-pump in color-row.tsx: two writes to one row racing could land in
    // either order and leave the database on the OLDER colour. Neither was pinned.
    let release!: (v: { error?: string }) => void
    vi.mocked(setBrandColorHexAction).mockImplementationOnce(() => new Promise((r) => (release = r)))
    renderLedger()
    const hex = screen.getByLabelText('Color 1 hex')
    fireEvent.change(hex, { target: { value: '#e5484d' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await settle() // the first save is out, and not back
    expect(setBrandColorHexAction).toHaveBeenCalledTimes(1)

    fireEvent.change(hex, { target: { value: '#2563eb' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await settle() // its debounce has run out while the first is still in flight
    expect(setBrandColorHexAction).toHaveBeenCalledTimes(1)

    await act(async () => release({}))
    await settle()
    expect(setBrandColorHexAction).toHaveBeenCalledTimes(2)
    expect(vi.mocked(setBrandColorHexAction).mock.calls[1]).toEqual(['a1', 'c1', '#2563eb'])
  })

  it('a refused change is an error toast, and the saved colour comes back', async () => {
    vi.mocked(setBrandColorHexAction).mockResolvedValueOnce({ error: 'That is not a colour.' })
    renderLedger()
    const hex = screen.getByLabelText('Color 1 hex')
    fireEvent.change(hex, { target: { value: '#e5484d' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await settle()
    expect(toast).toHaveBeenCalledWith('That is not a colour.', 'error')
    expect((screen.getByLabelText('Color 1 hex') as HTMLInputElement).value).toBe('#0d0d0d')
    expect(screen.getByRole('button', { name: 'Color 1 palette' }).style.backgroundColor).toBe('rgb(13, 13, 13)')
  })
})

describe('removing a colour', () => {
  it('the trash is faint until its row is hovered', () => {
    renderLedger()
    const trash = within(rowOf('Color 1')).getByRole('button', { name: 'Remove' })
    expect(trash.className).toContain('opacity-40')
    expect(trash.className).toContain('group-hover/ledger:opacity-100')
  })

  it('CRITICAL: asks first; Remove deletes THAT colour and the row goes', async () => {
    renderLedger()
    fireEvent.click(within(rowOf('Color 2')).getByRole('button', { name: 'Remove' }))
    const ask = screen.getByRole('dialog', { name: 'Remove Color 2?' })
    expect(deleteBrandColorAction).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: 'Remove' }))
    })
    expect(deleteBrandColorAction).toHaveBeenCalledWith('a1', 'c2')
    expect(screen.queryByText('Color 2')).toBeNull()
  })

  it('Cancel keeps it and calls nothing', async () => {
    renderLedger()
    fireEvent.click(within(rowOf('Color 2')).getByRole('button', { name: 'Remove' }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove Color 2?' })).getByRole('button', { name: 'Cancel' }))
    })
    expect(deleteBrandColorAction).not.toHaveBeenCalled()
    expect(screen.getByText('Color 2')).toBeTruthy()
  })

  it('a refused delete is an error toast and the row stays', async () => {
    vi.mocked(deleteBrandColorAction).mockResolvedValueOnce({ error: 'That color is no longer there.' })
    renderLedger()
    fireEvent.click(within(rowOf('Color 2')).getByRole('button', { name: 'Remove' }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove Color 2?' })).getByRole('button', { name: 'Remove' }))
    })
    expect(toast).toHaveBeenCalledWith('That color is no longer there.', 'error')
    expect(screen.getByText('Color 2')).toBeTruthy()
  })
})

describe('adding a colour', () => {
  /** "+ Add color" → the pre-filled name → Enter. Returns the new, unsaved row. */
  function startAdd() {
    // The list's own Add control: the one that is not inside a row.
    const add = screen.getAllByRole('button', { name: 'Add color' }).find((b) => !b.closest('[data-ledger-row]'))!
    fireEvent.click(add)
    // Every row title is a "Name" textbox too; the add form's is the real <input>.
    return screen.getAllByRole('textbox', { name: 'Name' }).find((el) => el.tagName === 'INPUT') as HTMLInputElement
  }

  it('pre-fills the next free "Color N" from 3 (1 and 2 are the built-ins), selected so typing replaces it', () => {
    renderLedger([{ ...COLORS[0], name: 'Color 3' }, { ...COLORS[1], name: 'Color 5' }])
    const name = startAdd()
    expect(name.value).toBe('Color 4')
    expect(name.selectionStart).toBe(0)
    expect(name.selectionEnd).toBe('Color 4'.length)
  })

  it('CRITICAL: the first added colour is "Color 3"', () => {
    renderLedger([])
    expect(startAdd().value).toBe('Color 3')
  })

  it('CRITICAL: nothing is saved until the first colour; then ONE save with its name and note', async () => {
    renderLedger()
    const name = startAdd()
    expect(name.value).toBe('Color 3')
    fireEvent.keyDown(name, { key: 'Enter' })

    // The client-only row: "No color yet" and a +, focus in its note.
    const row = rowOf('Color 3')
    expect(within(row).getByText('No color yet')).toBeTruthy()
    const note = within(row).getByRole('textbox', { name: 'Note' })
    expect(document.activeElement).toBe(note)
    await typeInto(note, 'Merch red')
    // Enter moved focus to the row's + — full ink, not a faint row action.
    const plus = within(row).getByRole('button', { name: 'Add color' })
    expect(document.activeElement).toBe(plus)
    expect(plus.className).not.toContain('opacity-40')
    await settle()
    for (const a of ALL_ACTIONS) expect(a).not.toHaveBeenCalled()

    // The + opens the panel. Opening it is still not a colour.
    fireEvent.click(plus)
    const panel = screen.getByRole('dialog', { name: 'Color 3 palette' })
    expect(panel.getAttribute('data-side')).toBe('left')
    await settle()
    for (const a of ALL_ACTIONS) expect(a).not.toHaveBeenCalled()

    // The first pick saves the row, once, with everything it was given.
    fireEvent.click(within(panel).getByRole('button', { name: 'Color 3 #e5484d' }))
    await settle()
    expect(addBrandColorAction).toHaveBeenCalledTimes(1)
    expect(addBrandColorAction).toHaveBeenCalledWith('a1', { name: 'Color 3', hex: '#e5484d', note: 'Merch red' })
    expect(setBrandColorNoteAction).not.toHaveBeenCalled()

    // Now it is a colour row, and a later change is a change to THAT row.
    const saved = rowOf('Color 3')
    expect(within(saved).queryByText('No color yet')).toBeNull()
    const hex = within(saved).getByLabelText('Color 3 hex')
    fireEvent.change(hex, { target: { value: '#2563eb' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await settle()
    expect(addBrandColorAction).toHaveBeenCalledTimes(1)
    expect(setBrandColorHexAction).toHaveBeenCalledWith('a1', 'c-new', '#2563eb')
  })

  it('a rename or note on the unsaved row is carried by the add, not sent on its own', async () => {
    renderLedger()
    fireEvent.keyDown(startAdd(), { key: 'Enter' })
    await typeInto(within(rowOf('Color 3')).getByRole('textbox', { name: 'Name' }), 'Merch red')
    expect(renameBrandColorAction).not.toHaveBeenCalled()
    fireEvent.click(within(rowOf('Merch red')).getByRole('button', { name: 'Add color' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Merch red palette' })).getByRole('button', { name: 'Merch red #2563eb' }))
    await settle()
    expect(addBrandColorAction).toHaveBeenCalledWith('a1', { name: 'Merch red', hex: '#2563eb', note: null })
    expect(renameBrandColorAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: a rename and a note typed WHILE the add is in flight follow it to the new row', async () => {
    // The add carries the name and note the row had when it was SENT. Anything typed after
    // that is only on the page — followUp() sends it once the row has an id. Without it the
    // manager sees "Merch red" and the database keeps "Color 3", with no error anywhere.
    let finish!: (v: { color: BrandColor }) => void
    vi.mocked(addBrandColorAction).mockImplementationOnce(() => new Promise((r) => (finish = r)))
    renderLedger()
    fireEvent.keyDown(startAdd(), { key: 'Enter' })
    fireEvent.click(within(rowOf('Color 3')).getByRole('button', { name: 'Add color' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Color 3 #e5484d' }))
    await settle() // the add is out, carrying "Color 3" and no note
    expect(addBrandColorAction).toHaveBeenCalledWith('a1', { name: 'Color 3', hex: '#e5484d', note: null })

    await typeInto(within(rowOf('Color 3')).getByRole('textbox', { name: 'Name' }), 'Merch red')
    await typeInto(within(rowOf('Merch red')).getByRole('textbox', { name: 'Note' }), 'Tees only')
    expect(renameBrandColorAction).not.toHaveBeenCalled() // no id yet: nothing to rename

    await act(async () => finish({ color: { id: 'c-late', name: 'Color 3', hex: '#e5484d', note: null, sortOrder: 2, slot: null } }))
    await settle()
    expect(renameBrandColorAction).toHaveBeenCalledWith('a1', 'c-late', 'Merch red')
    expect(setBrandColorNoteAction).toHaveBeenCalledWith('a1', 'c-late', 'Tees only')
  })

  it('a refused add is an error toast, and the row is back to "No color yet"', async () => {
    vi.mocked(addBrandColorAction).mockResolvedValueOnce({ error: 'You have 24 colors already.' })
    renderLedger()
    fireEvent.keyDown(startAdd(), { key: 'Enter' })
    fireEvent.click(within(rowOf('Color 3')).getByRole('button', { name: 'Add color' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Color 3 #e5484d' }))
    await settle()
    expect(toast).toHaveBeenCalledWith('You have 24 colors already.', 'error')
    expect(within(rowOf('Color 3')).getByText('No color yet')).toBeTruthy()
  })

  it('CRITICAL: abandoning the unsaved row leaves nothing behind', async () => {
    const view = renderLedger()
    fireEvent.keyDown(startAdd(), { key: 'Enter' })
    // Removing a row that holds nothing needs no question.
    fireEvent.click(within(rowOf('Color 3')).getByRole('button', { name: 'Remove' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Color 3')).toBeNull()
    // …and leaving the page with an unsaved row writes nothing either.
    fireEvent.keyDown(startAdd(), { key: 'Enter' })
    view.unmount()
    await settle()
    for (const a of ALL_ACTIONS) expect(a).not.toHaveBeenCalled()
  })

  it('removing an unsaved row with its first pick still in the debounce saves nothing', async () => {
    renderLedger()
    fireEvent.keyDown(startAdd(), { key: 'Enter' })
    fireEvent.click(within(rowOf('Color 3')).getByRole('button', { name: 'Add color' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Color 3 #e5484d' }))
    fireEvent.click(within(rowOf('Color 3')).getByRole('button', { name: 'Remove' }))
    await settle()
    for (const a of ALL_ACTIONS) expect(a).not.toHaveBeenCalled()
  })

  it('removed while its add is in flight: the colour the add made is deleted again', async () => {
    let finish!: (v: { color: BrandColor }) => void
    vi.mocked(addBrandColorAction).mockImplementationOnce(() => new Promise((r) => (finish = r)))
    renderLedger()
    fireEvent.keyDown(startAdd(), { key: 'Enter' })
    fireEvent.click(within(rowOf('Color 3')).getByRole('button', { name: 'Add color' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Color 3 #e5484d' }))
    await settle() // the add is out, not back
    expect(addBrandColorAction).toHaveBeenCalledTimes(1)
    fireEvent.click(within(rowOf('Color 3')).getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('Color 3')).toBeNull()
    await act(async () => finish({ color: { id: 'c-late', name: 'Color 3', hex: '#e5484d', note: null, sortOrder: 2, slot: null } }))
    expect(deleteBrandColorAction).toHaveBeenCalledWith('a1', 'c-late')
  })

  it('leaving the page mid-debounce still saves the pick', async () => {
    const view = renderLedger()
    const hex = screen.getByLabelText('Color 1 hex')
    fireEvent.change(hex, { target: { value: '#e5484d' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    view.unmount()
    await act(async () => {})
    expect(setBrandColorHexAction).toHaveBeenCalledWith('a1', 'c1', '#e5484d')
  })

  it('at the cap the Add control is gone, and nothing says why', () => {
    // The cap counts Primary and Secondary, and keeps their room: added colours stop at 22.
    expect(MAX_ADDED_COLORS).toBe(MAX_BRAND_COLORS - COLOR_SLOTS.length)
    const { container } = renderLedger(added(MAX_ADDED_COLORS))
    const listAdd = screen.queryAllByRole('button', { name: 'Add color' }).filter((b) => !b.closest('[data-ledger-row]'))
    expect(listAdd).toEqual([])
    // The colours' own names hold numbers; what is left must hold no word about a cap.
    expect(container.textContent!.replace(/Color \d+/g, '')).not.toMatch(/limit|maximum|max|full|\d/i)
  })

  it('CRITICAL: at the cap, Primary and Secondary can still be picked (their room is kept)', async () => {
    renderLedger(added(MAX_ADDED_COLORS))
    fireEvent.click(within(rowOf('Primary')).getByRole('button', { name: 'Add color' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Primary palette' })).getByRole('button', { name: 'Primary #e5484d' }))
    await settle()
    expect(setBrandColorSlotAction).toHaveBeenCalledWith('a1', 'primary', '#e5484d')
  })

  it('one under the cap it is offered; an unsaved row counts toward the cap', () => {
    renderLedger(added(MAX_ADDED_COLORS - 1))
    fireEvent.keyDown(startAdd(), { key: 'Enter' })
    // The list's own Add control is gone; the new row has its + (as do the empty built-ins).
    expect(screen.queryAllByRole('button', { name: 'Add color' }).filter((b) => !b.closest('[data-ledger-row]'))).toEqual([])
    expect(within(rowOf(`Color ${MAX_BRAND_COLORS}`)).getByRole('button', { name: 'Add color' })).toBeTruthy()
  })
})

/**
 * THE BAR'S REVERT (BRAND_SYNC_PLAN.md, 20260925120000). Colours publish now, so Revert can
 * change the palette from outside the page — and this page keeps its own copy, deliberately
 * deaf to refreshes (a refresh landing mid-drag must not snap a swatch back). The bar
 * announces a revert; the next props replace the copy, every row remounted.
 */
describe('a Revert from the Brand bar', () => {
  const reverted: BrandColor[] = [{ ...COLORS[0], hex: '#222222' }, COLORS[1]]
  const hexOf = (name: string) => (screen.getByLabelText(`${name} hex`) as HTMLInputElement).value

  it('the witness: an ordinary refresh does NOT repaint the page\'s copy', () => {
    const { rerender } = renderLedger()
    rerender(<ColorsLedger artistId="a1" colors={reverted} siteSwatches={SITE} />)
    expect(hexOf('Color 1')).toBe('#0d0d0d')
  })

  it('CRITICAL: after the bar reverts, the next props replace the palette', () => {
    const { rerender } = renderLedger()
    act(() => announceBrandRevert())
    rerender(<ColorsLedger artistId="a1" colors={reverted} siteSwatches={SITE} />)
    expect(hexOf('Color 1')).toBe('#222222')
    // …once: the refresh after that is ordinary again.
    rerender(<ColorsLedger artistId="a1" colors={COLORS} siteSwatches={SITE} />)
    expect(hexOf('Color 1')).toBe('#222222')
  })

  it('CRITICAL: a reverted row saves the colour it held BEFORE the revert — its memory went with it', async () => {
    const { rerender } = renderLedger()
    act(() => announceBrandRevert())
    rerender(<ColorsLedger artistId="a1" colors={reverted} siteSwatches={SITE} />)
    const hex = screen.getByLabelText('Color 1 hex')
    fireEvent.change(hex, { target: { value: '#0d0d0d' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    await settle()
    expect(setBrandColorHexAction).toHaveBeenCalledWith('a1', 'c1', '#0d0d0d')
  })
})
