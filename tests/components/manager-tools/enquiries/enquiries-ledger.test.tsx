// @vitest-environment jsdom
// The Enquiries list, on the Subscribers layout: rows, search, type/sort menus, the modal, delete.
/**
 * The enquiries list (Sam, 2026-10-05: restyled onto the Subscribers page's layout, replacing
 * the table; the same day: no kind on the rows, a Type menu and a Sort menu, and an enquiry
 * opens in a modal that also says when it will be deleted).
 *
 * It is a record store, not a mail client: nobody answers a booking from here, and right now —
 * with sending not switched on — this IS the delivery mechanism. So the behaviours that matter
 * are about never hiding anything: every row shows who, what kind and when; search and the
 * menus narrow and reorder without losing anything; opening shows the whole message; delete
 * asks first.
 * LIGHT for the layout (AGENTS.md "Test depth"); strict only where a URL is rendered.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EnquiriesLedger } from '@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/enquiries-ledger'
import {
  deleteEnquiryAction,
  setEnquiryReadAction,
  signEnquiryAttachmentsAction,
} from '@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions'
import type { InboxRow } from '@/lib/enquiries/inbox'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/enquiries/actions', () => ({
  setEnquiryReadAction: vi.fn(async () => ({ ok: true })),
  signEnquiryAttachmentsAction: vi.fn(async () => []),
  deleteEnquiryAction: vi.fn(async () => ({ ok: true })),
}))

const setRead = vi.mocked(setEnquiryReadAction)
const sign = vi.mocked(signEnquiryAttachmentsAction)
const del = vi.mocked(deleteEnquiryAction)

/** The three kinds every artist starts with (the seeding trigger, 20260921120000). */
const SEEDED = [
  { slug: 'booking', label: 'Booking' },
  { slug: 'demo', label: 'Demo' },
  { slug: 'other', label: 'Contact' },
]

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: 'e1',
  purpose: 'booking',
  purposeLabel: 'Booking',
  name: 'Jamie Rowe',
  email: 'jamie@example.com',
  message: 'Can you play the Aug 14 show at Mohawk?',
  read_at: null,
  created_at: '2026-08-04T10:00:00Z',
  demo_url: null,
  attachmentCount: 0,
  artistId: 'a1',
  artistName: 'Lone Pine',
  status: 'sent',
  ...over,
})

beforeEach(() => {
  setRead.mockClear()
  sign.mockClear()
  sign.mockResolvedValue([])
  del.mockClear()
  del.mockResolvedValue({ ok: true })
})
afterEach(cleanup)

/** The row's open button (its text and day), by the sender's name. */
const rowButton = (name: string) => within(rowOf(name)).getByRole('button', { name: new RegExp(name) })
/** The row (`li`) a sender's name sits in. */
const rowOf = (name: string) => within(screen.getByRole('list', { name: 'Enquiries' })).getByText(name).closest('li')!
const openRow = async (name: string) => {
  await act(async () => {
    fireEvent.click(rowButton(name))
  })
}
const modal = () => screen.getByRole('dialog', { name: /^Enquiry from / })
const queryModal = () => screen.queryByRole('dialog', { name: /^Enquiry from / })
/** Pick `option` in the toolbar menu named `menu` (Type, Sort). */
const choose = async (menu: string, option: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('combobox', { name: menu }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${option}`) }))
  })
}
const names = () => within(screen.getByRole('list', { name: 'Enquiries' })).getAllByRole('listitem').map((li) => li.querySelector('span span span')!.textContent)

describe('EnquiriesLedger — the empty case', () => {
  it('no enquiries at all: one quiet line, and nothing to search or filter (as Subscribers)', () => {
    // Sam, 2026-10-05: follow the Subscribers page, which shows one line and no toolbar when
    // the list is empty. (The table used to render its columns and filters regardless.)
    render(<EnquiriesLedger rows={[]} kinds={SEEDED} />)
    expect(screen.getByText('No enquiries yet.')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('distinguishes "no enquiries" from "none match this filter"', async () => {
    render(<EnquiriesLedger rows={[row({ read_at: '2026-08-04T11:00:00Z' })]} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unread' }))
    })
    expect(screen.getByText('Nothing unread.')).toBeInTheDocument()
    expect(screen.queryByText(/No enquiries yet/)).toBeNull()
  })
})

describe('EnquiriesLedger — rows', () => {
  it('each row shows who, their address, a snippet and the day — and NOT the kind (Sam: "We can sort for those")', () => {
    render(<EnquiriesLedger rows={[row({ status: 'unroutable' })]} kinds={SEEDED} />)
    const r = within(rowOf('Jamie Rowe'))
    expect(r.getByText('jamie@example.com')).toBeInTheDocument()
    expect(r.getByText(/Can you play/)).toBeInTheDocument()
    expect(r.getByText('Aug 4, 2026')).toBeInTheDocument()
    expect(r.queryByText('Booking')).toBeNull()
    // The delivery and deletion notes live in the modal now, not on the row.
    expect(r.queryByText(/deleted|not emailed/i)).toBeNull()
  })

  it('CRITICAL: nothing is opened on arrival — you came to look something up', () => {
    render(<EnquiriesLedger rows={[row()]} />)
    expect(setRead).not.toHaveBeenCalled()
    expect(queryModal()).toBeNull()
  })

  it('unread rows say so; read rows do not', () => {
    render(<EnquiriesLedger rows={[row({ id: 'u', name: 'New One' }), row({ id: 'r', name: 'Old One', read_at: '2026-08-04T11:00:00Z' })]} />)
    expect(within(rowOf('New One')).getByText('unread')).toBeInTheDocument()
    expect(within(rowOf('Old One')).getByText('read')).toBeInTheDocument()
    // The unread count rides on the Unread word.
    expect(screen.getByRole('button', { name: 'Unread 1' })).toBeInTheDocument()
  })

  it('Reply is a mailto: to the sender, address encoded, with a subject', () => {
    render(<EnquiriesLedger rows={[row({ email: 'a+b?cc=x@example.com' })]} />)
    expect(within(rowOf('Jamie Rowe')).getByRole('link', { name: 'Reply' })).toHaveAttribute(
      'href',
      'mailto:a%2Bb%3Fcc%3Dx@example.com?subject=Re%3A%20your%20enquiry',
    )
  })

  it('names the artist on each row only when asked', () => {
    const { rerender } = render(<EnquiriesLedger rows={[row()]} />)
    expect(screen.queryByText('Lone Pine')).toBeNull()
    rerender(<EnquiriesLedger rows={[row()]} showArtist />)
    expect(within(rowOf('Jamie Rowe')).getByText('Lone Pine')).toBeInTheDocument()
  })
})

describe('EnquiriesLedger — the open enquiry is a modal (Sam, 2026-10-05)', () => {
  const long =
    'Can you play the Aug 14 show at Mohawk? We can cover travel and provide backline, and we would want a 45 minute set.'

  it('opens in a modal: the facts first (who, kind, when, when it is deleted), then the FULL message; marks it read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
    // A long message on purpose: the row shows a cut snippet, so finding the whole text
    // proves the modal renders the message rather than the preview again.
    render(<EnquiriesLedger rows={[row({ id: 'x', message: long, created_at: '2026-09-25T12:00:00Z' })]} />)
    await openRow('Jamie Rowe')
    const m = within(modal())
    // Sam: "Maybe the from, type, received should be at the top."
    const facts = within(modal().querySelector('[data-enquiry-facts]') as HTMLElement)
    expect(facts.getByText('Jamie Rowe')).toBeInTheDocument()
    expect(facts.getByText('jamie@example.com')).toBeInTheDocument()
    expect(facts.getByText('Booking')).toBeInTheDocument()
    expect(m.getByText('deleted in 20 days')).toBeInTheDocument()
    const message = m.getByText(long)
    expect(modal().querySelector('[data-enquiry-facts]')!.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // And when it will be deleted sits at the bottom, after the message (Sam: "bottom left").
    expect(message.compareDocumentPosition(m.getByText('deleted in 20 days')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(setRead).toHaveBeenCalledWith('a1', 'x', true)
    vi.useRealTimers()
  })

  it('opening a READ enquiry writes nothing', async () => {
    render(<EnquiriesLedger rows={[row({ read_at: '2026-08-04T11:00:00Z' })]} />)
    await openRow('Jamie Rowe')
    expect(modal()).toBeInTheDocument()
    expect(setRead).not.toHaveBeenCalled()
  })

  it('Escape closes it and hands focus back to the row', async () => {
    render(<EnquiriesLedger rows={[row()]} />)
    await openRow('Jamie Rowe')
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(queryModal()).toBeNull()
    expect(rowButton('Jamie Rowe')).toHaveFocus()
  })

  it('offers Mark unread once read, so glancing does not destroy the signal', async () => {
    render(<EnquiriesLedger rows={[row({ id: 'x' })]} />)
    await openRow('Jamie Rowe')
    await act(async () => {
      fireEvent.click(within(modal()).getByRole('button', { name: 'Mark unread' }))
    })
    expect(setRead).toHaveBeenCalledWith('a1', 'x', false)
    expect(within(rowOf('Jamie Rowe')).getByText('unread')).toBeInTheDocument()
  })

  it('CRITICAL: says when a message was never emailed, and why — two different fixes', async () => {
    // Without this the list reads as a record of messages DELIVERED. With mail not yet
    // configured for every kind, a manager assuming otherwise is the failure.
    render(<EnquiriesLedger rows={[row({ id: 'u', name: 'Unrouted One', status: 'unroutable' }), row({ id: 'f', name: 'Failed One', status: 'failed' })]} />)
    await openRow('Unrouted One')
    expect(within(modal()).getByText(/Not emailed: nobody was set to receive it/)).toBeInTheDocument()
    expect(within(modal()).getByText(/· deleted in \d+ days/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await openRow('Failed One')
    expect(within(modal()).getByText(/failed to send/)).toBeInTheDocument()
  })

  it('says nothing about delivery for an emailed message', async () => {
    render(<EnquiriesLedger rows={[row({ status: 'sent' })]} />)
    await openRow('Jamie Rowe')
    expect(within(modal()).queryByText(/Not emailed|failed to send/)).toBeNull()
  })

  it('emailed ones are kept 30 days, the rest 90 (retention.ts), each from its OWN status', async () => {
    // LIGHT (AGENTS.md "Test depth"): the rule itself is pinned in enquiry-retention.test.ts.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
    render(<EnquiriesLedger rows={[row({ id: 'u', name: 'Unrouted One', status: 'unroutable', created_at: '2026-09-25T12:00:00Z' })]} />)
    await openRow('Unrouted One')
    expect(within(modal()).getByText(/· deleted in 80 days$/)).toBeInTheDocument()
    vi.useRealTimers()
  })
})

describe('EnquiriesLedger — search', () => {
  const rows = [
    row({ id: 'a', name: 'Jamie Rowe', email: 'jamie@example.com', message: 'Can you play Mohawk?' }),
    row({ id: 'b', name: 'Nia Patel', email: 'nia@label.co', message: 'Demo attached.', purpose: 'demo', purposeLabel: 'Demo' }),
  ]
  const search = () => screen.getByRole('searchbox', { name: 'Search enquiries' })

  it('narrows the rows as you type (sender or message), names a miss, and × brings them back', () => {
    render(<EnquiriesLedger rows={rows} />)
    fireEvent.change(search(), { target: { value: 'PATEL' } })
    expect(screen.queryByText('Jamie Rowe')).toBeNull()
    expect(screen.getByText('Patel')).toBeInTheDocument() // marked inside "Nia Patel"
    fireEvent.change(search(), { target: { value: 'mohawk' } })
    expect(screen.getByText('Jamie Rowe')).toBeInTheDocument()
    expect(screen.queryByText(/Nia/)).toBeNull()
    fireEvent.change(search(), { target: { value: 'zzz' } })
    expect(screen.getByText('No enquiries match “zzz”.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('EnquiriesLedger — the Type menu is the ARTIST’S kinds', () => {
  // Kinds are the artist's to invent since 2026-09-21; since 2026-10-05 they are a menu
  // (Sam: "Lets add a dropdown for the type of inquiry"), not words and not on the rows.
  const kinds = [
    { slug: 'booking', label: 'Booking' },
    { slug: 'press', label: 'Press' },
  ]
  const rows = [
    row({ id: 'b', name: 'Booker', purpose: 'booking' }),
    row({ id: 'p', name: 'Journalist', purpose: 'press', purposeLabel: 'Press', read_at: '2026-08-04T11:00:00Z' }),
  ]

  it('offers All types, then each of the artist’s kinds in their order — and no hard-coded Demos', async () => {
    render(<EnquiriesLedger rows={rows} kinds={kinds} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Type' }))
    })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All types', 'Booking', 'Press'])
  })

  it('filters to an artist-invented kind, regardless of read state', async () => {
    render(<EnquiriesLedger rows={rows} kinds={kinds} />)
    await choose('Type', 'Press')
    expect(screen.getByText('Journalist')).toBeInTheDocument()
    expect(screen.queryByText('Booker')).toBeNull()
  })

  it('combines with Unread, and names the type when nothing matches', async () => {
    render(<EnquiriesLedger rows={rows} kinds={kinds} />)
    await choose('Type', 'Press')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Unread/ }))
    })
    expect(screen.getByText('Nothing unread in Press.')).toBeInTheDocument()
  })

  it('with no kind list (the roster inbox), offers the kinds the rows carry', async () => {
    render(<EnquiriesLedger rows={[row({ purpose: 'demo', purposeLabel: 'Demo' })]} showArtist />)
    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Type' }))
    })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All types', 'Demo'])
  })
})

describe('EnquiriesLedger — the Sort menu', () => {
  it('Newest by default; Oldest and Name A–Z reorder the rows', async () => {
    render(
      <EnquiriesLedger
        rows={[
          row({ id: 'm', name: 'Abe', created_at: '2026-09-02T10:00:00Z' }),
          row({ id: 'n', name: 'Zed', created_at: '2026-09-03T10:00:00Z' }),
          row({ id: 'o', name: 'Mid', created_at: '2026-09-01T10:00:00Z' }),
        ]}
      />,
    )
    expect(names()).toEqual(['Zed', 'Abe', 'Mid'])
    await choose('Sort', 'Oldest')
    expect(names()).toEqual(['Mid', 'Abe', 'Zed'])
    await choose('Sort', 'Name A–Z')
    expect(names()).toEqual(['Abe', 'Mid', 'Zed'])
  })
})

describe('EnquiriesLedger — deleting an enquiry', () => {
  // Sam, 2026-09-28: "a manager can delete an inquiry" (spam). Irreversible, so it asks
  // first, in the app's own confirm dialog. From the row's own glyph, as on Subscribers.
  const askToDelete = async () => {
    await act(async () => {
      fireEvent.click(within(rowOf('Jamie Rowe')).getByRole('button', { name: 'Delete' }))
    })
    return screen.getByRole('dialog', { name: /Delete the enquiry/ })
  }

  it('deletes after the manager confirms, and the row leaves the list', async () => {
    render(<EnquiriesLedger rows={[row({ id: 'x' }), row({ id: 'y', name: 'Other' })]} />)
    const dialog = await askToDelete()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    })
    expect(del).toHaveBeenCalledWith('a1', 'x')
    expect(screen.queryByText('Jamie Rowe')).toBeNull()
  })

  it('CRITICAL: Cancel deletes nothing', async () => {
    render(<EnquiriesLedger rows={[row({ id: 'x' })]} />)
    const dialog = await askToDelete()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    })
    expect(del).not.toHaveBeenCalled()
    expect(screen.getByText('Jamie Rowe')).toBeInTheDocument()
  })

  it('keeps the row when the server refuses', async () => {
    del.mockResolvedValue({ ok: false, error: 'That enquiry is no longer there — refresh the page.' })
    render(<EnquiriesLedger rows={[row({ id: 'x' })]} />)
    const dialog = await askToDelete()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    })
    expect(del).toHaveBeenCalledWith('a1', 'x')
    expect(screen.getByText('Jamie Rowe')).toBeInTheDocument()
  })

  it('from the modal too: confirmed, the modal closes and the row goes', async () => {
    render(<EnquiriesLedger rows={[row({ id: 'x' })]} />)
    await openRow('Jamie Rowe')
    await act(async () => {
      fireEvent.click(within(modal()).getByRole('button', { name: 'Delete' }))
    })
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog', { name: /Delete the enquiry/ })).getByRole('button', { name: 'Confirm' }))
    })
    expect(del).toHaveBeenCalledWith('a1', 'x')
    expect(queryModal()).toBeNull()
    expect(screen.queryByText('Jamie Rowe')).toBeNull()
  })
})

describe('EnquiriesLedger — attachments', () => {
  it('CRITICAL: signs only when one is opened', async () => {
    render(<EnquiriesLedger rows={[row({ attachmentCount: 2 })]} />)
    expect(sign).not.toHaveBeenCalled()
    await openRow('Jamie Rowe')
    expect(sign).toHaveBeenCalledWith('e1')
  })

  it('says an attachment expired rather than showing nothing', async () => {
    sign.mockResolvedValue([
      { id: 'f1', filename: 'demo.mp3', mime_type: 'audio/mpeg', bytes: null, url: null, expired: true, neverUploaded: false },
    ])
    render(<EnquiriesLedger rows={[row({ attachmentCount: 1 })]} />)
    await openRow('Jamie Rowe')
    expect(await screen.findByText(/Attachment expired/)).toBeInTheDocument()
  })

  it('CRITICAL: a javascript: demo link is never rendered as a link', async () => {
    render(<EnquiriesLedger rows={[row({ demo_url: 'javascript:alert(1)' })]} />)
    await openRow('Jamie Rowe')
    expect(screen.queryByText(/javascript:/)).toBeNull()
  })

  it('renders an https demo link with noopener', async () => {
    render(<EnquiriesLedger rows={[row({ demo_url: 'https://soundcloud.com/x' })]} />)
    await openRow('Jamie Rowe')
    const link = within(modal()).getByRole('link', { name: 'https://soundcloud.com/x' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('EnquiriesLedger — the artist selector', () => {
  const two = [
    row({ id: 'a', name: 'From Pine', artistId: 'a1', artistName: 'Lone Pine' }),
    row({ id: 'b', name: 'From Gulf', artistId: 'a2', artistName: 'Gulf Static' }),
  ]

  it('CRITICAL: narrows the list to one artist', async () => {
    render(<EnquiriesLedger rows={two} showArtist />)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by artist'), { target: { value: 'a2' } })
    })
    expect(screen.getByText('From Gulf')).toBeInTheDocument()
    expect(screen.queryByText('From Pine')).toBeNull()
  })

  it('offers only artists that actually have enquiries here', () => {
    render(<EnquiriesLedger rows={two} showArtist />)
    const options = within(screen.getByLabelText('Filter by artist')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['All artists', 'Gulf Static', 'Lone Pine'])
  })

  it('is hidden on a single artist’s page', () => {
    render(<EnquiriesLedger rows={two} />)
    expect(screen.queryByLabelText('Filter by artist')).toBeNull()
  })

  it('is hidden when every enquiry belongs to the same artist', () => {
    // A selector with one real choice is a control that cannot do anything.
    render(<EnquiriesLedger rows={[two[0]]} showArtist />)
    expect(screen.queryByLabelText('Filter by artist')).toBeNull()
  })

  it('CRITICAL: names the artist, not the type, when the artist is the reason', async () => {
    render(
      <EnquiriesLedger
        rows={[...two, row({ id: 'c', purpose: 'demo', purposeLabel: 'Demo', artistId: 'a3', artistName: 'Third' })]}
        showArtist
      />,
    )
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by artist'), { target: { value: 'a1' } })
    })
    await choose('Type', 'Demo')
    expect(screen.getByText('Nothing here for Lone Pine.')).toBeInTheDocument()
  })
})

describe('the modal reads the kind’s label from the row data', () => {
  it('shows an artist-invented kind by its label, not its slug', async () => {
    // Labels are resolved server-side from enquiry_kinds, so a custom kind and a renamed one
    // both read as the manager named them.
    render(<EnquiriesLedger rows={[row({ purpose: 'sync-licensing', purposeLabel: 'Sync licensing' })]} />)
    await openRow('Jamie Rowe')
    expect(within(modal()).getByText('Sync licensing')).toBeTruthy()
    expect(screen.queryByText('sync-licensing')).toBeNull()
  })
})
