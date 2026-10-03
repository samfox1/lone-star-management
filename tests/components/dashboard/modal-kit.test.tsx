// @vitest-environment jsdom
// The modal row kit: a label / value row that turns into an input when clicked and saves ONE field.
/**
 * modal-kit — the grammar every dashboard modal is built from (prototype G, 2026-09-11):
 * usually no title (2026-10-02; else a few plain words naming WHICH item), label / value
 * ROWS, and a Delete / Save footer.
 *
 * The row is the load-bearing piece, so it is what gets pinned:
 *   - a value reads as text until clicked, then it is an input with that value;
 *   - an EMPTY value reads as "—" (never a blank line, never a placeholder);
 *   - blur / Enter saves ONLY when the value changed — an untouched row never writes;
 *   - Escape puts the old value back and saves nothing;
 *   - a refused save keeps the OLD value on screen and reports the error;
 *   - KvCells: three cells on one row, each saving its own field alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { KvCells, KvField } from '@/app/artists/[id]/(dashboard)/modal-kit'
import { CardModal } from '@/app/artists/[id]/(dashboard)/card-modal'

afterEach(() => cleanup())

/**
 * THE TITLE (Sam, 2026-10-02: "I dont like these type of headers in modals. Remove it if its
 * not needed, or make it simple, a few words, no icons"). It lives on CardModal's top bar.
 * Light tier: the mechanism, not the pixels.
 */
describe('CardModal title', () => {
  it("a title is the item's name in plain words: one heading, nothing beside it but the corner controls", () => {
    render(
      <CardModal open onClose={vi.fn()} title="Oct 15, 2026 · Scoot Inn" label="Scoot Inn">
        <p>body</p>
      </CardModal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Scoot Inn' })
    const heading = within(dialog).getByRole('heading', { name: 'Oct 15, 2026 · Scoot Inn' })
    // The bar holds the heading and the corner group (×) — no mark, no picture, no meta line.
    expect(heading.parentElement!.children).toHaveLength(2)
    expect(heading.querySelector('svg, img')).toBeNull()
  })
  it('no title: no heading at all, and the dialog keeps its accessible name from `label`', () => {
    render(
      <CardModal open onClose={vi.fn()} label="Bio">
        <p>body</p>
      </CardModal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Bio' })
    expect(within(dialog).queryByRole('heading')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})

describe('KvField', () => {
  it('reads as text, and an empty value reads as "—"', () => {
    render(
      <>
        <KvField label="Venue" value="Scoot Inn" onSave={vi.fn()} />
        <KvField label="Country" value="" onSave={vi.fn()} />
      </>,
    )
    expect(screen.getByText('Scoot Inn')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('click → input holding the value; a changed value saves on blur', async () => {
    const onSave = vi.fn(async () => ({}))
    render(<KvField label="Venue" value="Scoot Inn" onSave={onSave} />)
    fireEvent.click(screen.getByText('Scoot Inn'))
    const input = screen.getByRole('textbox', { name: 'Venue' })
    expect(input).toHaveValue('Scoot Inn')
    fireEvent.change(input, { target: { value: 'Mohawk' } })
    fireEvent.blur(input)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Mohawk'))
    expect(screen.getByText('Mohawk')).toBeInTheDocument()
  })

  it('CRITICAL: an unchanged value never saves', () => {
    const onSave = vi.fn(async () => ({}))
    render(<KvField label="Venue" value="Scoot Inn" onSave={onSave} />)
    fireEvent.click(screen.getByText('Scoot Inn'))
    fireEvent.blur(screen.getByRole('textbox', { name: 'Venue' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Scoot Inn')).toBeInTheDocument()
  })

  it('Enter saves; Escape restores the old value and saves nothing', async () => {
    const onSave = vi.fn(async () => ({}))
    render(<KvField label="Venue" value="Scoot Inn" onSave={onSave} />)
    fireEvent.click(screen.getByText('Scoot Inn'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Venue' }), { target: { value: 'Nope' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Venue' }), { key: 'Escape' })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Scoot Inn')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Scoot Inn'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Venue' }), { target: { value: 'Mohawk' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Venue' }), { key: 'Enter' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Mohawk'))
  })

  it('CRITICAL: a refused save keeps the old value and reports the error', async () => {
    const onSave = vi.fn(async () => ({ error: 'Enter a valid URL.' }))
    const onError = vi.fn()
    render(<KvField label="Tickets" value="" onSave={onSave} onError={onError} />)
    fireEvent.click(screen.getByText('—'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Tickets' }), { target: { value: 'javascript:alert(1)' } })
    fireEvent.blur(screen.getByRole('textbox', { name: 'Tickets' }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Enter a valid URL.'))
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('KvCells', () => {
  it('three cells on one row, each saving its own field', async () => {
    const city = vi.fn(async () => ({}))
    const state = vi.fn(async () => ({}))
    const country = vi.fn(async () => ({}))
    render(
      <KvCells
        label="Where"
        cells={[
          { label: 'City', value: 'Austin', onSave: city },
          { label: 'State', value: 'TX', onSave: state, options: [{ value: 'TX', label: 'TX · Texas' }, { value: 'IL', label: 'IL · Illinois' }] },
          { label: 'Country', value: '', onSave: country },
        ]}
      />,
    )
    expect(screen.getByText('Austin')).toBeInTheDocument()
    expect(screen.getByText('—', { selector: 'span' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Austin'))
    fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Chicago' } })
    fireEvent.blur(screen.getByRole('textbox', { name: 'City' }))
    await waitFor(() => expect(city).toHaveBeenCalledWith('Chicago'))
    expect(state).not.toHaveBeenCalled()
    expect(country).not.toHaveBeenCalled()
    // A choice cell is the site's own menu (no native select): open it, pick, it saves.
    fireEvent.click(screen.getByRole('combobox', { name: 'State' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['—', 'TX · Texas', 'IL · Illinois'])
    fireEvent.click(screen.getByRole('option', { name: 'IL · Illinois' }))
    await waitFor(() => expect(state).toHaveBeenCalledWith('IL'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
