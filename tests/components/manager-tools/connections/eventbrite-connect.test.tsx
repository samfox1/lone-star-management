// @vitest-environment jsdom
// Connect with Eventbrite: when the app is set up, the Eventbrite row offers a sign-in button
//   above the paste field (which stays, link only); the connection's own window offers it too.
/**
 * Sam, 2026-09-28. Light, on purpose (AGENTS.md "Test depth": UI still being designed): the
 * main path works, and the rules that matter hold —
 *
 *   - configured: a "Connect with Eventbrite" LINK to our start route, carrying the artist and,
 *     once an organizer link is pasted, that organizer's id; the trip never runs
 *     `connectOneAction` here (the callback does the save);
 *   - no Sync switch on the Eventbrite row: a pasted link cannot pull (the shows need the
 *     sign-in), so a switch would promise what it cannot do;
 *   - not configured: no button anywhere, the paste field alone;
 *   - the Eventbrite connection's window offers the sign-in (a pasted link can't reach the
 *     Connect grid again: it is dimmed there once connected).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConnectModal } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal'
import { ConnectionModal } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-modal'
import { ConnectionList } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/connection-list'
import { connectOneAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions'
import { connectionByKey, type ConnectionRow } from '@/lib/connections'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishEntityAction: vi.fn(async () => ({ ok: true })),
  updateContentAction: vi.fn(async () => ({})),
  saveSourceIdAction: vi.fn(async () => ({})),
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions', () => ({
  connectOneAction: vi.fn(async () => ({ ok: true })),
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

const START = '/api/eventbrite/start?artist=a1'

function openConnect(eventbriteApp?: boolean) {
  render(<ConnectModal artistId="a1" taken={[]} onClose={vi.fn()} onDone={vi.fn()} eventbriteApp={eventbriteApp} />)
  const dialog = screen.getByRole('dialog', { name: 'Connect' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eventbrite' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
  return dialog
}

describe('the Eventbrite row in the Connect window', () => {
  it('CRITICAL: configured — Connect with Eventbrite goes to the start route, above the paste field; a pasted link names the organizer', () => {
    const dialog = openConnect(true)
    const link = within(dialog).getByRole('link', { name: 'Connect with Eventbrite' })
    expect(link).toHaveAttribute('href', START)
    const field = within(dialog).getByRole('textbox', { name: 'Eventbrite link' })
    expect(link.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.change(field, { target: { value: 'https://www.eventbrite.com/o/skeen-222' } })
    expect(link).toHaveAttribute('href', `${START}&organizer=222`)
    // No switch: a pasted link cannot pull.
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    expect(connectOneAction).not.toHaveBeenCalled()
  })

  it('the paste fallback still connects the link the old way', async () => {
    const dialog = openConnect(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Eventbrite link' }), { target: { value: 'https://www.eventbrite.com/o/skeen-222' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledWith('a1', 'eventbrite', expect.objectContaining({ url: 'https://www.eventbrite.com/o/skeen-222' })))
  })

  it('CRITICAL: not configured — no button, no switch, just the paste field', () => {
    const dialog = openConnect()
    expect(within(dialog).getByRole('textbox', { name: 'Eventbrite link' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Connect with Eventbrite' })).toBeNull()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
  })

  it('the list hands the flag to the Connect window', () => {
    render(<ConnectionList artistId="a1" rows={[]} eventbriteApp />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const dialog = screen.getByRole('dialog', { name: 'Connect' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Eventbrite' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(within(dialog).getByRole('link', { name: 'Connect with Eventbrite' })).toBeInTheDocument()
  })
})

describe('the Eventbrite connection’s own window', () => {
  const row: ConnectionRow = {
    def: connectionByKey('eventbrite')!,
    key: 'eventbrite',
    label: 'Eventbrite',
    linkId: 'l-eb',
    url: 'https://www.eventbrite.com/o/skeen-222',
    state: 'connect',
  }

  it('CRITICAL: configured — offers Connect with Eventbrite for the linked organizer', () => {
    render(<ConnectionModal artistId="a1" row={row} open onClose={vi.fn()} onChange={vi.fn()} eventbriteApp />)
    expect(screen.getByRole('link', { name: 'Connect with Eventbrite' })).toHaveAttribute('href', `${START}&organizer=222`)
  })

  it('not configured — no button', () => {
    render(<ConnectionModal artistId="a1" row={row} open onClose={vi.fn()} onChange={vi.fn()} />)
    expect(screen.queryByRole('link', { name: 'Connect with Eventbrite' })).toBeNull()
  })
})
