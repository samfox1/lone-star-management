// @vitest-environment jsdom
/**
 * DeleteButton — client delete for server-rendered list rows. Calls deleteContentAction
 * and confirms with "{noun} deleted", or toasts the returned error. The action module is
 * mocked so the test never touches the server/DB.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DeleteButton } from '@/app/artists/[id]/(dashboard)/delete-button'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'
import { deleteContentAction } from '@/app/artists/[id]/(dashboard)/actions'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  deleteContentAction: vi.fn(),
}))
const mockDelete = vi.mocked(deleteContentAction)

beforeEach(() => mockDelete.mockReset())
afterEach(cleanup)

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
    expect(await screen.findByText('Track deleted')).toBeInTheDocument()
    expect(mockDelete).toHaveBeenCalledWith('track', 't1', 'a1')
  })

  it('toasts the returned error on failure', async () => {
    mockDelete.mockResolvedValue({ error: 'Delete failed.' })
    setup()
    fireEvent.click(screen.getByText('Delete'))
    expect(await screen.findByText('Delete failed.')).toBeInTheDocument()
  })
})
