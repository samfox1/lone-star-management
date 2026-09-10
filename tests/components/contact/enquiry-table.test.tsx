// @vitest-environment jsdom
// The enquiries table. It is a record store, not a mail client, so it must never hide a row.
/**
 * The enquiries table.
 *
 * It is a record store, not a mail client: nobody answers a booking from here, and right
 * now — with sending not switched on — this IS the delivery mechanism. So the behaviours
 * that matter are about never hiding anything and always telling the manager what lands
 * here, including when nothing has yet.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EnquiryTable } from '@/app/artists/[id]/(dashboard)/enquiries/enquiry-table'
import {
  setEnquiryReadAction,
  signEnquiryAttachmentsAction,
} from '@/app/artists/[id]/(dashboard)/enquiries/actions'
import type { InboxRow } from '@/lib/enquiry-inbox'

vi.mock('@/app/artists/[id]/(dashboard)/enquiries/actions', () => ({
  setEnquiryReadAction: vi.fn(async () => ({ ok: true })),
  signEnquiryAttachmentsAction: vi.fn(async () => []),
}))

const setRead = vi.mocked(setEnquiryReadAction)
const sign = vi.mocked(signEnquiryAttachmentsAction)

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: 'e1',
  purpose: 'booking',
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
})
afterEach(cleanup)

const openRow = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByText(name))
  })
}

describe('EnquiryTable — the empty case', () => {
  it('CRITICAL: renders the table and its filters with NO enquiries at all', async () => {
    // The screenshot that prompted this: an empty page showed one dashed box and nothing
    // else — no columns, no filters, no clue what would ever appear or how to find it.
    render(<EnquiryTable rows={[]} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'From' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Received' })).toBeInTheDocument()
    for (const f of ['All', 'Unread', 'Demos']) {
      expect(screen.getByRole('button', { name: f })).toBeInTheDocument()
    }
  })

  it('says what will land here, not just that nothing has', () => {
    render(<EnquiryTable rows={[]} />)
    expect(screen.getByText(/Booking and demo messages from the site/)).toBeInTheDocument()
  })

  it('distinguishes "no enquiries" from "none match this filter"', async () => {
    render(<EnquiryTable rows={[row({ read_at: '2026-08-04T11:00:00Z' })]} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unread' }))
    })
    expect(screen.getByText('Nothing unread.')).toBeInTheDocument()
    expect(screen.queryByText(/No enquiries yet/)).toBeNull()
  })
})

describe('EnquiryTable — rows', () => {
  it('shows the sender, type, snippet and time without opening anything', async () => {
    render(<EnquiryTable rows={[row()]} />)
    expect(screen.getByText('Jamie Rowe')).toBeInTheDocument()
    expect(screen.getByText('Booking')).toBeInTheDocument()
    expect(screen.getByText(/Can you play/)).toBeInTheDocument()
  })

  it('CRITICAL: nothing is expanded on arrival — you came to look something up', async () => {
    render(<EnquiryTable rows={[row()]} />)
    expect(setRead).not.toHaveBeenCalled()
    expect(screen.getAllByRole('row')).toHaveLength(2) // header + one row, no detail row
  })

  it('opens a row in place, marks it read, and shows the FULL message', async () => {
    // A long message on purpose: the row shows a truncated snippet, so finding the whole
    // text proves the detail row is rendering the message rather than the preview again.
    const long =
      'Can you play the Aug 14 show at Mohawk? We can cover travel and provide backline, and we would want a 45 minute set.'
    render(<EnquiryTable rows={[row({ id: 'x', message: long })]} />)
    await openRow('Jamie Rowe')
    expect(setRead).toHaveBeenCalledWith('a1', 'x', true)
    expect(screen.getByText(long)).toBeInTheDocument()
  })

  it('closes again on a second click', async () => {
    render(<EnquiryTable rows={[row()]} />)
    await openRow('Jamie Rowe')
    await openRow('Jamie Rowe')
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })

  it('offers Mark unread once read, so glancing does not destroy the signal', async () => {
    render(<EnquiryTable rows={[row({ id: 'x' })]} />)
    await openRow('Jamie Rowe')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark unread' }))
    })
    expect(setRead).toHaveBeenCalledWith('a1', 'x', false)
  })

  it('shows the artist column only when asked', () => {
    const { rerender } = render(<EnquiryTable rows={[row()]} />)
    expect(screen.queryByRole('columnheader', { name: 'Artist' })).toBeNull()
    rerender(<EnquiryTable rows={[row()]} showArtist />)
    expect(screen.getByRole('columnheader', { name: 'Artist' })).toBeInTheDocument()
    expect(screen.getAllByText('Lone Pine').length).toBeGreaterThan(0)
  })

  it('filters to demos regardless of read state', async () => {
    const rows = [
      row({ id: 'b', name: 'Booker', purpose: 'booking' }),
      row({ id: 'd', name: 'Demoer', purpose: 'demo', read_at: '2026-08-04T11:00:00Z' }),
    ]
    render(<EnquiryTable rows={rows} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Demos' }))
    })
    expect(screen.getByText('Demoer')).toBeInTheDocument()
    expect(screen.queryByText('Booker')).toBeNull()
  })
})

describe('EnquiryTable — attachments', () => {
  it('CRITICAL: signs only when a row is opened', async () => {
    render(<EnquiryTable rows={[row({ attachmentCount: 2 })]} />)
    expect(sign).not.toHaveBeenCalled()
    await openRow('Jamie Rowe')
    expect(sign).toHaveBeenCalledWith('e1')
  })

  it('says an attachment expired rather than showing nothing', async () => {
    sign.mockResolvedValue([
      { id: 'f1', filename: 'demo.mp3', mime_type: 'audio/mpeg', bytes: null, url: null, expired: true, neverUploaded: false },
    ])
    render(<EnquiryTable rows={[row({ attachmentCount: 1 })]} />)
    await openRow('Jamie Rowe')
    expect(await screen.findByText(/Attachment expired/)).toBeInTheDocument()
  })

  it('CRITICAL: a javascript: demo link is never rendered as a link', async () => {
    render(<EnquiryTable rows={[row({ demo_url: 'javascript:alert(1)' })]} />)
    await openRow('Jamie Rowe')
    expect(screen.queryByText(/javascript:/)).toBeNull()
  })

  it('renders an https demo link with noopener', async () => {
    render(<EnquiryTable rows={[row({ demo_url: 'https://soundcloud.com/x' })]} />)
    await openRow('Jamie Rowe')
    const link = screen.getByRole('link', { name: 'https://soundcloud.com/x' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('EnquiryTable — delivery state', () => {
  it('CRITICAL: says when a message was never emailed', async () => {
    // Without this the table reads as a record of messages DELIVERED. With mail not yet
    // configured, none of them are, and a manager assuming otherwise is the failure.
    render(<EnquiryTable rows={[row({ status: 'unroutable' })]} />)
    await openRow('Jamie Rowe')
    expect(screen.getByText(/Not emailed/)).toBeInTheDocument()
  })

  it('distinguishes a failed send from an unconfigured one — different fixes', async () => {
    render(<EnquiryTable rows={[row({ status: 'failed' })]} />)
    await openRow('Jamie Rowe')
    expect(screen.getByText(/failed to send/)).toBeInTheDocument()
  })

  it('says nothing for a delivered message', async () => {
    render(<EnquiryTable rows={[row({ status: 'sent' })]} />)
    await openRow('Jamie Rowe')
    expect(screen.queryByText(/Not emailed/)).toBeNull()
  })
})

describe('EnquiryTable — the artist selector', () => {
  const two = [
    row({ id: 'a', name: 'From Pine', artistId: 'a1', artistName: 'Lone Pine' }),
    row({ id: 'b', name: 'From Gulf', artistId: 'a2', artistName: 'Gulf Static' }),
  ]

  it('CRITICAL: narrows the table to one artist', async () => {
    render(<EnquiryTable rows={two} showArtist />)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by artist'), { target: { value: 'a2' } })
    })
    expect(screen.getByText('From Gulf')).toBeInTheDocument()
    expect(screen.queryByText('From Pine')).toBeNull()
  })

  it('offers only artists that actually have enquiries here', () => {
    render(<EnquiryTable rows={two} showArtist />)
    const options = within(screen.getByLabelText('Filter by artist')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['All artists', 'Gulf Static', 'Lone Pine'])
  })

  it('is hidden on a single artist’s page', () => {
    render(<EnquiryTable rows={two} />)
    expect(screen.queryByLabelText('Filter by artist')).toBeNull()
  })

  it('is hidden when every enquiry belongs to the same artist', () => {
    // A selector with one real choice is a control that cannot do anything.
    render(<EnquiryTable rows={[two[0]]} showArtist />)
    expect(screen.queryByLabelText('Filter by artist')).toBeNull()
  })

  it('CRITICAL: names the artist, not the filter, when the artist is the reason', async () => {
    render(<EnquiryTable rows={[...two, row({ id: 'c', purpose: 'demo', artistId: 'a3', artistName: 'Third' })]} showArtist />)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by artist'), { target: { value: 'a1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Demos' }))
    })
    expect(screen.getByText('Nothing here for Lone Pine.')).toBeInTheDocument()
  })
})
