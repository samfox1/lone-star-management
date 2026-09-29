// @vitest-environment jsdom
/**
 * When the Eventbrite app is set up, the Eventbrite row and its connection window offer a
 * "Connect with Eventbrite" sign-in button above the paste field; when it is not, only the
 * paste field shows.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal.tsx,
 *           connection-modal.tsx, connection-list.tsx
 * Feature:  Connections page: Connect with Eventbrite (Sam, 2026-09-28)
 * Tier:     LIGHT (AGENTS.md "Test depth"): UI still being designed. The main path works and the
 *           rules that matter hold, not every label or layout detail.
 * Covers:   • set up: the button links to our start route with the artist, and the organizer id
 *             once a link is pasted; clicking it never saves here (the callback does)
 *           • no Sync switch on the Eventbrite row: a pasted link cannot pull shows
 *           • the paste field still connects a link the old way
 *           • not set up: no button anywhere, the paste field alone
 *           • the connection's own window offers the sign-in (the Connect grid dims it once linked)
 * Not here: what the start route does with the link (tests/unit/manager-tools/connections/eventbrite-oauth-routes.test.ts);
 *           how the page decides "set up" (connections-page-eventbrite.test.ts in that folder).
 * Fixtures: rendered in jsdom with Testing Library; the Connections actions, the dashboard
 *           actions, the router and the toast are mocks.
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
  // Set up: the button goes to our start route, sits above the paste field, and names the
  // organizer once a link is pasted; there is no Sync switch and nothing is saved here.
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

  // The paste field still connects an organizer link the old way.
  it('the paste fallback still connects the link the old way', async () => {
    const dialog = openConnect(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Eventbrite link' }), { target: { value: 'https://www.eventbrite.com/o/skeen-222' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(connectOneAction).toHaveBeenCalledWith('a1', 'eventbrite', expect.objectContaining({ url: 'https://www.eventbrite.com/o/skeen-222' })))
  })

  // Not set up: no button and no switch, just the paste field.
  it('CRITICAL: not configured — no button, no switch, just the paste field', () => {
    const dialog = openConnect()
    expect(within(dialog).getByRole('textbox', { name: 'Eventbrite link' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Connect with Eventbrite' })).toBeNull()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
  })

  // The list passes "set up" on to the Connect window it opens.
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

  // Set up: the connection's own window offers the sign-in for the organizer already linked.
  it('CRITICAL: configured — offers Connect with Eventbrite for the linked organizer', () => {
    render(<ConnectionModal artistId="a1" row={row} open onClose={vi.fn()} onChange={vi.fn()} eventbriteApp />)
    expect(screen.getByRole('link', { name: 'Connect with Eventbrite' })).toHaveAttribute('href', `${START}&organizer=222`)
  })

  // Not set up: the connection's own window has no button.
  it('not configured — no button', () => {
    render(<ConnectionModal artistId="a1" row={row} open onClose={vi.fn()} onChange={vi.fn()} />)
    expect(screen.queryByRole('link', { name: 'Connect with Eventbrite' })).toBeNull()
  })
})
