// @vitest-environment jsdom
/**
 * When the Google app is set up, the YouTube row offers a "Connect with YouTube" sign-in button
 * above the paste field; when it is not, the row is the paste field alone.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal.tsx,
 *           connection-list.tsx
 * Feature:  Connections page: Connect with YouTube (Sam, 2026-09-28)
 * Tier:     LIGHT (AGENTS.md "Test depth"): UI still being designed. The main path works and the
 *           rules that matter hold, not every label or layout detail.
 * Covers:   • set up: the button links to our start route with the artist (and `sync=0` when
 *             Sync is off), above the paste field that stays; clicking it never saves here
 *           • the paste field still connects a handle the old way
 *           • with other picks, leaving for Google never strands them: Connect runs them first,
 *             a blank YouTube row waits, then the button shows
 *           • not set up: no button, the paste field alone
 * Not here: what the start route does (tests/unit/manager-tools/connections/youtube-oauth-routes.test.ts);
 *           how the page decides "set up" (connections-page-youtube.test.ts in that folder).
 * Fixtures: rendered in jsdom with Testing Library; the Connections actions, the dashboard
 *           actions, the router and the toast are mocks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConnectModal } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal'
import { ConnectionList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-list'
import { connectOneAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishEntityAction: vi.fn(async () => ({ ok: true })),
  updateContentAction: vi.fn(async () => ({})),
  saveSourceIdAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true, message: 'found' })),
  getShopifyDomainAction: vi.fn(async () => null),
  disconnectConnectionAction: vi.fn(async () => ({})),
  pullConnectionAction: vi.fn(async () => ({ ok: true })),
  syncProfileAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/artists/[id]/(dashboard)/toast', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const START = '/api/youtube/start?artist=a1'

/** Click a link and report whether the browser would have followed it. */
function clickFollows(link: HTMLElement): boolean {
  let prevented = true
  const spy = (e: Event) => {
    prevented = e.defaultPrevented
    e.preventDefault() // jsdom cannot navigate
  }
  document.addEventListener('click', spy)
  fireEvent.click(link)
  document.removeEventListener('click', spy)
  return !prevented
}

function openConnect(youtubeApp?: boolean) {
  render(<ConnectModal artistId="a1" taken={[]} onClose={vi.fn()} onDone={vi.fn()} youtubeApp={youtubeApp} />)
  return screen.getByRole('dialog', { name: 'Connect' })
}

function pick(dialog: HTMLElement, ...names: string[]) {
  for (const n of names) fireEvent.click(within(dialog).getByRole('button', { name: n }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
}

describe('the YouTube row', () => {
  // Set up: the button goes to our start route above the paste field, carries Sync off when it
  // is unticked, is a real link the browser follows, and saves nothing here.
  it('CRITICAL: configured — Connect with YouTube goes to the start route, above the paste field that stays', () => {
    const dialog = openConnect(true)
    pick(dialog, 'YouTube')
    const link = within(dialog).getByRole('link', { name: 'Connect with YouTube' })
    expect(link).toHaveAttribute('href', START)
    const field = within(dialog).getByRole('textbox', { name: 'YouTube handle' })
    // Above it, in reading order.
    expect(link.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Sync off travels with the trip.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Import videos' }))
    expect(link).toHaveAttribute('href', `${START}&sync=0`)
    expect(clickFollows(link)).toBe(true)
    expect(connectOneAction).not.toHaveBeenCalled()
  })

  // The paste field still connects a handle the old way.
  it('the paste fallback still connects the old way', async () => {
    const dialog = openConnect(true)
    pick(dialog, 'YouTube')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'YouTube handle' }), { target: { value: 'skeenmusic' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledWith('a1', 'youtube', { handle: 'skeenmusic', sync: true }))
  })

  // Not set up: no button, just the paste field.
  it('CRITICAL: not configured — no button, just the paste field', () => {
    const dialog = openConnect()
    pick(dialog, 'YouTube')
    expect(within(dialog).getByRole('textbox', { name: 'YouTube handle' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Connect with YouTube' })).toBeNull()
  })

  // With other services picked too, Connect runs them first; the blank YouTube row waits (not
  // refused), and only then does the button show, so leaving for Google strands nothing.
  it('CRITICAL: with other picks, Connect runs THEM, a blank YouTube waits, then the button shows', async () => {
    const dialog = openConnect(true)
    pick(dialog, 'Bandsintown', 'YouTube')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Bandsintown Bandsintown artist name' }), { target: { value: 'Skeen' } })
    // Not yet: leaving now would strand Bandsintown.
    expect(within(dialog).queryByRole('link', { name: 'Connect with YouTube' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledTimes(1))
    expect(vi.mocked(connectOneAction).mock.calls[0]).toEqual(['a1', 'bandsintown', { id: 'Skeen' }])
    const link = await within(dialog).findByRole('link', { name: 'Connect with YouTube' })
    expect(link).toHaveAttribute('href', START)
    // YouTube was not RUN and refused ("Enter the YouTube handle."): it waits for its trip.
    expect(within(dialog).getByLabelText('waiting')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('1 connected')
    expect(dialog).not.toHaveTextContent(/didn’t|Enter the YouTube handle/)
  })

  // The list passes "set up" on to the Connect window it opens.
  it('the list hands the flag to the Connect window', () => {
    render(<ConnectionList artistId="a1" rows={[]} youtubeApp />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const dialog = screen.getByRole('dialog', { name: 'Connect' })
    pick(dialog, 'YouTube')
    expect(within(dialog).getByRole('link', { name: 'Connect with YouTube' })).toBeInTheDocument()
  })
})
