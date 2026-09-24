// @vitest-environment jsdom
// Renamable titles and editable notes on Brand rows: underline only, Enter or blur saves.
/**
 * RowTitle + NoteField (BRAND_PAGE_PLAN.md, Sam 2026-09-23). What has to hold:
 *
 *   RowTitle  Enter or a click away saves the trimmed name through onRename; an EMPTY or
 *             UNCHANGED name puts the old one back without calling; Escape puts it back;
 *             a refusal is an error toast and the old name returns.
 *   NoteField the "Add a note…" hint shows even while focused and empty; Enter saves and
 *             hands focus to the row's primary action when there is one, else blurs;
 *             clearing a note is a save; a save is SILENT (no toast); autoFocus lands once.
 *
 * Both are contentEditable, so the text is typed by writing textContent and firing
 * `input` — what the browser does between keystrokes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { NoteField, RowTitle } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/inline-text'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(cleanup)

function type(el: HTMLElement, text: string) {
  act(() => el.focus())
  el.textContent = text
  fireEvent.input(el)
}

describe('RowTitle', () => {
  const setup = (value = 'Color 1', onRename = vi.fn(async (next: string): Promise<void | { error?: string }> => void next)) => {
    render(<RowTitle value={value} onRename={onRename} />)
    return { el: screen.getByRole('textbox', { name: 'Name' }), onRename }
  }

  it('Enter saves the trimmed name and leaves the field', async () => {
    const { el, onRename } = setup()
    type(el, '  Our black  ')
    await act(async () => fireEvent.keyDown(el, { key: 'Enter' }))
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('Our black')
    expect(document.activeElement).not.toBe(el)
  })

  it('a click away saves too', async () => {
    const { el, onRename } = setup()
    type(el, 'Our black')
    await act(async () => el.blur())
    expect(onRename).toHaveBeenCalledWith('Our black')
  })

  it('CRITICAL: an EMPTY name puts the old one back and never calls', async () => {
    const { el, onRename } = setup()
    type(el, '   ')
    await act(async () => fireEvent.keyDown(el, { key: 'Enter' }))
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('Color 1')
  })

  it('an UNCHANGED name never calls', async () => {
    const { el, onRename } = setup()
    type(el, 'Color 1')
    await act(async () => el.blur())
    expect(onRename).not.toHaveBeenCalled()
  })

  it('CRITICAL: Escape puts the old name back and never calls', async () => {
    const { el, onRename } = setup()
    type(el, 'Something else')
    await act(async () => fireEvent.keyDown(el, { key: 'Escape' }))
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('Color 1')
    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'Name' }))
  })

  it('a refused rename is an ERROR toast and the old name comes back', async () => {
    const onRename = vi.fn(async () => ({ error: 'That name is taken.' }))
    const { el } = setup('Color 1', onRename)
    type(el, 'Color 2')
    await act(async () => fireEvent.keyDown(el, { key: 'Enter' }))
    expect(toast).toHaveBeenCalledWith('That name is taken.', 'error')
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('Color 1')
  })

  it('clamps to maxLength (the database allows 40)', async () => {
    const { el, onRename } = setup()
    type(el, 'x'.repeat(60))
    await act(async () => fireEvent.keyDown(el, { key: 'Enter' }))
    expect(onRename).toHaveBeenCalledWith('x'.repeat(40))
  })

  it('a line break can never reach the name (the database refuses CR/LF)', async () => {
    const { el, onRename } = setup()
    type(el, 'Our\nblack')
    await act(async () => el.blur())
    expect(onRename).toHaveBeenCalledWith('Our black')
  })

  it('focus shows only a thin underline — no box, no ring', () => {
    const { el } = setup()
    expect(el.className).toContain('border-b')
    expect(el.className).toContain('focus:border-ink')
    expect(el.className).toContain('outline-none')
    const boxy = el.className.split(/\s+/).filter((c) => /^(ring|rounded|border$|border-(?!b$|transparent$))/.test(c))
    expect(boxy).toEqual([])
  })

  it('shows the new value when the parent sends one (a refresh after another save)', () => {
    const { rerender } = render(<RowTitle value="Color 1" onRename={vi.fn()} />)
    rerender(<RowTitle value="Night" onRename={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Name' }).textContent).toBe('Night')
  })
})

describe('NoteField', () => {
  it('CRITICAL: the hint is there while focused and empty (never hidden on focus)', () => {
    render(<NoteField value="" onSave={vi.fn()} />)
    const el = screen.getByRole('textbox', { name: 'Note' })
    act(() => el.focus())
    expect(el.getAttribute('data-placeholder')).toBe('Add a note…')
    expect(el.getAttribute('aria-placeholder')).toBe('Add a note…')
    expect(el.textContent).toBe('')
    // The hint is `:empty::before`, which holds while focused; nothing may hide it on focus.
    expect(el.className).toContain('empty:before:content-[attr(data-placeholder)]')
    expect(el.className).not.toMatch(/focus:before:(hidden|content-none|opacity-0)/)
  })

  it('CRITICAL: Enter saves and hands focus to the row\'s primary action', async () => {
    const onSave = vi.fn(async () => undefined)
    function Row() {
      const primary = useRef<HTMLButtonElement>(null)
      return (
        <>
          <NoteField value="" onSave={onSave} primaryRef={primary} />
          <button ref={primary} type="button">Add logo</button>
        </>
      )
    }
    render(<Row />)
    const el = screen.getByRole('textbox', { name: 'Note' })
    type(el, 'For dark backgrounds.')
    await act(async () => fireEvent.keyDown(el, { key: 'Enter' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('For dark backgrounds.')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add logo' }))
  })

  it('without a primary action, Enter saves and blurs', async () => {
    const onSave = vi.fn(async () => undefined)
    render(<NoteField value="" onSave={onSave} />)
    const el = screen.getByRole('textbox', { name: 'Note' })
    type(el, 'A note')
    await act(async () => fireEvent.keyDown(el, { key: 'Enter' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(document.body)
  })

  it('clearing a note IS a save (empty is allowed here, unlike a title)', async () => {
    const onSave = vi.fn(async () => undefined)
    render(<NoteField value="Old note" onSave={onSave} />)
    const el = screen.getByRole('textbox', { name: 'Note' })
    type(el, '')
    await act(async () => el.blur())
    expect(onSave).toHaveBeenCalledWith('')
  })

  it('an unchanged note never calls, and Escape never calls', async () => {
    const onSave = vi.fn(async () => undefined)
    render(<NoteField value="Same" onSave={onSave} />)
    const el = screen.getByRole('textbox', { name: 'Note' })
    type(el, 'Same')
    await act(async () => el.blur())
    type(el, 'Different')
    await act(async () => fireEvent.keyDown(el, { key: 'Escape' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Note' }).textContent).toBe('Same')
  })

  it('a save is SILENT — no toast on success', async () => {
    render(<NoteField value="" onSave={vi.fn(async () => undefined)} />)
    const el = screen.getByRole('textbox', { name: 'Note' })
    type(el, 'Quiet')
    await act(async () => el.blur())
    expect(toast).not.toHaveBeenCalled()
  })

  it('a refused note is an error toast and the old note returns', async () => {
    render(<NoteField value="Old" onSave={vi.fn(async () => ({ error: 'Too long.' }))} />)
    const el = screen.getByRole('textbox', { name: 'Note' })
    type(el, 'New')
    await act(async () => el.blur())
    expect(toast).toHaveBeenCalledWith('Too long.', 'error')
    expect(screen.getByRole('textbox', { name: 'Note' }).textContent).toBe('Old')
  })

  it('CRITICAL: autoFocus lands ONCE — a saved note does not pull focus back', async () => {
    // The add flow: focus lands in the new row's note, Enter moves it to the +. The parent
    // then re-renders with the saved note; the field must not grab focus again.
    function Row() {
      const primary = useRef<HTMLButtonElement>(null)
      const [note, setNote] = useState('')
      return (
        <>
          <NoteField value={note} onSave={(n) => setNote(n)} primaryRef={primary} autoFocus />
          <button ref={primary} type="button">Add color</button>
        </>
      )
    }
    render(<Row />)
    const el = screen.getByRole('textbox', { name: 'Note' })
    expect(document.activeElement).toBe(el)
    type(el, 'Warm cream')
    await act(async () => fireEvent.keyDown(el, { key: 'Enter' }))
    expect(screen.getByRole('textbox', { name: 'Note' }).textContent).toBe('Warm cream')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add color' }))
  })

  it('Enter saves once, not twice (the blur that follows is not a second save)', async () => {
    const onSave = vi.fn(async () => undefined)
    render(<NoteField value="" onSave={onSave} />)
    const el = screen.getByRole('textbox', { name: 'Note' })
    type(el, 'Once')
    await act(async () => fireEvent.keyDown(el, { key: 'Enter' }))
    await act(async () => el.blur())
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
