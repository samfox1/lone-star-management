// @vitest-environment jsdom
// The Restore version menu — going back to a published version, which is not an undo.
/**
 * The Restore version menu — the three-dot button beside Publish (Sam, 2026-08-15).
 *
 * Going back to a PUBLISHED version moved off the inspector's Remove-changes button and
 * behind this menu, because they are different acts: one undoes what you just did, the
 * other reaches past the session into what visitors have already seen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RestoreVersionMenu } from '@/app/artists/[id]/(dashboard)/editor/restore-version'
import { listPublishMomentsAction, restorePublishedAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  listPublishMomentsAction: vi.fn(async () => ({
    ok: true,
    moments: [
      { publishedAt: '2026-08-14T18:00:00.000Z', entities: 4 },
      { publishedAt: '2026-08-10T09:30:00.000Z', entities: 12 },
    ],
  })),
  restorePublishedAction: vi.fn(async () => ({ ok: true, changed: 3, hasPublished: true })),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const openMenu = () => {
  render(<RestoreVersionMenu artistId="artist-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
}

describe('RestoreVersionMenu', () => {
  it('CRITICAL: the menu is closed until the three-dot button is pressed', () => {
    render(<RestoreVersionMenu artistId="artist-1" />)
    expect(screen.queryByRole('button', { name: 'Restore version' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('button', { name: 'Restore version' })).toBeTruthy()
  })

  it('CRITICAL: Restore version lists the published versions, newest first', async () => {
    openMenu()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore version' }))
    })
    expect(listPublishMomentsAction).toHaveBeenCalledWith('artist-1')
    const dialog = screen.getByRole('dialog', { name: 'Restore version' })
    const options = within(dialog).getAllByRole('radio')
    expect(options).toHaveLength(2)
    expect(options[0].getAttribute('aria-label')).toMatch(/most recent/)
    expect(options[1].getAttribute('aria-label')).toMatch(/12 changes/)
  })

  it('CRITICAL: it asks before restoring, and restores the CHOSEN version', async () => {
    openMenu()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore version' }))
    })
    expect(restorePublishedAction).not.toHaveBeenCalled() // opening is not doing
    const dialog = screen.getByRole('dialog', { name: 'Restore version' })
    fireEvent.click(within(dialog).getAllByRole('radio')[1]) // the OLDER one
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Restore this version' }))
    })
    expect(restorePublishedAction).toHaveBeenCalledWith('artist-1', '2026-08-10T09:30:00.000Z')
    expect(refresh, 'the panels and preview must re-read the restored draft').toHaveBeenCalled()
  })

  it('CRITICAL: dismissing restores nothing', async () => {
    openMenu()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore version' }))
    })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(restorePublishedAction).not.toHaveBeenCalled()
  })

  it('a site that has never published says so instead of offering an empty list', async () => {
    vi.mocked(listPublishMomentsAction).mockResolvedValueOnce({ ok: true, moments: [] })
    openMenu()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore version' }))
    })
    const dialog = screen.getByRole('dialog', { name: 'Restore version' })
    expect(within(dialog).getByText(/nothing published yet/i)).toBeTruthy()
    // …and there is no way to fire a restore that could only do nothing.
    expect(within(dialog).queryByRole('button', { name: 'Restore this version' })).toBeNull()
  })
})
