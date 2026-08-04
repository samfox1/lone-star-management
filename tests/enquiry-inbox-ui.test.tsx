// @vitest-environment jsdom
/**
 * The inbox as the manager uses it.
 *
 * The rules live in lib/enquiry-inbox.ts and are tested there. This pins the behaviours
 * that only exist once it is a split pane — and the two that are easy to get subtly wrong:
 * opening marks read (with an undo), and audio is signed on open rather than on load.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Inbox } from '@/app/artists/[id]/(dashboard)/enquiries/inbox'
import { markEnquiryReadAction } from '@/app/artists/[id]/(dashboard)/actions'
import {
  markEnquiryUnreadAction,
  signEnquiryAttachmentsAction,
} from '@/app/artists/[id]/(dashboard)/enquiries/actions'
import type { InboxRow } from '@/lib/enquiry-inbox'

vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({ markEnquiryReadAction: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/artists/[id]/(dashboard)/enquiries/actions', () => ({
  markEnquiryUnreadAction: vi.fn(async () => ({ ok: true })),
  signEnquiryAttachmentsAction: vi.fn(async () => []),
}))

const read = vi.mocked(markEnquiryReadAction)
const unread = vi.mocked(markEnquiryUnreadAction)
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
  ...over,
})

beforeEach(() => {
  read.mockClear()
  unread.mockClear()
  sign.mockClear()
  sign.mockResolvedValue([])
})
afterEach(cleanup)

const rowButtons = () => screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') !== null)

describe('Inbox — reading', () => {
  it('CRITICAL: opens the newest UNREAD on arrival, not the newest', async () => {
    const rows = [
      row({ id: 'newest-read', name: 'Already Read', read_at: '2026-08-04T11:00:00Z' }),
      row({ id: 'older-unread', name: 'Still Unread', created_at: '2026-08-03T10:00:00Z' }),
    ]
    await act(async () => {
      render(<Inbox rows={rows} />)
    })
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Still Unread')
  })

  it('CRITICAL: opening a message marks it read', async () => {
    await act(async () => {
      render(<Inbox rows={[row({ id: 'x' })]} />)
    })
    await waitFor(() => expect(read).toHaveBeenCalledWith('a1', 'x'))
  })

  it('CRITICAL: "Mark unread" is offered, because auto-read destroys the triage signal', async () => {
    // Without the undo, glancing at a message permanently loses the manager's own record
    // of what they still have to deal with.
    await act(async () => {
      render(<Inbox rows={[row({ id: 'x' })]} />)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark unread' }))
    })
    expect(unread).toHaveBeenCalledWith('a1', 'x')
  })

  it('does not re-mark a message that is already read', async () => {
    await act(async () => {
      render(<Inbox rows={[row({ read_at: '2026-08-04T11:00:00Z' })]} />)
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('switching messages shows the other one', async () => {
    const rows = [row({ id: 'a', name: 'First' }), row({ id: 'b', name: 'Second' })]
    await act(async () => {
      render(<Inbox rows={rows} />)
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Second'))
    })
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Second')
  })
})

describe('Inbox — the list', () => {
  it('CRITICAL: shows a one-line snippet, not the whole message', async () => {
    // The failure this replaced: every message rendered in full, so the list could not be
    // scanned at all.
    const long = row({ message: 'x'.repeat(500) })
    await act(async () => {
      render(<Inbox rows={[long]} />)
    })
    const listRow = rowButtons()[0]
    expect(within(listRow).getByText(/…$/)).toBeInTheDocument()
    expect(listRow.textContent!.length).toBeLessThan(200)
  })

  it('marks unread rows for a screen reader too, not just in bold', async () => {
    await act(async () => {
      render(<Inbox rows={[row({ id: 'u' }), row({ id: 'r', read_at: '2026-08-04T11:00:00Z' })]} />)
    })
    // The one we opened becomes read, so exactly one stays unread.
    await waitFor(() => expect(screen.getAllByText('read')).toHaveLength(2))
  })

  it('filters to unread', async () => {
    const rows = [
      row({ id: 'a', name: 'Unread One' }),
      row({ id: 'b', name: 'Read One', read_at: '2026-08-04T11:00:00Z' }),
    ]
    await act(async () => {
      render(<Inbox rows={rows} />)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'unread' }))
    })
    // 'Unread One' was auto-opened and is now read, so the unread filter empties.
    expect(screen.getByText('Nothing unread.')).toBeInTheDocument()
  })

  it('shows an empty state with no enquiries at all', async () => {
    await act(async () => {
      render(<Inbox rows={[]} />)
    })
    expect(screen.getByText(/No enquiries yet/)).toBeInTheDocument()
  })
})

describe('Inbox — attachments', () => {
  it('CRITICAL: signs on OPEN, and only for the message opened', async () => {
    // Signing on page load meant a round trip per attachment for URLs that mostly expired
    // unread, while the one you wanted had been counting down since render.
    const rows = [row({ id: 'a', attachmentCount: 2 }), row({ id: 'b', attachmentCount: 1 })]
    await act(async () => {
      render(<Inbox rows={rows} />)
    })
    await waitFor(() => expect(sign).toHaveBeenCalledTimes(1))
    expect(sign).toHaveBeenCalledWith('a')
  })

  it('does not sign for a message with no attachments', async () => {
    await act(async () => {
      render(<Inbox rows={[row({ attachmentCount: 0 })]} />)
    })
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument())
    expect(sign).not.toHaveBeenCalled()
  })

  it('CRITICAL: says an attachment EXPIRED rather than showing nothing', async () => {
    // The bug skeen found: the sweep used to delete the row, so an expired file left no
    // trace and the manager could not tell it from an enquiry that never had audio.
    sign.mockResolvedValue([
      { id: 'f1', filename: 'demo.mp3', mime_type: 'audio/mpeg', bytes: null, url: null, expired: true, neverUploaded: false },
    ])
    await act(async () => {
      render(<Inbox rows={[row({ attachmentCount: 1 })]} />)
    })
    expect(await screen.findByText(/Attachment expired/)).toBeInTheDocument()
    expect(screen.getByText('demo.mp3')).toBeInTheDocument()
  })

  it('CRITICAL: distinguishes "never uploaded" from "expired"', async () => {
    sign.mockResolvedValue([
      { id: 'f1', filename: 'demo.mp3', mime_type: 'audio/mpeg', bytes: null, url: null, expired: false, neverUploaded: true },
    ])
    await act(async () => {
      render(<Inbox rows={[row({ attachmentCount: 1 })]} />)
    })
    expect(await screen.findByText(/Upload didn’t complete/)).toBeInTheDocument()
  })

  it('renders a player and a download for a live file', async () => {
    sign.mockResolvedValue([
      { id: 'f1', filename: 'demo.mp3', mime_type: 'audio/mpeg', bytes: 4210233, url: 'https://s/x', expired: false, neverUploaded: false },
    ])
    await act(async () => {
      render(<Inbox rows={[row({ attachmentCount: 1 })]} />)
    })
    expect(await screen.findByText('4.0 MB')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', 'https://s/x')
  })

  it('CRITICAL: a javascript: demo link is never rendered as a link', async () => {
    await act(async () => {
      render(<Inbox rows={[row({ demo_url: 'javascript:alert(1)' })]} />)
    })
    expect(screen.queryByText(/javascript:/)).toBeNull()
  })

  it('renders an https demo link with noopener', async () => {
    await act(async () => {
      render(<Inbox rows={[row({ demo_url: 'https://soundcloud.com/x' })]} />)
    })
    const link = screen.getByRole('link', { name: 'https://soundcloud.com/x' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
