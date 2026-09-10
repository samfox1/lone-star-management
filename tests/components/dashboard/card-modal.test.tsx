// @vitest-environment jsdom
/**
 * CardModal's Delete footer — the OTHER one-click destroy path.
 *
 * Every card grid in the dashboard (releases, tracks, videos, tour rows) renders its
 * delete through this one footer, so a missing guard here is a missing guard in all of
 * them at once. Two rules, both learned the hard way elsewhere in this codebase:
 * a destructive action asks first, and its re-entry latch cannot be React state — two
 * fast clicks both read the pre-render value and fire twice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CardModal } from '@/app/artists/[id]/(dashboard)/card-modal'

vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function open(deleteAction: () => Promise<{ error?: string } | void>) {
  render(
    <CardModal open onClose={() => {}} deleteAction={deleteAction} deleteNoun="Release">
      <p>body</p>
    </CardModal>,
  )
  return screen.getByRole('button', { name: 'Delete' })
}

describe('CardModal delete', () => {
  it('CRITICAL: a declined confirmation does NOT delete', () => {
    // The grids delete a release/song/video/show outright — there is no undo and no
    // trash. Asking is the only thing between a misclick and a lost row.
    const action = vi.fn(async () => {})
    vi.stubGlobal('confirm', vi.fn(() => false))
    fireEvent.click(open(action))
    expect(window.confirm).toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it('an accepted confirmation deletes', async () => {
    const action = vi.fn(async () => {})
    vi.stubGlobal('confirm', vi.fn(() => true))
    fireEvent.click(open(action))
    await act(async () => {})
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: a fast double-click deletes ONCE', async () => {
    // Both clicks dispatched inside ONE act batch — before React re-renders the button
    // disabled, which is exactly what a real double-click hits. A `deleting` STATE guard
    // reads stale in the second handler and fires the action twice.
    const action = vi.fn(async () => {})
    vi.stubGlobal('confirm', vi.fn(() => true))
    const btn = open(action)
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('a failed delete releases the latch so the manager can retry', async () => {
    // Without a finally the modal is permanently dead after one transient failure.
    const action = vi.fn(async () => ({ error: 'nope' }))
    vi.stubGlobal('confirm', vi.fn(() => true))
    const btn = open(action)
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(action).toHaveBeenCalledTimes(2)
  })
})
