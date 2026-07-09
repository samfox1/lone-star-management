// @vitest-environment jsdom
/**
 * PublishBar — the password-gated publish control for on-site content lists. Disabled
 * until the selection differs from what's live; opens a password prompt; hands the
 * password to onPublish; shows a wrong-password error inline; closes on success.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { PublishBar } from '@/app/artists/[id]/(dashboard)/publish-bar'

afterEach(cleanup)

const publishButton = () => screen.getByRole('button', { name: /publish/i })

describe('PublishBar', () => {
  it('is disabled with no pending changes and does not open', () => {
    render(<PublishBar pendingCount={0} onPublish={vi.fn()} />)
    const btn = publishButton()
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the prompt and passes the entered password to onPublish', async () => {
    const onPublish = vi.fn(async () => ({ ok: true }))
    render(<PublishBar pendingCount={3} onPublish={onPublish} noun="videos" />)

    fireEvent.click(publishButton())
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/3 changes to your public videos/i)).toBeInTheDocument()

    fireEvent.change(within(dialog).getByPlaceholderText('Your password'), { target: { value: 's3cret' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))

    expect(onPublish).toHaveBeenCalledWith('s3cret')
  })

  it('shows the server error inline and keeps the prompt open on failure', async () => {
    const onPublish = vi.fn(async () => ({ ok: false, error: 'Incorrect password.' }))
    render(<PublishBar pendingCount={1} onPublish={onPublish} />)

    fireEvent.click(publishButton())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Your password'), { target: { value: 'wrong' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes the prompt on a successful publish', async () => {
    const onPublish = vi.fn(async () => ({ ok: true }))
    render(<PublishBar pendingCount={2} onPublish={onPublish} />)

    fireEvent.click(publishButton())
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Your password'), { target: { value: 'right' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
