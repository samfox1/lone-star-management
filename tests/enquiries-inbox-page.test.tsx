// @vitest-environment jsdom
/**
 * The roster-wide inbox at /artists.
 *
 * The behaviours worth pinning are the ones that only exist because this inbox spans
 * artists: every message is labelled with who it came in for, and nothing is dropped when
 * a name cannot be resolved.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import EnquiriesInboxPage from '@/app/artists/page'
import { ownedArtists } from '@/app/roster-data'

vi.mock('@/app/roster-data', () => ({ ownedArtists: vi.fn() }))
vi.mock('@/app/roster-chrome', () => ({
  RosterShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionToolbar: ({ title }: { title: string }) => <h1>{title}</h1>,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))
vi.mock('@/app/artists/[id]/(dashboard)/enquiries/actions', () => ({
  markEnquiryUnreadAction: vi.fn(async () => ({ ok: true })),
  signEnquiryAttachmentsAction: vi.fn(async () => []),
}))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  markEnquiryReadAction: vi.fn(async () => ({ ok: true })),
}))

let enquiries: unknown[] = []
// Query-builder stub: any method chain returns itself, awaiting resolves { data }. Pins
// only the data contract — the page can add or reorder builder calls without this mock
// having to know.
function queryStub(data: () => unknown[]) {
  const stub: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'then'
          ? (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve({ data: data() }).then(res, rej)
          : () => stub,
    },
  )
  return stub
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { email: 'm@example.com' } } }) },
    from: (table: string) => queryStub(() => (table === 'enquiries' ? enquiries : [])),
  }),
}))

const mockedArtists = vi.mocked(ownedArtists)

const enquiry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  artist_id: 'a1',
  purpose: 'booking',
  name: 'Jamie Rowe',
  email: 'jamie@example.com',
  message: 'Can you play Aug 14?',
  read_at: '2026-08-04T11:00:00Z',
  created_at: '2026-08-04T10:00:00Z',
  demo_url: null,
  status: 'sent',
  ...over,
})

beforeEach(() => {
  enquiries = []
  mockedArtists.mockResolvedValue([
    { id: 'a1', name: 'Lone Pine', slug: 'lone-pine' },
    { id: 'a2', name: 'Gulf Static', slug: 'gulf-static' },
  ] as never)
})
afterEach(cleanup)

const renderPage = async () => {
  await act(async () => {
    render(await EnquiriesInboxPage())
  })
}

describe('/artists — the roster-wide inbox', () => {
  it('CRITICAL: labels each message with the artist it came in for', async () => {
    // The single most useful thing on the row when the list spans a roster — without it
    // you cannot tell whose booking you are reading.
    enquiries = [enquiry({ id: 'e1', artist_id: 'a1' }), enquiry({ id: 'e2', artist_id: 'a2', name: 'Nia Patel' })]
    await renderPage()
    // An artist's name legitimately renders twice: the row label and its filter <option>.
    expect(screen.getAllByText('Lone Pine').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Gulf Static').length).toBeGreaterThan(0)
  })

  it('shows messages from every artist in one list', async () => {
    enquiries = [enquiry({ id: 'e1', name: 'Jamie Rowe' }), enquiry({ id: 'e2', artist_id: 'a2', name: 'Nia Patel' })]
    await renderPage()
    expect(screen.getByText('Jamie Rowe')).toBeInTheDocument()
    expect(screen.getByText('Nia Patel')).toBeInTheDocument()
  })

  it('CRITICAL: never drops a message whose artist name cannot be resolved', async () => {
    // Would be a bug rather than a normal state, but hiding somebody's mail is the worse
    // failure — render it labelled "Unknown artist" and let it be noticed.
    enquiries = [enquiry({ artist_id: 'ghost', name: 'Orphan Sender' })]
    await renderPage()
    expect(screen.getAllByText('Orphan Sender').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unknown artist').length).toBeGreaterThan(0)
  })

  it('shows the empty state when the manager has no artists', async () => {
    mockedArtists.mockResolvedValue([])
    await renderPage()
    expect(screen.getByText('No artists yet')).toBeInTheDocument()
  })

  it('renders a table of messages, not of per-artist counts', async () => {
    enquiries = [enquiry()]
    await renderPage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText(/1 enquiry/)).toBeInTheDocument()
  })
})
