// @vitest-environment jsdom
// Adding a tour date: the same card as editing one, rows as inputs, one Add button, no old-show toggle.
/**
 * TourAddButton after the redesign (prototype G, 2026-09-11). The Add card is the edit
 * card with its rows as inputs:
 *
 *   - Date, Venue, City · State · Country, Tickets are rows; Lineup takes acts (with
 *     websites) before the row exists;
 *   - Add posts the fields as ONE FormData through addContentAction('tour_date') —
 *     acts ride as `support` entries; their links are written right after, by id;
 *   - `is_past` is never posted: a date in the past is an old show by itself;
 *   - a refused add shows the error and keeps the card open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TourAddButton } from '@/app/artists/[id]/(dashboard)/tour/tour-add'
import { addContentAction, setSupportActsAction } from '@/app/artists/[id]/(dashboard)/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  addContentAction: vi.fn(async () => ({ id: 'td-new' })),
  setSupportActsAction: vi.fn(async (_a: string, _t: string, acts: unknown) => ({ acts })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

const ARTIST = 'artist-1'

function openAdd() {
  render(<TourAddButton artistId={ARTIST} />)
  fireEvent.click(screen.getByRole('button', { name: /add/i }))
  return screen.getByRole('dialog')
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('add a tour date', () => {
  it('posts the rows as one FormData, without is_past', async () => {
    const dialog = openAdd()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-12-01' } })
    fireEvent.change(within(dialog).getByLabelText('Venue'), { target: { value: 'Scoot Inn' } })
    fireEvent.change(within(dialog).getByLabelText('City'), { target: { value: 'Austin' } })
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'State' }))
    fireEvent.click(within(dialog).getByRole('option', { name: 'TX · Texas' }))
    fireEvent.change(within(dialog).getByLabelText('Tickets'), { target: { value: 'https://tix.example' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add date' }))
    await waitFor(() => expect(addContentAction).toHaveBeenCalledTimes(1))
    const [type, artistId, fd] = vi.mocked(addContentAction).mock.calls[0]
    expect([type, artistId]).toEqual(['tour_date', ARTIST])
    const form = fd as FormData
    expect(form.get('date')).toBe('2026-12-01')
    expect(form.get('venue')).toBe('Scoot Inn')
    expect(form.get('city')).toBe('Austin')
    expect(form.get('state')).toBe('TX')
    expect(form.get('ticket_url')).toBe('https://tix.example')
    expect(form.has('is_past')).toBe(false)
  })

  it('acts added before the row exists are written by the new id, links included', async () => {
    const dialog = openAdd()
    fireEvent.change(within(dialog).getByLabelText('Venue'), { target: { value: 'Scoot Inn' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add act' }))
    const pop = screen.getByRole('dialog', { name: /act/i })
    fireEvent.change(within(pop).getByLabelText('Name'), { target: { value: 'Jigitz' } })
    fireEvent.change(within(pop).getByLabelText('Website'), { target: { value: 'https://www.jigitz.online/' } })
    fireEvent.click(within(pop).getByRole('button', { name: 'Done' }))
    expect(within(dialog).getByRole('button', { name: 'Jigitz, linked' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add date' }))
    await waitFor(() => expect(setSupportActsAction).toHaveBeenCalledWith(ARTIST, 'td-new', [{ name: 'Jigitz', url: 'https://www.jigitz.online/' }]))
    // The names ride the create too, so a row is never born with an empty bill.
    expect((vi.mocked(addContentAction).mock.calls[0][2] as FormData).getAll('support')).toContain('Jigitz')
  })

  it('has no old-show toggle', () => {
    const dialog = openAdd()
    expect(within(dialog).queryByText(/old show/i)).toBeNull()
  })

  it('CRITICAL: a refused add shows the error and keeps the card open', async () => {
    vi.mocked(addContentAction).mockResolvedValueOnce({ error: 'Fill in at least one field.' })
    const dialog = openAdd()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add date' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Fill in at least one field.', 'error'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
