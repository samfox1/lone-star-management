// @vitest-environment jsdom
// The Connections list: one row per platform — ring, mark, name, handle, state — and its ⋯.
/**
 * ConnectionList (Sam, 2026-09-13). What has to hold:
 *
 *   - the handle reads as a handle (no scheme, no www), and editing it saves the link's
 *     URL alone through updateContentAction('link');
 *   - the ring flips the link on/off the site INSTANTLY — links are LIVE_TOGGLE — and a
 *     refused flip puts the ring back and says why;
 *   - the right-hand chip says what the state IS: synced names the section, failed offers
 *     Retry, a profile with an unconnected source offers Connect, a plain social says
 *     nothing;
 *   - Remove asks first, then removes the link AND the source behind it;
 *   - Pull now pulls that connection and reports what came back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConnectionList, handleOf } from '@/app/artists/[id]/(dashboard)/connections/connection-list'
import { setOnSiteAction, updateContentAction } from '@/app/artists/[id]/(dashboard)/actions'
import { disconnectConnectionAction, pullConnectionAction } from '@/app/artists/[id]/(dashboard)/connections/actions'
import { toast } from '@/app/artists/[id]/(dashboard)/toast'
import { connectionByKey, type ConnectionRow } from '@/lib/connections'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  setOnSiteAction: vi.fn(async () => ({})),
  updateContentAction: vi.fn(async () => ({})),
  saveSourceIdAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true })),
  disconnectConnectionAction: vi.fn(async () => ({})),
  pullConnectionAction: vi.fn(async () => ({ ok: true, message: '24 songs' })),
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

function mount(rows = ROWS) {
  render(<ConnectionList artistId="a1" rows={rows} />)
}
const rowOf = (label: string) => screen.getByText(label).closest('.group') as HTMLElement

describe('handleOf', () => {
  it('drops the scheme, www and a trailing slash — the handle, not the address', () => {
    expect(handleOf('https://www.instagram.com/skeen/')).toBe('instagram.com/skeen')
    expect(handleOf('http://tiktok.com/@skeen200')).toBe('tiktok.com/@skeen200')
  })
})

describe('the rows', () => {
  it('shows the handle, not the URL, and the full URL only while editing', () => {
    mount()
    const ig = rowOf('Instagram')
    expect(within(ig).getByRole('button', { name: 'Instagram link' })).toHaveTextContent('instagram.com/skeen')
    fireEvent.click(within(ig).getByRole('button', { name: 'Instagram link' }))
    expect(within(ig).getByRole('textbox', { name: 'Instagram link' })).toHaveValue('https://www.instagram.com/skeen/')
  })

  it('CRITICAL: editing the handle saves the URL alone, for the link row alone', async () => {
    mount()
    const ig = rowOf('Instagram')
    fireEvent.click(within(ig).getByRole('button', { name: 'Instagram link' }))
    const input = within(ig).getByRole('textbox', { name: 'Instagram link' })
    fireEvent.change(input, { target: { value: 'https://instagram.com/skeen_new' } })
    fireEvent.blur(input)
    await waitFor(() => expect(updateContentAction).toHaveBeenCalledTimes(1))
    const [type, id, artistId, fd] = vi.mocked(updateContentAction).mock.calls[0]
    expect([type, id, artistId]).toEqual(['link', 'l-ig', 'a1'])
    expect([...(fd as FormData).keys()]).toEqual(['url'])
    expect((fd as FormData).get('url')).toBe('https://instagram.com/skeen_new')
  })

  it('an unchanged value never writes', async () => {
    mount()
    const ig = rowOf('Instagram')
    fireEvent.click(within(ig).getByRole('button', { name: 'Instagram link' }))
    fireEvent.blur(within(ig).getByRole('textbox', { name: 'Instagram link' }))
    await act(async () => {})
    expect(updateContentAction).not.toHaveBeenCalled()
  })

  it('the chip says what the state is', () => {
    mount()
    expect(rowOf('Spotify')).toHaveTextContent(/Music\s*synced/)
    expect(rowOf('Bandsintown')).toHaveTextContent(/Couldn’t connect/)
    expect(within(rowOf('Bandsintown')).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(within(rowOf('Apple Music')).getByRole('button', { name: /Connect/ })).toBeInTheDocument()
    expect(rowOf('Instagram')).not.toHaveTextContent(/synced|Connect|Retry/)
  })

  it('a source with no profile has no ring — the column stays, the control does not', () => {
    mount()
    expect(within(rowOf('Bandsintown')).queryByRole('checkbox')).toBeNull()
    expect(within(rowOf('Spotify')).getByRole('checkbox')).toBeInTheDocument()
  })
})

describe('the ring', () => {
  it('CRITICAL: flips the link off the site instantly through the LIVE toggle', async () => {
    mount()
    fireEvent.click(within(rowOf('Instagram')).getByRole('checkbox'))
    await waitFor(() => expect(setOnSiteAction).toHaveBeenCalledWith('link', 'l-ig', 'a1', false))
    expect(within(rowOf('Instagram')).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
  })

  it('a refused flip puts the ring back and says why', async () => {
    vi.mocked(setOnSiteAction).mockResolvedValueOnce({ error: 'Not yours.' })
    mount()
    fireEvent.click(within(rowOf('Instagram')).getByRole('checkbox'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Not yours.', 'error'))
    expect(within(rowOf('Instagram')).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
  })
})

describe('the ⋯ menu', () => {
  it('CRITICAL: Remove asks first, and removes the link AND the source together', async () => {
    mount()
    fireEvent.click(within(rowOf('Spotify')).getByRole('button', { name: 'Spotify options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove/ }))
    expect(disconnectConnectionAction).not.toHaveBeenCalled()
    const q = screen.getByRole('dialog', { name: /Remove Spotify/ })
    await act(async () => {
      fireEvent.click(within(q).getByRole('button', { name: 'Remove' }))
    })
    expect(disconnectConnectionAction).toHaveBeenCalledWith('a1', 'spotify', 'l-sp')
    expect(screen.queryByText('Spotify')).toBeNull()
  })

  it('Cancel on the question removes nothing', async () => {
    mount()
    fireEvent.click(within(rowOf('Spotify')).getByRole('button', { name: 'Spotify options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove/ }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog', { name: /Remove Spotify/ })).getByRole('button', { name: 'Cancel' }))
    })
    expect(disconnectConnectionAction).not.toHaveBeenCalled()
    expect(screen.getByText('Spotify')).toBeInTheDocument()
  })

  it('Pull now pulls THAT connection and reports what came back', async () => {
    mount()
    fireEvent.click(within(rowOf('Spotify')).getByRole('button', { name: 'Spotify options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Pull now/ }))
    await waitFor(() => expect(pullConnectionAction).toHaveBeenCalledWith('a1', 'spotify'))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('24 songs'))
  })

  it('a plain social has no Pull now — nothing to pull', () => {
    mount()
    fireEvent.click(within(rowOf('Instagram')).getByRole('button', { name: 'Instagram options' }))
    expect(screen.queryByRole('menuitem', { name: /Pull now/ })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /Open/ })).toHaveAttribute('href', 'https://www.instagram.com/skeen/')
  })

  it('Retry on a failed row pulls it again', async () => {
    mount()
    fireEvent.click(within(rowOf('Bandsintown')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(pullConnectionAction).toHaveBeenCalledWith('a1', 'bandsintown'))
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

  it('a row’s own Connect opens straight on that connection’s details, link prefilled', () => {
    mount()
    fireEvent.click(within(rowOf('Apple Music')).getByRole('button', { name: /Connect/ }))
    const dialog = screen.getByRole('dialog', { name: 'Connect' })
    expect(within(dialog).getByRole('textbox', { name: 'Apple Music link' })).toHaveValue('https://music.apple.com/artist/1')
    expect(within(dialog).queryByRole('textbox', { name: 'Search' })).toBeNull()
  })
})
