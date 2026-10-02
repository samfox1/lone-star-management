// @vitest-environment jsdom
// Settings · General: three ledger rows, one field you type into, two you cannot.
/**
 * SettingsView (2026-09-13; Brand's ledger since Batch 3, 2026-10-02). What has to hold:
 *
 *   - Site and Address are text, not controls: no input, no pencil;
 *   - Booking email is a field in place: saves through its door on blur or Enter, and only
 *     when CHANGED;
 *   - a refused save puts the old value back and says why;
 *   - Escape puts the old value back without saving.
 *
 * The name moved to Profile on 2026-10-02 (tests/components/manager-tools/profile/).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsView } from '@/app/artists/[id]/(dashboard)/(manager-tools)/settings/settings-view'
import { saveBookingEmailAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/settings/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import type { SettingsRow } from '@/lib/settings'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/settings/actions', () => ({
  saveBookingEmailAction: vi.fn(async (_a: string, email: string) => ({ value: email || null })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ROWS: SettingsRow[] = [
  { key: 'booking_email', label: 'Booking email', value: 'ross@example.com', editable: true, mono: true, sub: 'Enquiries from the site go here' },
  { key: 'site', label: 'Site', value: 'skeenmusic.com', editable: false, mono: true },
  { key: 'address', label: 'Address', value: 'lonestar.site/skeen', editable: false, mono: true },
]

function mount() {
  render(<SettingsView artistId="a1" rows={ROWS} />)
}
const field = () => screen.getByRole('textbox', { name: 'Booking email' }) as HTMLInputElement
function edit(next: string, key: 'blur' | 'Enter' = 'blur') {
  fireEvent.change(field(), { target: { value: next } })
  if (key === 'blur') fireEvent.blur(field())
  else fireEvent.keyDown(field(), { key: 'Enter' })
}

describe('the rows', () => {
  it('CRITICAL: Site and Address are text — no input, no pencil', () => {
    mount()
    expect(screen.getByText('skeenmusic.com')).toBeInTheDocument()
    expect(screen.getByText('lonestar.site/skeen')).toBeInTheDocument()
    // The ONE field on the page is the booking email.
    expect(screen.getAllByRole('textbox')).toEqual([field()])
    expect(screen.queryByRole('button', { name: /site|address/i })).toBeNull()
  })

  it('Booking email is a field holding the address, with the state line under it and a pencil to it', () => {
    mount()
    expect(field().value).toBe('ross@example.com')
    expect(screen.getByText('Enquiries from the site go here')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the booking email' }))
    expect(document.activeElement).toBe(field())
  })
})

describe('Booking email', () => {
  it('CRITICAL: saves through its door on blur, with what was typed', async () => {
    mount()
    edit('bookings@example.com')
    await waitFor(() => expect(saveBookingEmailAction).toHaveBeenCalledWith('a1', 'bookings@example.com'))
    expect(field().value).toBe('bookings@example.com')
  })

  it('Enter saves ONCE; Escape puts the old value back and saves nothing', async () => {
    mount()
    // Focused, as a person's field is: then Enter and Escape blur it from inside the key
    // handler, and that blur must not save a second time (or save the Escaped text).
    field().focus()
    edit('bookings@example.com', 'Enter')
    await act(async () => {})
    expect(saveBookingEmailAction).toHaveBeenCalledTimes(1)
    field().focus()
    fireEvent.change(field(), { target: { value: 'typo' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    await act(async () => {})
    expect(saveBookingEmailAction).toHaveBeenCalledTimes(1)
    expect(field().value).toBe('bookings@example.com')
  })

  it('an unchanged value never writes', async () => {
    mount()
    fireEvent.focus(field())
    fireEvent.blur(field())
    edit('ross@example.com ')
    await act(async () => {})
    expect(saveBookingEmailAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: a refused save puts the old value back and says why', async () => {
    vi.mocked(saveBookingEmailAction).mockResolvedValueOnce({ error: 'That isn’t an email address.' })
    mount()
    edit('not-an-email')
    await waitFor(() => expect(toast).toHaveBeenCalledWith('That isn’t an email address.', 'error'))
    expect(field().value).toBe('ross@example.com')
  })

  it('clearing it saves a blank and the state line says so', async () => {
    mount()
    edit('')
    await waitFor(() => expect(saveBookingEmailAction).toHaveBeenCalledWith('a1', ''))
    await waitFor(() => expect(screen.getByText('No address for enquiries yet')).toBeInTheDocument())
  })
})
