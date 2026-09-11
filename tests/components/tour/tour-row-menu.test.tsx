// @vitest-environment jsdom
// The ⋯ menu on a tour date row: Edit opens the modal, Remove deletes after a confirm.
/**
 * TourRow — the row's own options menu (Sam, 2026-09-11: "a three dots button somewhere
 * on the row of the tour date to remove or edit it"). Until this, the ONLY way to edit or
 * delete a date was to click the row and find Delete in the modal's footer.
 *
 *   - the ⋯ button opens a menu with Edit and Remove;
 *   - Edit opens the same modal the row click opens;
 *   - Remove asks first, then calls deleteContentAction('tour_date', id, artistId);
 *   - a declined confirm calls NOTHING — the confirm is the only undo.
 *
 * Actions mocked as in the sibling card tests; the confirm is stubbed per test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  ticket_url: null,
  support: [],
  support_urls: {},
  source: 'manual',
  on_site: true,
}

function renderRow() {
  return render(<TourRow tour={tour} artistId={ARTIST} onSite onToggleOnSite={() => {}} />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('TourRow ⋯ menu', () => {
  it('opens a menu with Edit and Remove', () => {
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: /Mohawk options/ }))
    const menu = screen.getByRole('menu')
    expect(menu).toHaveTextContent('Edit')
    expect(menu).toHaveTextContent('Remove')
  })

  it('Edit opens the edit modal', () => {
    renderRow()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Mohawk options/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit/ }))
    // The modal is headed by the venue (modal-kit), not by "Edit date".
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Mohawk' })).toBeInTheDocument()
  })

  it('CRITICAL: Remove confirms, then deletes THIS date', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: /Mohawk options/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove/ }))
    await waitFor(() => expect(deleteContentAction).toHaveBeenCalledWith('tour_date', 'td-1', ARTIST))
  })

  it('CRITICAL: a declined confirm deletes nothing', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: /Mohawk options/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove/ }))
    await new Promise((r) => setTimeout(r, 20))
    expect(deleteContentAction).not.toHaveBeenCalled()
  })
})
