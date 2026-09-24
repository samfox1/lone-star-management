// @vitest-environment jsdom
// The Connections list: one row per platform — ring, mark, name, handle, state — click to edit.
/**
 * ConnectionList (Sam, 2026-09-13). What has to hold:
 *
 *   - the handle reads as a handle (no scheme, no www);
 *   - THE ROW IS THE BUTTON: a click opens the connection's modal, where the Link row
 *     saves the URL alone through updateContentAction('link'); there is no ⋯;
 *   - the ring flips the link on/off the site INSTANTLY — links are LIVE_TOGGLE — never
 *     opens the modal, and a refused flip puts the ring back and says why;
 *   - the right-hand chip says what the state IS: synced, failed offers Retry, a profile
 *     whose catalog was never pulled offers Sync (never "Connect" — the check beside it
 *     already says it is), a plain social says nothing;
 *   - Remove is the modal footer's: it asks first, then removes the link AND the source;
 *   - Sync / Pull now pull that connection and report what came back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConnectionList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-list'
import { publishEntityAction, setOnSiteAction, updateContentAction } from '@/app/artists/[id]/(dashboard)/actions'
import { disconnectConnectionAction, pullConnectionAction, syncProfileAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import { connectionByKey, type ConnectionRow } from '@/lib/connections'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishEntityAction: vi.fn(async () => ({ ok: true })),
  setOnSiteAction: vi.fn(async () => ({})),
  updateContentAction: vi.fn(async () => ({})),
  saveSourceIdAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true })),
  disconnectConnectionAction: vi.fn(async () => ({})),
  pullConnectionAction: vi.fn(async () => ({ ok: true, message: '24 songs' })),
  syncProfileAction: vi.fn(async () => ({ ok: true, message: '12 songs found' })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const def = (k: string) => connectionByKey(k)!
const ROWS: ConnectionRow[] = [
  { def: def('spotify'), key: 'spotify', label: 'Spotify', linkId: 'l-sp', url: 'https://open.spotify.com/artist/26K', onSite: true, sourceId: '26K', state: 'synced' },
  { def: def('bandsintown'), key: 'bandsintown', label: 'Bandsintown', onSite: true, sourceId: 'Skeen', state: 'failed' },
  { def: def('apple music'), key: 'apple music', label: 'Apple Music', linkId: 'l-am', url: 'https://music.apple.com/artist/1', onSite: true, state: 'connect' },
  { def: def('instagram'), key: 'instagram', label: 'Instagram', linkId: 'l-ig', url: 'https://www.instagram.com/skeen/', onSite: true, state: 'none' },
]

function mount(rows = ROWS, dirty = false) {
  render(<ConnectionList artistId="a1" rows={rows} dirty={dirty} />)
}
/** The row: the button named for its platform. */
const rowOf = (label: string) => screen.getByRole('button', { name: label })
/** Click the row, and return its modal. */
function openRow(label: string) {
  fireEvent.click(rowOf(label))
  return screen.getByRole('dialog', { name: label })
}
/** A modal row by its label (modal-kit: the label span's row box). */
function kvRow(dialog: HTMLElement, label: string): HTMLElement {
  const lab = within(dialog).getAllByText(label, { selector: 'span' }).find((el) => el.closest('.group'))!
  return lab.closest('.group') as HTMLElement
}
/** The editable value in a modal row: text until clicked, then an input labelled by the row. */
function editRow(dialog: HTMLElement, label: string, next: string) {
  fireEvent.click(within(kvRow(dialog, label)).getByRole('button'))
  const input = within(dialog).getByLabelText(label)
  fireEvent.change(input, { target: { value: next } })
  fireEvent.blur(input)
}

describe('the rows', () => {
  it('shows the handle, not the URL, and has no ⋯', () => {
    mount()
    expect(rowOf('Instagram')).toHaveTextContent('instagram.com/skeen')
    expect(rowOf('Instagram')).not.toHaveTextContent('https://')
    expect(screen.queryByRole('button', { name: /options/ })).toBeNull()
  })

  it('the chip says what the state is', () => {
    mount()
    expect(rowOf('Spotify')).toHaveTextContent(/synced/)
    expect(rowOf('Spotify')).not.toHaveTextContent(/Music/) // just the word (Sam, 2026-09-13)
    expect(rowOf('Bandsintown')).toHaveTextContent(/Couldn’t connect/)
    expect(within(rowOf('Bandsintown')).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(within(rowOf('Apple Music')).getByRole('button', { name: 'Sync Apple Music' })).toBeInTheDocument()
    expect(rowOf('Apple Music')).not.toHaveTextContent(/Connect/) // a check beside "Connect" is a contradiction
    expect(rowOf('Instagram')).not.toHaveTextContent(/synced|Sync|Connect|Retry/)
  })

  it('a source with no profile has no ring — the column stays, the control does not', () => {
    mount()
    expect(within(rowOf('Bandsintown')).queryByRole('checkbox')).toBeNull()
    expect(within(rowOf('Spotify')).getByRole('checkbox')).toBeInTheDocument()
  })
})

describe('click to edit', () => {
  it('CRITICAL: a click on the row opens its modal, and the Link row saves the URL alone', async () => {
    mount()
    const dialog = openRow('Instagram')
    expect(within(dialog).getByRole('heading', { name: 'Instagram' })).toBeInTheDocument()
    editRow(dialog, 'Link', 'https://instagram.com/skeen_new')
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    const [type, id, artistId, fd] = vi.mocked(updateContentAction).mock.calls[0]
    expect([type, id, artistId]).toEqual(['link', 'l-ig', 'a1'])
    expect([...(fd as FormData).keys()]).toEqual(['url'])
    expect((fd as FormData).get('url')).toBe('https://instagram.com/skeen_new')
  })

  it('an unchanged value never writes', async () => {
    mount()
    const dialog = openRow('Instagram')
    fireEvent.click(within(kvRow(dialog, 'Link')).getByRole('button'))
    fireEvent.blur(within(dialog).getByLabelText('Link'))
    await act(async () => {})
    expect(updateContentAction).not.toHaveBeenCalled()
  })

  it('the modal offers the link to open, and a source its ID and a Pull now', () => {
    mount()
    const ig = openRow('Instagram')
    expect(within(ig).getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://www.instagram.com/skeen/')
    expect(within(ig).queryByText('Catalog', { selector: 'span' })).toBeNull()
    fireEvent.click(within(ig).getByRole('button', { name: 'Save' }))
    const sp = openRow('Spotify')
    expect(within(kvRow(sp, 'ID')).getByRole('button')).toHaveTextContent('26K')
    expect(within(sp).getByRole('button', { name: /Pull now/ })).toBeInTheDocument()
  })

  it('Pull now in the modal pulls THAT connection and shows what came back', async () => {
    mount()
    const sp = openRow('Spotify')
    fireEvent.click(within(sp).getByRole('button', { name: /Pull now/ }))
    await waitFor(() => expect(pullConnectionAction).toHaveBeenCalledWith('a1', 'spotify'))
    await waitFor(() => expect(sp).toHaveTextContent('24 songs'))
  })
})

describe('the ring', () => {
  it('CRITICAL: flips the link off the site instantly through the LIVE toggle — and does not open the modal', async () => {
    mount()
    fireEvent.click(within(rowOf('Instagram')).getByRole('checkbox'))
    await waitFor(() => expect(setOnSiteAction).toHaveBeenCalledWith('link', 'l-ig', 'a1', false))
    expect(within(rowOf('Instagram')).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a refused flip puts the ring back and says why', async () => {
    vi.mocked(setOnSiteAction).mockResolvedValueOnce({ error: 'Not yours.' })
    mount()
    fireEvent.click(within(rowOf('Instagram')).getByRole('checkbox'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Not yours.', 'error'))
    expect(within(rowOf('Instagram')).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Remove', () => {
  it('CRITICAL: the footer’s Remove asks first, and removes the link AND the source together', async () => {
    mount()
    const sp = openRow('Spotify')
    fireEvent.click(within(sp).getByRole('button', { name: 'Remove' }))
    expect(disconnectConnectionAction).not.toHaveBeenCalled()
    const q = screen.getByRole('dialog', { name: /Remove Spotify/ })
    await act(async () => {
      fireEvent.click(within(q).getByRole('button', { name: 'Remove' }))
    })
    expect(disconnectConnectionAction).toHaveBeenCalledWith('a1', 'spotify', 'l-sp')
    expect(screen.queryByRole('button', { name: 'Spotify' })).toBeNull()
  })

  it('Cancel on the question removes nothing', async () => {
    mount()
    const sp = openRow('Spotify')
    fireEvent.click(within(sp).getByRole('button', { name: 'Remove' }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog', { name: /Remove Spotify/ })).getByRole('button', { name: 'Cancel' }))
    })
    expect(disconnectConnectionAction).not.toHaveBeenCalled()
    expect(rowOf('Spotify')).toBeInTheDocument()
  })
})

describe('the chip’s own actions', () => {
  it('CRITICAL: Sync on a never-pulled profile pulls it from the link, nothing typed, no modal', async () => {
    // The Apple Music link already holds the artist id; the row should not send the
    // manager to a form to retype what is on the screen.
    mount()
    fireEvent.click(within(rowOf('Apple Music')).getByRole('button', { name: 'Sync Apple Music' }))
    await waitFor(() => expect(syncProfileAction).toHaveBeenCalledWith('a1', 'apple music'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('12 songs found'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a link with no id in it says so, and the row stays', async () => {
    vi.mocked(syncProfileAction).mockResolvedValueOnce({ ok: false, error: 'That Apple Music link has no artist id in it — it needs to be the artist page.' })
    mount()
    fireEvent.click(within(rowOf('Apple Music')).getByRole('button', { name: 'Sync Apple Music' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/no artist id/), 'error'))
    expect(rowOf('Apple Music')).toBeInTheDocument()
  })

  it('Retry on a failed row pulls it again, without opening the modal', async () => {
    mount()
    fireEvent.click(within(rowOf('Bandsintown')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(pullConnectionAction).toHaveBeenCalledWith('a1', 'bandsintown'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('CRITICAL: two fast clicks on Retry pull ONCE — the latch is a ref, not the disabled state', async () => {
    // Both clicks in one act() batch: after one fireEvent.click React would already
    // have disabled the button and the second click would never dispatch, pinning nothing.
    // Two concurrent pulls both read "no row for this id" and both insert.
    let release!: (v: { ok: boolean; message?: string }) => void
    vi.mocked(pullConnectionAction).mockImplementationOnce(() => new Promise((res) => { release = res }))
    mount()
    const retry = within(rowOf('Bandsintown')).getByRole('button', { name: 'Retry' })
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(pullConnectionAction).toHaveBeenCalledTimes(1)
    await act(async () => release({ ok: true, message: '2 dates' }))
  })
})

describe('Connect', () => {
  it('opens the Connect dialog with the rows already on the page marked as connected', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }))
    const dialog = screen.getByRole('dialog', { name: 'Connect' })
    expect(within(dialog).getByRole('button', { name: 'Spotify (connected)' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'TikTok' })).toBeEnabled()
  })
})

describe('Publish', () => {
  it('is the floating bar every content page has, and it publishes the LINK snapshot', async () => {
    mount(ROWS, false)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    cleanup()
    mount(ROWS, true)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    const pw = screen.getByPlaceholderText('Your password')
    fireEvent.change(pw, { target: { value: 'hunter2' } })
    fireEvent.submit(pw.closest('form')!)
    await waitFor(() => expect(publishEntityAction).toHaveBeenCalledWith('link', 'a1', 'hunter2'))
  })
})
