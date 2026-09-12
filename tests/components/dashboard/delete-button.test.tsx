// @vitest-environment jsdom
// The two irreversible delete buttons: both confirm first and both latch a double click.
/**
 * DeleteButton / MediaDeleteButton — client deletes for server-rendered list rows and
 * media assets. Both are IRREVERSIBLE and there is no undo, so both gate on a
 * the app's own confirm dialog (the ActionButton pattern) and latch against a double click. The action
 * module is mocked so the test never touches the server/DB.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { DeleteButton } from '@/app/artists/[id]/(dashboard)/delete-button'
import { MediaDeleteButton } from '@/app/artists/[id]/(dashboard)/media-delete-button'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'
import { deleteContentAction, deleteMediaAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteContentAction: vi.fn(),
  deleteMediaAction: vi.fn(),
}))
const mockDelete = vi.mocked(deleteContentAction)
const mockDeleteMedia = vi.mocked(deleteMediaAction)

/** Answer the question the click raises. Every delete is gated, so a test that wants the
 *  action to run must say yes — otherwise it is testing the declined path by accident.
 *  The dialog is the app's own now (useConfirm), so the answer is a CLICK, after the
 *  trigger rather than stubbed before it. */
async function say(answer: 'Delete' | 'Cancel') {
  const dialog = await screen.findByRole('dialog')
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: answer }))
  })
}

/** The question raised by the last click, for asserting on its wording. */
function question() {
  return screen.getByRole('dialog').textContent ?? ''
}

/**
 * Two clicks inside ONE act batch — i.e. before React has re-rendered the button into
 * its disabled state. This is what a real fast double-click looks like, and it is the
 * only way to reach the busyRef latch: fireEvent flushes the render between calls, so
 * a second fireEvent.click lands on an already-disabled button and proves nothing.
 */
async function doubleClick(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
beforeEach(() => {
  mockDelete.mockReset()
  mockDeleteMedia.mockReset()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup() {
  return render(
    <>
      <DeleteButton type="track" id="t1" artistId="a1" noun="Track">
        Delete
      </DeleteButton>
      <Toaster />
    </>,
  )
}

describe('DeleteButton', () => {
  it('toasts "{noun} deleted" on success', async () => {
    mockDelete.mockResolvedValue({})
    setup()
    fireEvent.click(screen.getByText('Delete'))
    await say('Delete')
    expect(await screen.findByText('Track deleted')).toBeInTheDocument()
    expect(mockDelete).toHaveBeenCalledWith('track', 't1', 'a1')
  })

  it('toasts the returned error on failure', async () => {
    mockDelete.mockResolvedValue({ error: 'Delete failed.' })
    setup()
    fireEvent.click(screen.getByText('Delete'))
    await say('Delete')
    expect(await screen.findByText('Delete failed.')).toBeInTheDocument()
  })

  it('toasts a fallback when the action THROWS', async () => {
    mockDelete.mockRejectedValue(new Error('network down'))
    setup()
    fireEvent.click(screen.getByText('Delete'))
    await say('Delete')
    expect(await screen.findByText("Couldn't delete that track.")).toBeInTheDocument()
  })

  it('CRITICAL: a declined confirmation does NOT delete', async () => {
    // One click on a list row destroys the row: no undo, no trash. The confirm is the
    // only thing between a mis-click and permanent data loss.
    setup()
    fireEvent.click(screen.getByText('Delete'))
    await say('Cancel')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('asks before deleting, naming what is about to go', async () => {
    setup()
    fireEvent.click(screen.getByText('Delete'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(question()).toMatch(/track/i)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('latches against a double click on the confirm (the delete runs once)', async () => {
    let resolve!: (v: { error?: string }) => void
    mockDelete.mockReturnValue(new Promise((r) => (resolve = r)))
    setup()
    fireEvent.click(screen.getByText('Delete'))
    const dialog = await screen.findByRole('dialog')

    await doubleClick(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(mockDelete).toHaveBeenCalledTimes(1)

    resolve({})
    await screen.findByText('Track deleted')
  })
})

function setupMedia() {
  return render(
    <>
      <MediaDeleteButton mediaId="m1" storagePath="a1/hero.mp4" artistId="a1" noun="Video" />
      <Toaster />
    </>,
  )
}

describe('MediaDeleteButton', () => {
  it('toasts "{noun} removed" on success', async () => {
    mockDeleteMedia.mockResolvedValue({})
    setupMedia()
    fireEvent.click(screen.getByText('Delete'))
    await say('Delete')
    expect(await screen.findByText('Video removed')).toBeInTheDocument()
    expect(mockDeleteMedia).toHaveBeenCalledWith('m1', 'a1/hero.mp4', 'a1')
  })

  it('toasts a fallback when the action THROWS', async () => {
    mockDeleteMedia.mockRejectedValue(new Error('network down'))
    setupMedia()
    fireEvent.click(screen.getByText('Delete'))
    await say('Delete')
    expect(await screen.findByText("Couldn't remove that video.")).toBeInTheDocument()
  })

  it('CRITICAL: a declined confirmation does NOT delete the asset', async () => {
    // The file leaves Storage as well as the row — nothing to restore it from.
    setupMedia()
    fireEvent.click(screen.getByText('Delete'))
    await say('Cancel')
    expect(mockDeleteMedia).not.toHaveBeenCalled()
  })

  it('latches against a double click on the confirm (the delete runs once)', async () => {
    let resolve!: (v: { error?: string }) => void
    mockDeleteMedia.mockReturnValue(new Promise((r) => (resolve = r)))
    setupMedia()
    fireEvent.click(screen.getByText('Delete'))
    const dialog = await screen.findByRole('dialog')

    await doubleClick(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(mockDeleteMedia).toHaveBeenCalledTimes(1)

    resolve({})
    await screen.findByText('Video removed')
  })
})
