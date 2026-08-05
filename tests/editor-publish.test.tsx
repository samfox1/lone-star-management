// @vitest-environment jsdom
/**
 * The visual editor's review-and-approve publish window (phase 4). Opening it fetches
 * the unpublished-change summary; a password confirm publishes everything. Covers the
 * summary render, the password-gated publish, an error, and the empty state. The
 * actions are mocked (server-only).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SectionDiff, UnpublishedDiff } from '@/lib/content'
import { getUnpublishedDiffAction, publishAllGatedAction } from '@/app/artists/[id]/(dashboard)/actions'
import { EditorPublish } from '@/app/artists/[id]/(dashboard)/editor/editor-publish'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  getUnpublishedDiffAction: vi.fn(),
  publishAllGatedAction: vi.fn(async () => ({ ok: true })),
}))
const diffMock = vi.mocked(getUnpublishedDiffAction)
const publishMock = vi.mocked(publishAllGatedAction)

const empty: SectionDiff = { added: 0, edited: 0, deleted: 0, dirty: false }
function diff(over: Partial<Record<keyof UnpublishedDiff, SectionDiff>>): UnpublishedDiff {
  const base: UnpublishedDiff = {
    profile: empty,
    site_content: empty,
    site_styles: empty,
    media: empty,
    track: empty,
    release: empty,
    video: empty,
    merch: empty,
    tour_date: empty,
    link: empty,
  }
  return { ...base, ...over }
}
const CHANGED = diff({
  site_content: { added: 0, edited: 2, deleted: 0, dirty: true },
  track: { added: 0, edited: 1, deleted: 0, dirty: true },
  link: { added: 1, edited: 0, deleted: 0, dirty: true },
})
const ZERO = diff({})

afterEach(() => {
  cleanup()
  diffMock.mockReset()
  publishMock.mockReset()
  publishMock.mockResolvedValue({ ok: true })
})

function open() {
  render(<EditorPublish artistId="artist-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
}

const escape = () => fireEvent.keyDown(document, { key: 'Escape' })

/** Open the window on CHANGED, type a password, and start a publish that never
 *  settles — the window is now mid-flight. Returns the dialog. */
async function midPublish() {
  diffMock.mockResolvedValue(CHANGED)
  publishMock.mockReturnValue(new Promise(() => {})) // never settles
  open()
  await screen.findByText(/4 changes/)
  fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'hunter2' } })
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
  return dialog
}

describe('EditorPublish', () => {
  it('lists the changed sections with a total', async () => {
    diffMock.mockResolvedValue(CHANGED)
    open()
    expect(await screen.findByText(/4 changes since your last publish/)).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Site text')).toBeTruthy()
    expect(within(dialog).getByText('Songs')).toBeTruthy()
    expect(within(dialog).getByText('Links')).toBeTruthy()
    // unchanged sections are omitted
    expect(within(dialog).queryByText('Merch')).toBeNull()
  })

  it('publishes everything with the entered password', async () => {
    diffMock.mockResolvedValueOnce(CHANGED).mockResolvedValueOnce(ZERO)
    open()
    await screen.findByText(/4 changes/)
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'hunter2' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Your changes are live.')).toBeTruthy()
    expect(publishMock).toHaveBeenCalledWith('artist-1', 'hunter2')
  })

  it('shows the server error on a wrong password', async () => {
    diffMock.mockResolvedValue(CHANGED)
    publishMock.mockResolvedValue({ ok: false, error: 'Incorrect password.' })
    open()
    await screen.findByText(/4 changes/)
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'nope' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.')
  })

  it('reports nothing to publish when there are no changes', async () => {
    diffMock.mockResolvedValue(ZERO)
    open()
    expect(await screen.findByText(/nothing to publish/i)).toBeTruthy()
    expect(screen.queryByPlaceholderText('Your password')).toBeNull()
  })

  it('Escape closes the window', async () => {
    diffMock.mockResolvedValue(CHANGED)
    open()
    await screen.findByText(/4 changes/)
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('CRITICAL: Escape can NOT dismiss the window mid-publish', async () => {
    // Publishing rewrites the whole public site. Dismissing while the request is in
    // flight leaves the manager with no idea whether it landed — and the obvious next
    // move is to publish again.
    await midPublish()
    escape()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('CRITICAL: an overlay click can NOT dismiss the window mid-publish', async () => {
    const dialog = await midPublish()
    fireEvent.click(dialog)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('latches against a double submit (one publish, not two)', async () => {
    // Both clicks inside ONE act batch — before React re-renders the button disabled,
    // which is exactly what a fast double-click hits.
    diffMock.mockResolvedValue(CHANGED)
    let resolve!: (v: { ok: boolean }) => void
    publishMock.mockReturnValue(new Promise((r) => (resolve = r)))
    open()
    await screen.findByText(/4 changes/)
    fireEvent.change(screen.getByPlaceholderText('Your password'), { target: { value: 'hunter2' } })
    const submit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' })

    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(publishMock).toHaveBeenCalledTimes(1)

    resolve({ ok: true })
    await screen.findByText('Your changes are live.')
  })

  it('CRITICAL: every publishable section reaches this window', async () => {
    // The window summarises changes by reducing over its own SECTIONS list. A section
    // the diff reports but the list omits contributes ZERO to the total, so the window
    // says "all caught up" and hides the password field — stranding real edits in the
    // one place the manager made them. site_styles was exactly that: publishable since
    // 20260714120000, absent from SECTIONS, invisible here.
    for (const key of Object.keys(ZERO) as (keyof UnpublishedDiff)[]) {
      cleanup()
      diffMock.mockResolvedValue(diff({ [key]: { added: 0, edited: 1, deleted: 0, dirty: true } }))
      open()
      // The publish control exists — i.e. the change was COUNTED, not swallowed.
      expect(await screen.findByPlaceholderText('Your password')).toBeTruthy()
      expect(screen.queryByText(/nothing to publish/i)).toBeNull()
    }
  })
})
