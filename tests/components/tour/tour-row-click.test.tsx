// @vitest-environment jsdom
// A tour date row: the whole row opens its editor; Delete lives in the editor's footer.
/**
 * TourRow (Sam, 2026-09-13: "Lets remove the 2 dots here and on the tour dates and just
 * make it a click to edit. You click on the row and then you can edit it"). The ⋯ menu
 * that used to carry Edit / Remove is gone; this pins what replaced it:
 *
 *   - there is no ⋯ on a row;
 *   - a click anywhere on the row opens the same modal, headed by the venue;
 *   - the ring and the ticket link do NOT open it — they are their own controls;
 *   - Delete is the modal footer's, asks first, and a declined ask deletes nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TourRow, type TourDate } from '@/app/artists/[id]/(dashboard)/tour/tour-row'
import { deleteContentAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: async () => ({ data: [] }) }),
}))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  updateContentAction: vi.fn(async () => ({})),
  deleteContentAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/entity-sparkline', () => ({
  EntitySparkline: () => <div data-testid="sparkline" />,
}))

const ARTIST = 'artist-1'
const tour: TourDate = {
  id: 'td-1',
  date: '2026-12-01',
  venue: 'Mohawk',
  city: 'Austin',
  state: 'TX',
  country: null,
  is_past: false,
  past: false,
  ticket_url: 'https://tickets.example/mohawk',
  support: [],
  support_urls: {},
  source: 'manual',
  on_site: true,
}

function renderRow(onToggle = vi.fn()) {
  render(<TourRow tour={tour} artistId={ARTIST} onSite onToggleOnSite={onToggle} />)
  return onToggle
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TourRow — click to edit', () => {
  it('CRITICAL: has no ⋯ — the row is the way in', () => {
    renderRow()
    expect(screen.queryByRole('button', { name: /options/ })).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a click on the row opens the editor, headed by the venue', () => {
    renderRow()
    expect(screen.queryByRole('dialog')).toBeNull()
    // The place text is not a button of its own — the ROW is what opens the editor.
    fireEvent.click(screen.getByText('Austin, TX'))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Mohawk' })).toBeInTheDocument()
  })

  it('the ring and the ticket link are their own controls — neither opens the editor', () => {
    const onToggle = renderRow()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('link', { name: 'Tickets' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('CRITICAL: Delete is the footer’s — it asks, then deletes THIS date', async () => {
    renderRow()
    fireEvent.click(screen.getByText('Austin, TX'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Mohawk' })).getByRole('button', { name: 'Delete' }))
    const ask = screen.getByRole('dialog', { name: /delete this date/i })
    expect(deleteContentAction).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }))
    })
    expect(deleteContentAction).toHaveBeenCalledWith('tour_date', 'td-1', ARTIST)
  })

  it('a declined ask deletes nothing', async () => {
    renderRow()
    fireEvent.click(screen.getByText('Austin, TX'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Mohawk' })).getByRole('button', { name: 'Delete' }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog', { name: /delete this date/i })).getByRole('button', { name: 'Cancel' }))
    })
    expect(deleteContentAction).not.toHaveBeenCalled()
  })
})
