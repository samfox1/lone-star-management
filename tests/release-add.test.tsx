// @vitest-environment jsdom
/**
 * ReleaseAddButton — manual release creation (closes the restructure gap: no UI
 * created a release). Wires CreateModal to the existing addReleaseAction; a new
 * manual release has no DSP links, so it lands Unreleased by derivation.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { ReleaseAddButton } from '@/app/artists/[id]/(dashboard)/music/release-add'
import { addReleaseAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  addReleaseAction: vi.fn(async () => undefined),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ReleaseAddButton', () => {
  it('submits title, type, date, and cover to addReleaseAction', async () => {
    render(<ReleaseAddButton artistId="a1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add release' }))
    const dialog = screen.getByRole('dialog')

    fireEvent.change(within(dialog).getByPlaceholderText('Release title'), { target: { value: 'Basement Demos' } })
    fireEvent.change(within(dialog).getByDisplayValue('Single'), { target: { value: 'ep' } })
    fireEvent.change(within(dialog).getByPlaceholderText('Release date'), { target: { value: '2026-08-01' } })
    fireEvent.change(within(dialog).getByPlaceholderText('Cover image URL'), { target: { value: 'https://img/c.jpg' } })
    fireEvent.click(within(dialog).getByText('Add'))

    await waitFor(() => expect(addReleaseAction).toHaveBeenCalledTimes(1))
    const [artistId, fd] = vi.mocked(addReleaseAction).mock.calls[0]
    expect(artistId).toBe('a1')
    expect((fd as FormData).get('title')).toBe('Basement Demos')
    expect((fd as FormData).get('release_type')).toBe('ep')
    expect((fd as FormData).get('release_date')).toBe('2026-08-01')
    expect((fd as FormData).get('cover_url')).toBe('https://img/c.jpg')
  })
})
