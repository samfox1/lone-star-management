// @vitest-environment jsdom
// Connect: pick several from an A–Z grid, paste their links, watch each one connect — or not.
/**
 * ConnectModal (Sam, 2026-09-13). What has to hold:
 *
 *   - the grid is EVERY connection, A to Z, socials and services in one list, and the
 *     ones already on the page cannot be picked twice;
 *   - search narrows by name; several can be picked and the footer counts them;
 *   - the details step prefills each social's address so the manager pastes a handle;
 *   - Connect runs the picks ONE AT A TIME, in order, and a row's state is visible as it
 *     goes: waiting → connecting → connected / failed;
 *   - a failure is red, says why, and leaves the field editable; Retry re-runs ONLY the
 *     failed ones; Save reports back that something was made;
 *   - an input the model can refuse is refused without a request;
 *   - two fast presses of Connect run it once (the latch is a ref — AGENTS.md rule 5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConnectModal } from '@/app/artists/[id]/(dashboard)/connections/connect-modal'
import { connectOneAction } from '@/app/artists/[id]/(dashboard)/connections/actions'
import { connectionsAtoZ } from '@/lib/connections'

vi.mock('@/app/artists/[id]/(dashboard)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true, message: '24 songs found' })),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function open(props: Partial<Parameters<typeof ConnectModal>[0]> = {}) {
  const onClose = vi.fn()
  const onDone = vi.fn()
  render(<ConnectModal artistId="a1" taken={['spotify', 'instagram']} onClose={onClose} onDone={onDone} {...props} />)
  return { dialog: screen.getByRole('dialog', { name: 'Connect' }), onClose, onDone }
}

/** Pick cards by name, go to details, fill the given values, press Connect. */
function pickAndFill(dialog: HTMLElement, fills: Record<string, string>) {
  for (const name of Object.keys(fills)) fireEvent.click(within(dialog).getByRole('button', { name }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
  for (const [name, value] of Object.entries(fills)) {
    const input = within(dialog).getByRole('textbox', { name: new RegExp(`^${name} `) })
    fireEvent.change(input, { target: { value } })
  }
}

describe('pick', () => {
  it('CRITICAL: the grid is every connection, A to Z, in one list', () => {
    const { dialog } = open()
    const names = within(dialog)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? '')
      .filter((n) => n && !['Close', 'Cancel', 'Continue', 'Search'].includes(n))
      .map((n) => n.replace(' (connected)', ''))
    expect(names).toEqual(connectionsAtoZ().map((d) => d.label))
  })

  it('CRITICAL: a connection already on the page cannot be picked again', () => {
    const { dialog } = open()
    expect(within(dialog).getByRole('button', { name: 'Spotify (connected)' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Instagram (connected)' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Deezer' })).toBeEnabled()
  })

  it('search narrows by name', () => {
    const { dialog } = open()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search' }), { target: { value: 'band' } })
    expect(within(dialog).getByRole('button', { name: 'Bandcamp' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Bandsintown' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Deezer' })).toBeNull()
  })

  it('several can be picked, the footer counts, Continue needs at least one', () => {
    const { dialog } = open()
    const cont = within(dialog).getByRole('button', { name: 'Continue' })
    expect(cont).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deezer' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bandcamp' }))
    expect(dialog).toHaveTextContent('2 selected')
    expect(within(dialog).getByRole('button', { name: 'Deezer' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deezer' })) // and back off
    expect(dialog).toHaveTextContent('1 selected')
    expect(cont).toBeEnabled()
  })
})

describe('details', () => {
  it('prefills each social’s address; a service asks for its id; Shopify wants domain and token', () => {
    const { dialog } = open()
    for (const n of ['Deezer', 'Bandsintown', 'Shopify']) fireEvent.click(within(dialog).getByRole('button', { name: n }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(within(dialog).getByRole('textbox', { name: 'Deezer link' })).toHaveValue('https://deezer.com/artist/')
    expect(within(dialog).getByRole('textbox', { name: 'Bandsintown Bandsintown artist name' })).toHaveValue('')
    expect(within(dialog).getByRole('textbox', { name: 'Shopify store domain' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Shopify storefront token')).toHaveAttribute('type', 'password')
    expect(within(dialog).getByRole('button', { name: 'Connect 3' })).toBeInTheDocument()
  })
})

describe('run', () => {
  it('CRITICAL: connects the picks one at a time, in order, with what the manager typed', async () => {
    const { dialog } = open()
    pickAndFill(dialog, { Deezer: 'https://deezer.com/artist/5723457', Bandsintown: 'Skeen' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect 2' }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledTimes(2))
    expect(vi.mocked(connectOneAction).mock.calls[0]).toEqual(['a1', 'deezer', { url: 'https://deezer.com/artist/5723457' }])
    expect(vi.mocked(connectOneAction).mock.calls[1]).toEqual(['a1', 'bandsintown', { id: 'Skeen' }])
    await waitFor(() => expect(within(dialog).getAllByLabelText('connected')).toHaveLength(2))
    expect(dialog).toHaveTextContent('2 connected')
    expect(dialog).toHaveTextContent('24 songs found')
    expect(dialog).not.toHaveTextContent('Music ·')
  })

  it('shows the row connecting while its request is out, and the others waiting', async () => {
    let release!: (v: { ok: boolean }) => void
    vi.mocked(connectOneAction).mockImplementationOnce(() => new Promise((r) => (release = r)))
    const { dialog } = open()
    pickAndFill(dialog, { Deezer: 'https://deezer.com/artist/1', Bandsintown: 'Skeen' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect 2' }))
    await waitFor(() => expect(within(dialog).getByLabelText('connecting')).toBeInTheDocument())
    expect(within(dialog).getByLabelText('waiting')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('0 of 2')
    expect(within(dialog).getByRole('button', { name: 'Connecting…' })).toBeDisabled()
    await act(async () => release({ ok: true }))
    await waitFor(() => expect(within(dialog).getAllByLabelText('connected')).toHaveLength(2))
  })

  it('CRITICAL: a failure is red, says why, keeps the field editable — and Retry re-runs ONLY it', async () => {
    vi.mocked(connectOneAction)
      .mockResolvedValueOnce({ ok: true, message: '3 songs found' })
      .mockResolvedValueOnce({ ok: false, error: 'Bandsintown has no artist by that name.' })
      .mockResolvedValueOnce({ ok: true, message: '5 dates' })
    const { dialog } = open()
    pickAndFill(dialog, { Deezer: 'https://deezer.com/artist/1', Bandsintown: 'Skeeen' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect 2' }))
    await waitFor(() => expect(within(dialog).getByLabelText('failed')).toBeInTheDocument())
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Bandsintown has no artist by that name.')
    expect(dialog).toHaveTextContent('1 connected · 1 didn’t')

    const fix = within(dialog).getByRole('textbox', { name: 'Bandsintown id' })
    fireEvent.change(fix, { target: { value: 'Skeen' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledTimes(3))
    expect(vi.mocked(connectOneAction).mock.calls[2]).toEqual(['a1', 'bandsintown', { id: 'Skeen' }])
    await waitFor(() => expect(within(dialog).getAllByLabelText('connected')).toHaveLength(2))
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('CRITICAL: an input the model refuses never becomes a request', async () => {
    const { dialog } = open()
    // A TikTok link pasted into the Deezer row.
    pickAndFill(dialog, { Deezer: 'https://tiktok.com/@skeen' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(within(dialog).getByLabelText('failed')).toBeInTheDocument())
    expect(within(dialog).getByRole('alert')).toHaveTextContent('That’s a TikTok link, not Deezer.')
    expect(connectOneAction).not.toHaveBeenCalled()
  })

  it('CRITICAL: two fast presses of Connect run it once', async () => {
    let release!: (v: { ok: boolean }) => void
    vi.mocked(connectOneAction).mockImplementationOnce(() => new Promise((r) => (release = r)))
    const { dialog } = open()
    pickAndFill(dialog, { Deezer: 'https://deezer.com/artist/1' })
    const go = within(dialog).getByRole('button', { name: 'Connect' })
    await act(async () => {
      go.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      go.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(connectOneAction).toHaveBeenCalledTimes(1)
    await act(async () => release({ ok: true }))
  })

  it('Save reports back only when something was made; Cancel before running reports nothing', async () => {
    const { dialog, onClose, onDone } = open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
    cleanup()

    const second = open()
    pickAndFill(second.dialog, { Deezer: 'https://deezer.com/artist/1' })
    fireEvent.click(within(second.dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(within(second.dialog).getByLabelText('connected')).toBeInTheDocument())
    // SAVE, never Done — the modal footer word everywhere (Sam, 2026-09-23, BRAND_PAGE_PLAN).
    expect(within(second.dialog).queryByRole('button', { name: 'Done' })).toBeNull()
    fireEvent.click(within(second.dialog).getByRole('button', { name: 'Save' }))
    expect(second.onDone).toHaveBeenCalledTimes(1)
    expect(second.onClose).toHaveBeenCalledTimes(1)
  })

  it('the door is shut while connecting — Escape and the × do nothing until it settles', async () => {
    let release!: (v: { ok: boolean }) => void
    vi.mocked(connectOneAction).mockImplementationOnce(() => new Promise((r) => (release = r)))
    const { dialog, onClose } = open()
    pickAndFill(dialog, { Deezer: 'https://deezer.com/artist/1' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(within(dialog).getByLabelText('connecting')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => release({ ok: true }))
  })
})
