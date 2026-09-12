// @vitest-environment jsdom
// The click-to-run button: toasts the result, confirms destructive acts, and latches double
//   clicks.
/**
 * ActionButton — the field-less click-to-run control (per-section Publish, integration
 * Pull, Shopify Disconnect). Toasts savedMessage on success, the returned error on
 * failure, gates destructive actions behind the app's own confirm dialog, and respects
 * `disabled`.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ActionButton } from '@/app/artists/[id]/(dashboard)/action-button'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

function setup(action: () => Promise<{ error?: string; ok?: boolean; message?: string } | void>, props = {}) {
  return render(
    <>
      <ActionButton action={action} savedMessage="Published tracks" {...props}>
        Publish
      </ActionButton>
      <Toaster />
    </>,
  )
}

describe('ActionButton', () => {
  it('toasts the saved message on success', async () => {
    const action = vi.fn(async () => ({ ok: true }))
    setup(action)
    fireEvent.click(screen.getByText('Publish'))
    expect(await screen.findByText('Published tracks')).toBeInTheDocument()
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('toasts the returned error on failure', async () => {
    const action = vi.fn(async () => ({ ok: false, error: 'No Spotify artist linked yet.' }))
    setup(action)
    fireEvent.click(screen.getByText('Publish'))
    expect(await screen.findByText('No Spotify artist linked yet.')).toBeInTheDocument()
  })

  it('CRITICAL: cancelling the question blocks the action entirely', async () => {
    const action = vi.fn(async () => ({}))
    setup(action, { confirm: 'Disconnect this store?' })
    fireEvent.click(screen.getByText('Publish'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Disconnect this store?')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    })
    expect(action).not.toHaveBeenCalled()
  })

  it('confirming lets the action run', async () => {
    const action = vi.fn(async () => ({}))
    setup(action, { confirm: 'Disconnect this store?' })
    fireEvent.click(screen.getByText('Publish'))
    const dialog = await screen.findByRole('dialog')
    // Not a destroy, so the action is named for what it does rather than "Delete".
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    })
    await screen.findByText('Published tracks')
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('no `confirm` prop means no question at all', () => {
    const action = vi.fn(async () => ({}))
    setup(action)
    fireEvent.click(screen.getByText('Publish'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disabled prevents the click', () => {
    const action = vi.fn(async () => ({}))
    setup(action, { disabled: true })
    fireEvent.click(screen.getByText('Publish'))
    expect(action).not.toHaveBeenCalled()
  })

  it('the action’s own message wins over savedMessage', async () => {
    // Pulls report what they found ("Found 12 media files"); the static savedMessage
    // would replace that count with a generic line and lose the only useful part.
    const action = vi.fn(async () => ({ ok: true, message: 'Found 12 media files' }))
    setup(action)
    fireEvent.click(screen.getByText('Publish'))
    expect(await screen.findByText('Found 12 media files')).toBeInTheDocument()
    expect(screen.queryByText('Published tracks')).not.toBeInTheDocument()
  })

  it('toasts a fallback when the action THROWS', async () => {
    // A rejected action (network drop, uncaught server throw) has no `error` field to
    // report, so without the catch the click looks like it simply did nothing.
    const action = vi.fn(async () => {
      throw new Error('network down')
    })
    setup(action)
    fireEvent.click(screen.getByText('Publish'))
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument()
  })

  it('latches against a double click (the action runs once)', async () => {
    let resolve!: (v: { ok: boolean }) => void
    const action = vi.fn(() => new Promise<{ ok: boolean }>((r) => (resolve = r)))
    setup(action)

    await doubleClick(screen.getByText('Publish'))
    expect(action).toHaveBeenCalledTimes(1)

    resolve({ ok: true })
    await screen.findByText('Published tracks')
  })
})
