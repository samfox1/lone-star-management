// @vitest-environment jsdom
// The Enquiries list, on the Subscribers layout: rows, search, filters, open, read state, delete.
/**
 * The enquiries list (Sam, 2026-10-05: restyled onto the Subscribers page's layout, replacing
 * the table).
 *
 * It is a record store, not a mail client: nobody answers a booking from here, and right now —
 * with sending not switched on — this IS the delivery mechanism. So the behaviours that matter
 * are about never hiding anything: every row shows who, what kind and when; search and the
 * filters narrow without losing anything; opening shows the whole message; delete asks first.
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

const openRow = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByText(name))
  })
}
/** The row (`li`) a sender's name sits in. */
const rowOf = (name: string) => screen.getByText(name).closest('li')!
const detail = () => document.querySelector('[data-enquiry-detail]')

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
  it('each row shows who, their address, the kind, a snippet and the day, without opening anything', () => {
    render(<EnquiriesLedger rows={[row()]} />)
    const r = within(rowOf('Jamie Rowe'))
    expect(r.getByText('jamie@example.com')).toBeInTheDocument()
    // The kind inside the ROW: the same label is also a filter word.
    expect(r.getByText('Booking')).toBeInTheDocument()
    expect(r.getByText(/Can you play/)).toBeInTheDocument()
    expect(r.getByText('Aug 4, 2026')).toBeInTheDocument()
  })

  it('CRITICAL: nothing is expanded on arrival — you came to look something up', () => {
    render(<EnquiriesLedger rows={[row()]} />)
    expect(setRead).not.toHaveBeenCalled()
    expect(detail()).toBeNull()
  })

  it('unread rows say so; read rows do not', () => {
    render(<EnquiriesLedger rows={[row({ id: 'u', name: 'New One' }), row({ id: 'r', name: 'Old One', read_at: '2026-08-04T11:00:00Z' })]} />)
    expect(within(rowOf('New One')).getByText('unread')).toBeInTheDocument()
    expect(within(rowOf('Old One')).getByText('read')).toBeInTheDocument()
    // The unread count rides on the Unread word.
    expect(screen.getByRole('button', { name: 'Unread 1' })).toBeInTheDocument()
  })

  it('opens a row in place, marks it read, and shows the FULL message', async () => {
    // A long message on purpose: the row shows a truncated snippet, so finding the whole
    // text proves the detail row is rendering the message rather than the preview again.
    const long =
      'Can you play the Aug 14 show at Mohawk? We can cover travel and provide backline, and we would want a 45 minute set.'
    render(<EnquiriesLedger rows={[row({ id: 'x', message: long })]} />)
    await openRow('Jamie Rowe')
    expect(setRead).toHaveBeenCalledWith('a1', 'x', true)
    expect(screen.getByText(long)).toBeInTheDocument()
  })

  it('closes again on a second click', async () => {
    render(<EnquiriesLedger rows={[row()]} />)
    await openRow('Jamie Rowe')
    expect(detail()).not.toBeNull()
    await openRow('Jamie Rowe')
    expect(detail()).toBeNull()
  })

  it('Reply is a mailto: to the sender, address encoded, with a subject', () => {
    render(<EnquiriesLedger rows={[row({ email: 'a+b?cc=x@example.com' })]} />)
    expect(screen.getByRole('link', { name: 'Reply' })).toHaveAttribute(
      'href',
      'mailto:a%2Bb%3Fcc%3Dx@example.com?subject=Re%3A%20your%20enquiry',
    )
  })

  it('offers Mark unread once read, so glancing does not destroy the signal', async () => {
    render(<EnquiriesLedger rows={[row({ id: 'x' })]} />)
    await openRow('Jamie Rowe')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark unread' }))
    })
    expect(setRead).toHaveBeenCalledWith('a1', 'x', false)
  })

  it('names the artist on each row only when asked', () => {
    const { rerender } = render(<EnquiriesLedger rows={[row()]} />)
    expect(screen.queryByText('Lone Pine')).toBeNull()
    rerender(<EnquiriesLedger rows={[row()]} showArtist />)
    expect(within(rowOf('Jamie Rowe')).getByText('Lone Pine')).toBeInTheDocument()
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

describe("EnquiriesLedger — filters are the ARTIST'S kinds", () => {
  // The bar used to be All · Unread · Demos, with "Demos" hard-coded. Kinds are the
  // artist's to invent since 2026-09-21, so the bar offers theirs.
  const kinds = [
    { slug: 'booking', label: 'Booking' },
    { slug: 'press', label: 'Press' },
  ]

  it('offers All, Unread, then each of the artist’s kinds — and no hard-coded Demos', () => {
    render(<EnquiriesLedger rows={[row({ read_at: '2026-08-04T11:00:00Z' })]} kinds={kinds} />)
    const labels = within(screen.getByRole('group', { name: 'Filter' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(labels).toEqual(['All', 'Unread', 'Booking', 'Press'])
  })

  it('filters to an artist-invented kind, regardless of read state', async () => {
    const rows = [
      row({ id: 'b', name: 'Booker', purpose: 'booking' }),
      row({ id: 'p', name: 'Journalist', purpose: 'press', purposeLabel: 'Press', read_at: '2026-08-04T11:00:00Z' }),
    ]
    render(<EnquiriesLedger rows={rows} kinds={kinds} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Press' }))
    })
    expect(screen.getByText('Journalist')).toBeInTheDocument()
    expect(screen.queryByText('Booker')).toBeNull()
  })

  it('says the kind is empty, not that the inbox is', async () => {
    render(<EnquiriesLedger rows={[row({ purpose: 'booking' })]} kinds={kinds} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Press' }))
    })
    expect(screen.getByText('Nothing in Press yet.')).toBeInTheDocument()
    expect(screen.queryByText(/No enquiries yet/)).toBeNull()
  })

  it('with no kind list (the roster inbox), offers the kinds the rows carry', () => {
    render(<EnquiriesLedger rows={[row({ purpose: 'demo', purposeLabel: 'Demo' })]} showArtist />)
    expect(screen.getByRole('button', { name: 'Demo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Demos' })).toBeNull()
  })
})

describe('EnquiriesLedger — deleting an enquiry', () => {
  // Sam, 2026-09-28: "a manager can delete an inquiry" (spam). Irreversible, so it asks
  // first, in the app's own confirm dialog.
  // From the row's own glyph, as on Subscribers: no need to open it first.
  const openAndAskToDelete = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })
    return screen.getByRole('dialog')
  }

  it('deletes after the manager confirms, and the row leaves the table', async () => {
    render(<EnquiriesLedger rows={[row({ id: 'x' })]} />)
    const dialog = await openAndAskToDelete()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    })
    expect(del).toHaveBeenCalledWith('a1', 'x')
    expect(screen.queryByText('Jamie Rowe')).toBeNull()
  })

  it('CRITICAL: Cancel deletes nothing', async () => {
    render(<EnquiriesLedger rows={[row({ id: 'x' })]} />)
    const dialog = await openAndAskToDelete()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    })
    expect(del).not.toHaveBeenCalled()
    expect(screen.getByText('Jamie Rowe')).toBeInTheDocument()
  })

  it('keeps the row when the server refuses', async () => {
    del.mockResolvedValue({ ok: false, error: 'That enquiry is no longer there — refresh the page.' })
    render(<EnquiriesLedger rows={[row({ id: 'x' })]} />)
    const dialog = await openAndAskToDelete()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    })
    expect(del).toHaveBeenCalledWith('a1', 'x')
    expect(screen.getByText('Jamie Rowe')).toBeInTheDocument()
  })
})

describe('EnquiriesLedger — attachments', () => {
  it('CRITICAL: signs only when a row is opened', async () => {
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
    const link = screen.getByRole('link', { name: 'https://soundcloud.com/x' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('EnquiriesLedger — delivery state', () => {
  it('CRITICAL: says when a message was never emailed', async () => {
    // Without this the table reads as a record of messages DELIVERED. With mail not yet
    // configured, none of them are, and a manager assuming otherwise is the failure.
    render(<EnquiriesLedger rows={[row({ status: 'unroutable' })]} />)
    await openRow('Jamie Rowe')
    expect(screen.getByText(/Not emailed/)).toBeInTheDocument()
  })

  it('distinguishes a failed send from an unconfigured one — different fixes', async () => {
    render(<EnquiriesLedger rows={[row({ status: 'failed' })]} />)
    await openRow('Jamie Rowe')
    expect(screen.getByText(/failed to send/)).toBeInTheDocument()
  })

  it('says nothing for a delivered message', async () => {
    render(<EnquiriesLedger rows={[row({ status: 'sent' })]} />)
    await openRow('Jamie Rowe')
    expect(screen.queryByText(/Not emailed/)).toBeNull()
  })
})

describe('EnquiriesLedger — how long each one is kept', () => {
  // LIGHT (AGENTS.md "Test depth"): the rule itself is pinned in enquiry-retention.test.ts;
  // this only checks each row shows it, from its OWN status.
  afterEach(() => vi.useRealTimers())

  it('each row says when it is deleted: emailed 30 days, not emailed 90', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
    render(
      <EnquiriesLedger
        rows={[
          row({ id: 's', name: 'Emailed One', status: 'sent', created_at: '2026-09-25T12:00:00Z' }),
          row({ id: 'u', name: 'Unrouted One', status: 'unroutable', created_at: '2026-09-25T12:00:00Z' }),
        ]}
      />,
    )
    expect(within(rowOf('Emailed One')).getByText('deleted in 20 days')).toBeInTheDocument()
    // Not emailed, said quietly on the row itself, beside the longer keep it earns.
    expect(within(rowOf('Unrouted One')).getByText('not emailed · deleted in 80 days')).toBeInTheDocument()
  })
})

describe('EnquiriesLedger — the artist selector', () => {
  const two = [
    row({ id: 'a', name: 'From Pine', artistId: 'a1', artistName: 'Lone Pine' }),
    row({ id: 'b', name: 'From Gulf', artistId: 'a2', artistName: 'Gulf Static' }),
  ]

  it('CRITICAL: narrows the table to one artist', async () => {
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

  it('CRITICAL: names the artist, not the filter, when the artist is the reason', async () => {
    render(
      <EnquiriesLedger
        rows={[...two, row({ id: 'c', purpose: 'demo', purposeLabel: 'Demo', artistId: 'a3', artistName: 'Third' })]}
        showArtist
      />,
    )
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by artist'), { target: { value: 'a1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    })
    expect(screen.getByText('Nothing here for Lone Pine.')).toBeInTheDocument()
  })
})

describe('the row reads the kind\'s label from the row data', () => {
  it('shows an artist-invented kind by its label, not its slug', () => {
    // The table used to hold a three-entry map and fall back to the raw slug. Labels are
    // resolved server-side from enquiry_kinds now, so a custom kind and a renamed one both
    // read as the manager named them.
    render(<EnquiriesLedger rows={[row({ purpose: 'sync-licensing', purposeLabel: 'Sync licensing' })]} />)

    expect(within(rowOf('Jamie Rowe')).getByText('Sync licensing')).toBeTruthy()
    expect(screen.queryByText('sync-licensing')).toBeNull()
  })
})
