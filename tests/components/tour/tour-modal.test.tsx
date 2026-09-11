// @vitest-environment jsdom
// The tour date's modal: header + rows, each row saving its own field; no "old show" toggle.
/**
 * TourRow's modal after the redesign (prototype G, 2026-09-11):
 *
 *   - the header is the VENUE (title) with place · date · clicks as mono meta — there
 *     is no "Edit date" heading;
 *   - Date, Venue, Where (city · state · country on one row), Tickets, Lineup are rows;
 *   - editing a row saves THAT field only, through updateContentAction;
 *   - there is NO old-show toggle: a date in the past IS an old show (Sam: "the user can
 *     just add a date that is in the past") — `is_past` is never posted from here;
 *   - the footer is Delete / Done and nothing else.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TourRow, type TourDate } from '@/app/artists/[id]/(dashboard)/tour/tour-row'
import { updateContentAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async () => ({ data: [] }) }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  updateContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
  setSupportActsAction: vi.fn(async (_a: string, _t: string, acts: unknown) => ({ acts })),
}))

const ARTIST = 'artist-1'
const tour: TourDate = {
  id: 'td-1',
  date: '2026-12-01',
  venue: 'Scoot Inn',
  city: 'Austin',
  state: 'TX',
  country: null,
  is_past: false,
  past: false,
  ticket_url: null,
  support: ['Jigitz'],
  support_urls: { Jigitz: 'https://www.jigitz.online/' },
  source: 'manual',
  on_site: true,
  stat: 4,
}

function openModal() {
  render(<TourRow tour={tour} artistId={ARTIST} onSite onToggleOnSite={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Scoot Inn options/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Edit/ }))
  return screen.getByRole('dialog')
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('tour date modal', () => {
  it('is headed by the venue, with the place as meta — no "Edit date"', () => {
    const dialog = openModal()
    expect(within(dialog).getByRole('heading', { name: 'Scoot Inn' })).toBeInTheDocument()
    expect(within(dialog).getByText(/Austin, TX/)).toBeInTheDocument()
    expect(within(dialog).queryByText('Edit date')).toBeNull()
  })

  it('shows no click numbers; one Analytics button goes to the analytics page instead', () => {
    // Sam (2026-09-11): "I don't need the click info on these modals." The stat is 4 on
    // the fixture, so a leaked number would show up here.
    const dialog = openModal()
    expect(within(dialog).queryByText(/clicks/i)).toBeNull()
    expect(within(dialog).queryByText(/^4$/)).toBeNull()
    expect(within(dialog).getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', `/artists/${ARTIST}`)
  })

  it('CRITICAL: has no old-show toggle and never posts is_past', async () => {
    const dialog = openModal()
    expect(within(dialog).queryByText(/old show/i)).toBeNull()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    // Edit a field; the write must carry that field alone.
    fireEvent.click(within(dialog).getByText('Scoot Inn', { selector: 'span' }))
    const input = within(dialog).getByRole('textbox', { name: 'Venue' })
    fireEvent.change(input, { target: { value: 'Mohawk' } })
    fireEvent.blur(input)
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    const [type, id, artistId, fd] = vi.mocked(updateContentAction).mock.calls[0]
    expect([type, id, artistId]).toEqual(['tour_date', 'td-1', ARTIST])
    expect([...(fd as FormData).keys()]).toEqual(['venue'])
    expect((fd as FormData).get('venue')).toBe('Mohawk')
  })

  it('city · state · country sit on one row and save one at a time', async () => {
    const dialog = openModal()
    fireEvent.click(within(dialog).getByText('Austin'))
    const city = within(dialog).getByRole('textbox', { name: 'City' })
    fireEvent.change(city, { target: { value: 'Chicago' } })
    fireEvent.blur(city)
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    expect([...(vi.mocked(updateContentAction).mock.calls[0][3] as FormData).keys()]).toEqual(['city'])
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'State' }))
    fireEvent.click(within(dialog).getByRole('option', { name: 'IL · Illinois' }))
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(2))
    expect((vi.mocked(updateContentAction).mock.calls[1][3] as FormData).get('state')).toBe('IL')
  })

  it('the lineup row shows the acts as chips', () => {
    const dialog = openModal()
    expect(within(dialog).getByRole('button', { name: 'Jigitz, linked' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add act' })).toBeInTheDocument()
  })

  it('the footer is Delete and Done only', () => {
    const dialog = openModal()
    expect(within(dialog).getByRole('button', { name: /Delete/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Save/ })).toBeNull()
  })
})
