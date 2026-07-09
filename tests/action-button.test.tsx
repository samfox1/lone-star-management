// @vitest-environment jsdom
/**
 * ActionButton — the field-less click-to-run control (per-section Publish, integration
 * Pull, Shopify Disconnect). Toasts savedMessage on success, the returned error on
 * failure, gates destructive actions behind window.confirm, and respects `disabled`.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ActionButton } from '@/app/artists/[id]/(dashboard)/action-button'
import { Toaster } from '@/app/artists/[id]/(dashboard)/toast'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(action: () => Promise<{ error?: string; ok?: boolean } | void>, props = {}) {
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

  it('confirm=false blocks the action entirely', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const action = vi.fn(async () => ({}))
    setup(action, { confirm: 'Disconnect this store?' })
    fireEvent.click(screen.getByText('Publish'))
    expect(action).not.toHaveBeenCalled()
  })

  it('confirm=true lets the action run', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const action = vi.fn(async () => ({}))
    setup(action, { confirm: 'Disconnect this store?' })
    fireEvent.click(screen.getByText('Publish'))
    await screen.findByText('Published tracks')
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('disabled prevents the click', () => {
    const action = vi.fn(async () => ({}))
    setup(action, { disabled: true })
    fireEvent.click(screen.getByText('Publish'))
    expect(action).not.toHaveBeenCalled()
  })
})
