// @vitest-environment jsdom
// The add flow on every Brand list: "+ Add logo" → a name field with ✓ and × → a new row.
/**
 * AddRow (BRAND_PAGE_PLAN.md, Sam 2026-09-23). What has to hold:
 *   - closed, it is one "+ Add <noun>" control that turns ink on hover, with no box;
 *   - open, a name field with ✓ (accent on hover) and × (red on hover);
 *   - Enter is ✓, Escape is ×; an empty name adds nothing;
 *   - ✓ hands the trimmed name to onAdd once, however fast it is pressed (a ref latch);
 *   - colours pre-fill "Color N", SELECTED, so typing replaces it;
 *   - × puts focus back on the Add control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AddRow } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/add-row'

afterEach(cleanup)

const openForm = (props: Partial<Parameters<typeof AddRow>[0]> = {}) => {
  const onAdd = vi.fn()
  render(<AddRow noun="logo" onAdd={onAdd} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: `Add ${props.noun ?? 'logo'}` }))
  return { onAdd, input: screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement }
}

describe('AddRow', () => {
  it('closed: one "Add <noun>" control that turns ink on hover, no background box', () => {
    render(<AddRow noun="font" onAdd={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Add font' })
    expect(btn.textContent).toBe('Add font')
    expect(btn.className).toContain('hover:text-ink')
    expect(btn.className).not.toMatch(/(^|\s)(hover:)?bg-/)
    expect(btn.className).not.toMatch(/(^|\s)border(\s|-)/)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('open: a focused name field with ✓ (accent on hover) and × (red on hover)', () => {
    const { input } = openForm()
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('button', { name: 'Add' }).className).toContain('hover:text-accent')
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('hover:text-accent-red')
    expect(screen.queryByRole('button', { name: 'Add logo' })).toBeNull()
  })

  it('CRITICAL: Enter adds the trimmed name and closes the form', () => {
    const { onAdd, input } = openForm()
    fireEvent.change(input, { target: { value: '  Tertiary logo  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith('Tertiary logo')
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add logo' })).toBeTruthy()
  })

  it('✓ adds, same as Enter', () => {
    const { onAdd, input } = openForm()
    fireEvent.change(input, { target: { value: 'Mono mark' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledWith('Mono mark')
  })

  it('an empty name adds nothing and keeps the form open', () => {
    const { onAdd, input } = openForm()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
  })

  it('CRITICAL: Escape is ×: nothing added, form closed, focus back on the Add control', () => {
    const { onAdd, input } = openForm()
    fireEvent.change(input, { target: { value: 'Half typed' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add logo' }))
  })

  it('× cancels the same way, and reopening starts empty', () => {
    const { onAdd, input } = openForm()
    fireEvent.change(input, { target: { value: 'Gone' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add logo' }))
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('')
  })

  it('CRITICAL: two fast presses add ONE row (the latch is a ref, AGENTS.md rule 5)', () => {
    const { onAdd, input } = openForm()
    fireEvent.change(input, { target: { value: 'Once' } })
    const ok = screen.getByRole('button', { name: 'Add' })
    // Both inside ONE act batch: both handlers read the same pre-render state.
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.click(ok)
    })
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: a colour pre-fills "Color N", selected, so typing replaces it', () => {
    const { input } = openForm({ noun: 'color', prefill: 'Color 4' })
    expect(input.value).toBe('Color 4')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Color 4'.length)
  })

  it('the name is capped at the database limit', () => {
    const { input } = openForm()
    expect(input.maxLength).toBe(40)
  })
})
