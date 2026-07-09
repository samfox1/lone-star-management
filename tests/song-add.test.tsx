// @vitest-environment jsdom
/**
 * SongAddButton — the "Add song" modal (replaces the old inline reveal form).
 * Manual path submits a title through addContentAction('track'); the Upload
 * tile is offered for the drop-an-MP3 path (upload plumbing itself is covered
 * by the storage tests).
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SongAddButton } from '@/app/artists/[id]/(dashboard)/music/song-add'
import { addContentAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  addContentAction: vi.fn(async () => ({})),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SongAddButton', () => {
  it('offers Manual and Upload paths, and submits a manual title', async () => {
    render(<SongAddButton artistId="a1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add song' }))
    const dialog = screen.getByRole('dialog')

    // The two ways in (no Auto — songs have no URL to resolve).
    expect(within(dialog).getByText('Manual')).toBeInTheDocument()
    expect(within(dialog).getByText('Upload')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByText('Manual'))
    fireEvent.change(within(dialog).getByPlaceholderText('Song title'), { target: { value: 'New Demo' } })
    fireEvent.click(within(dialog).getByText('Add'))

    await waitFor(() => expect(addContentAction).toHaveBeenCalledTimes(1))
    const [type, artistId, fd] = vi.mocked(addContentAction).mock.calls[0]
    expect([type, artistId]).toEqual(['track', 'a1'])
    expect((fd as FormData).get('title')).toBe('New Demo')
  })
})
