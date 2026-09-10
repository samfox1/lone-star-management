// @vitest-environment jsdom
// The publish control for content lists: disabled until something differs from what is live.
/**
 * PublishBar — the password-gated publish control for on-site content lists. Disabled
 * until the selection differs from what's live; opens a password prompt; hands the
 * password to onPublish; shows a wrong-password error inline; closes on success.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { PublishBar } from '@/app/artists/[id]/(dashboard)/publish-bar'

afterEach(cleanup)

const publishButton = () => screen.getByRole('button', { name: /publish/i })

/** Open the prompt with a password typed in, ready to submit. */
function openPrompt(onPublish: (p: string) => Promise<{ ok: boolean; error?: string }>) {
  render(<PublishBar pendingCount={1} onPublish={onPublish} />)
  fireEvent.click(publishButton())
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByPlaceholderText('Your password'), { target: { value: 'pw' } })
  return dialog
}

const escape = () => fireEvent.keyDown(document, { key: 'Escape' })

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

describe('PublishBar dismissal', () => {
  it('Escape closes the prompt', () => {
    openPrompt(vi.fn(async () => ({ ok: true })))
    escape()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a click on the overlay closes the prompt', () => {
    const dialog = openPrompt(vi.fn(async () => ({ ok: true })))
    fireEvent.click(dialog)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('CRITICAL: Escape can NOT dismiss the prompt mid-publish', () => {
    // Publishing is the irreversible one — it rewrites the public site. Dismissing the
    // window while the request is in flight leaves the manager with no idea whether it
    // landed, and the obvious next move is to publish again.
    const dialog = openPrompt(vi.fn(() => new Promise<{ ok: boolean }>(() => {}))) // never settles
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))

    escape()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('CRITICAL: an overlay click can NOT dismiss the prompt mid-publish', () => {
    const dialog = openPrompt(vi.fn(() => new Promise<{ ok: boolean }>(() => {})))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))

    fireEvent.click(dialog)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('latches against a double submit (one publish, not two)', async () => {
    let resolve!: (v: { ok: boolean }) => void
    const onPublish = vi.fn(() => new Promise<{ ok: boolean }>((r) => (resolve = r)))
    const dialog = openPrompt(onPublish)
    const submit = within(dialog).getByRole('button', { name: 'Publish' })

    // Both clicks inside ONE act batch — before React re-renders the button disabled,
    // which is exactly what a fast double-click hits.
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onPublish).toHaveBeenCalledTimes(1)

    resolve({ ok: true })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('PublishBar with content edits (dirty)', () => {
  it('enables on unpublished edits even with zero selection changes', () => {
    render(<PublishBar pendingCount={0} dirty onPublish={vi.fn(async () => ({ ok: true }))} noun="releases" />)
    const btn = publishButton()
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Push your latest edits to your public releases/i)).toBeInTheDocument()
  })

  it('stays disabled when neither selection changes nor edits are pending', () => {
    render(<PublishBar pendingCount={0} dirty={false} onPublish={vi.fn()} />)
    expect(publishButton()).toBeDisabled()
  })
})
