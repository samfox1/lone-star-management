// @vitest-environment jsdom
// The click-to-edit list: plain text at rest, click to edit or delete, a bare + to add.
/**
 * EditList (_ui/edit-list.tsx), lifted from Settings › Email (Sam, 2026-10-02: "when I click on a
 * submitted email, then I can edit it or delete it … I want minimal stuff on the screen"). Nine
 * more lists will use it, so its rules are pinned here once, against a plain list of strings:
 *
 *   - at rest an item is its text alone (a button); clicking it opens a field, ✓ and a trash,
 *     plus any extra controls, which exist ONLY while it is open;
 *   - Enter or ✓ saves the trimmed text (only when it changed) and focus returns to the item;
 *   - Escape or a click away puts it back and saves nothing;
 *   - a refusal (validate, or the save's own `{ error }`) says why and KEEPS what was typed;
 *   - the bare + opens a field; Enter adds; Escape closes it; focus returns to the +;
 *   - two presses in one tick save once (AGENTS.md rule 5: the latch is a ref).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/edit-list'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

const onSave = vi.fn<(index: number, value: string) => { error?: string } | void>()
const onAdd = vi.fn<(value: string) => { error?: string } | void>()
const onRemove = vi.fn<(index: number) => void>()

/** A repeat (case-insensitive) is refused, the way Settings › Email refuses one. */
const noRepeat = (items: string[]) => (value: string, index: number | null) =>
  items.some((it, j) => j !== index && it.toLowerCase() === value.toLowerCase()) ? 'Already on the list.' : null

function mount(items = ['a@x.com', 'b@x.com'], extra = false) {
  return render(
    <EditList
      items={items}
      text={(s) => s}
      label="Email"
      addLabel="Add email"
      addFieldLabel="New email"
      removeLabel={(s) => `Remove ${s}`}
      maxLength={254}
      validate={noRepeat(items)}
      onSave={onSave}
      onAdd={onAdd}
      onRemove={onRemove}
      extra={extra ? (s) => <button type="button">{`On site: ${s}`}</button> : undefined}
    />,
  )
}

const item = (text: string) => screen.getByRole('button', { name: text })
const field = () => screen.getByRole('textbox', { name: 'Email' })

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('an item', () => {
  it('is plain text at rest; a click opens its field, ✓, trash and extras, which only it shows', () => {
    mount(undefined, true)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove a@x.com' })).toBeNull()
    expect(screen.queryByRole('button', { name: /On site/ })).toBeNull()

    fireEvent.click(item('a@x.com'))
    expect(field()).toHaveValue('a@x.com')
    expect(document.activeElement).toBe(field())
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove a@x.com' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'On site: a@x.com' })).toBeTruthy()
    // The other item stays text: one open at a time is the open one's business only.
    expect(screen.queryByRole('button', { name: 'On site: b@x.com' })).toBeNull()
  })

  it('Enter saves the trimmed text, closes, and hands focus back to the item', async () => {
    mount()
    fireEvent.click(item('a@x.com'))
    fireEvent.change(field(), { target: { value: '  a2@x.com  ' } })
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' })
    })
    expect(onSave).toHaveBeenCalledWith(0, 'a2@x.com')
    expect(screen.queryByRole('textbox')).toBeNull()
    // The parent owns the list; it has not changed it here, so the item reads as before.
    expect(document.activeElement).toBe(item('a@x.com'))
  })

  it('✓ saves too; an unchanged item saves nothing and just closes', async () => {
    mount()
    fireEvent.click(item('b@x.com'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(item('b@x.com'))
    fireEvent.change(field(), { target: { value: 'c@x.com' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(onSave).toHaveBeenCalledWith(1, 'c@x.com')
  })

  it('Escape puts it back, saves nothing, and returns focus to the item', () => {
    mount()
    fireEvent.click(item('a@x.com'))
    fireEvent.change(field(), { target: { value: 'typo' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(item('a@x.com'))
  })

  it('a click away puts it back and saves nothing', () => {
    mount()
    fireEvent.click(item('a@x.com'))
    fireEvent.change(field(), { target: { value: 'typo' } })
    fireEvent.focusOut(field(), { relatedTarget: document.body })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('CRITICAL: a refused edit says why and KEEPS what was typed, open', async () => {
    mount()
    fireEvent.click(item('a@x.com'))
    fireEvent.change(field(), { target: { value: 'B@X.COM' } })
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' })
    })
    expect(onSave).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('Already on the list.', 'error')
    expect(field()).toHaveValue('B@X.COM')

    // The save's own refusal keeps the draft the same way.
    onSave.mockReturnValueOnce({ error: 'A list holds at most 10 people.' })
    fireEvent.change(field(), { target: { value: 'z@x.com' } })
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' })
    })
    expect(toast).toHaveBeenLastCalledWith('A list holds at most 10 people.', 'error')
    expect(field()).toHaveValue('z@x.com')
  })

  it('CRITICAL: Enter and ✓ in one tick save ONCE (the latch is a ref)', async () => {
    let release!: () => void
    onSave.mockImplementationOnce(() => new Promise<void>((r) => (release = r)) as never)
    mount()
    fireEvent.click(item('a@x.com'))
    fireEvent.change(field(), { target: { value: 'once@x.com' } })
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => release())
  })

  it('the trash removes THAT item', () => {
    mount()
    fireEvent.click(item('b@x.com'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove b@x.com' }))
    expect(onRemove).toHaveBeenCalledWith(1)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('the +', () => {
  const plus = () => screen.getByRole('button', { name: 'Add email' })
  const addField = () => screen.getByRole('textbox', { name: 'New email' })

  it('is a bare glyph with no words; it opens a field, and Enter adds the trimmed text', async () => {
    mount()
    expect(plus().textContent).toBe('')
    fireEvent.click(plus())
    expect(document.activeElement).toBe(addField())
    fireEvent.change(addField(), { target: { value: '  new@x.com ' } })
    await act(async () => {
      fireEvent.keyDown(addField(), { key: 'Enter' })
    })
    expect(onAdd).toHaveBeenCalledWith('new@x.com')
    expect(screen.queryByRole('textbox', { name: 'New email' })).toBeNull()
    expect(document.activeElement).toBe(plus())
  })

  it('Escape closes it, adds nothing, and returns focus to the +; empty adds nothing', async () => {
    mount()
    fireEvent.click(plus())
    await act(async () => {
      fireEvent.keyDown(addField(), { key: 'Enter' })
    })
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.change(addField(), { target: { value: 'half' } })
    fireEvent.keyDown(addField(), { key: 'Escape' })
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(plus())
  })

  it('CRITICAL: a refused add says why and keeps what was typed', async () => {
    mount()
    fireEvent.click(plus())
    fireEvent.change(addField(), { target: { value: 'A@x.com' } })
    await act(async () => {
      fireEvent.keyDown(addField(), { key: 'Enter' })
    })
    expect(onAdd).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('Already on the list.', 'error')
    expect(addField()).toHaveValue('A@x.com')
  })
})
