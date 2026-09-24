// @vitest-environment jsdom
// Settings: four centred rows — two you can click to edit, two you cannot.
/**
 * SettingsView (2026-09-13). What has to hold:
 *
 *   - Site and Address are text, not controls: nothing to click, no input ever;
 *   - Booking email saves through its door on blur or Enter, and only when CHANGED;
 *   - a refused save puts the old value back and says why;
 *   - Escape puts the old value back without saving;
 *   - Name saves through the name action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsView } from '@/app/artists/[id]/(dashboard)/(manager-tools)/settings/settings-view'
import { saveArtistNameAction, saveBookingEmailAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/settings/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import type { SettingsRow } from '@/lib/settings'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/settings/actions', () => ({
  saveBookingEmailAction: vi.fn(async (_a: string, email: string) => ({ value: email || null })),
  saveArtistNameAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ROWS: SettingsRow[] = [
  { key: 'booking_email', label: 'Booking email', value: 'ross@example.com', editable: true, mono: true, sub: 'Enquiries from the site go here' },
  { key: 'site', label: 'Site', value: 'skeenmusic.com', editable: false, mono: true },
  { key: 'name', label: 'Name', value: 'Skeen', editable: true, mono: false },
  { key: 'address', label: 'Address', value: 'lonestar.site/skeen', editable: false, mono: true },
]

function mount() {
  render(<SettingsView artistId="a1" rows={ROWS} />)
}
function edit(label: string, next: string, key: 'blur' | 'Enter' = 'blur') {
  fireEvent.click(screen.getByRole('button', { name: label }))
  const input = screen.getByRole('textbox', { name: label })
  fireEvent.change(input, { target: { value: next } })
  if (key === 'blur') fireEvent.blur(input)
  else fireEvent.keyDown(input, { key: 'Enter' })
  return input
}

describe('the rows', () => {
  it('CRITICAL: Site and Address are text — nothing to click, no input', () => {
    mount()
    expect(screen.getByText('skeenmusic.com')).toBeInTheDocument()
    expect(screen.getByText('lonestar.site/skeen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Site' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Address' })).toBeNull()
    fireEvent.click(screen.getByText('skeenmusic.com'))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('the editable rows are Booking email and Name, and the state line sits under the email', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Booking email' })).toHaveTextContent('ross@example.com')
    expect(screen.getByRole('button', { name: 'Name' })).toHaveTextContent('Skeen')
    expect(screen.getByText('Enquiries from the site go here')).toBeInTheDocument()
  })
})

describe('Booking email', () => {
  it('CRITICAL: saves through its door on blur, with what was typed', async () => {
    mount()
    edit('Booking email', 'bookings@example.com')
    await waitFor(() => expect(saveBookingEmailAction).toHaveBeenCalledWith('a1', 'bookings@example.com'))
    expect(screen.getByRole('button', { name: 'Booking email' })).toHaveTextContent('bookings@example.com')
  })

  it('Enter saves too; Escape puts the old value back and saves nothing', async () => {
    mount()
    edit('Booking email', 'bookings@example.com', 'Enter')
    await waitFor(() => expect(saveBookingEmailAction).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Booking email' }))
    const input = screen.getByRole('textbox', { name: 'Booking email' })
    fireEvent.change(input, { target: { value: 'typo' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(saveBookingEmailAction).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Booking email' })).toHaveTextContent('bookings@example.com')
  })

  it('an unchanged value never writes', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Booking email' }))
    fireEvent.blur(screen.getByRole('textbox', { name: 'Booking email' }))
    await act(async () => {})
    expect(saveBookingEmailAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: a refused save puts the old value back and says why', async () => {
    vi.mocked(saveBookingEmailAction).mockResolvedValueOnce({ error: 'That isn’t an email address.' })
    mount()
    edit('Booking email', 'not-an-email')
    await waitFor(() => expect(toast).toHaveBeenCalledWith('That isn’t an email address.', 'error'))
    expect(screen.getByRole('button', { name: 'Booking email' })).toHaveTextContent('ross@example.com')
  })

  it('clearing it saves a blank and the state line says so', async () => {
    mount()
    edit('Booking email', '')
    await waitFor(() => expect(saveBookingEmailAction).toHaveBeenCalledWith('a1', ''))
    await waitFor(() => expect(screen.getByText('No address for enquiries yet')).toBeInTheDocument())
  })
})

describe('Name', () => {
  it('saves through the name action', async () => {
    mount()
    edit('Name', 'Skeen Live')
    await waitFor(() => expect(saveArtistNameAction).toHaveBeenCalledWith('a1', 'Skeen Live'))
    expect(screen.getByRole('button', { name: 'Name' })).toHaveTextContent('Skeen Live')
  })
})
