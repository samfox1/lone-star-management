// @vitest-environment jsdom
/**
 * The cross-artist enquiries overview at /artists.
 *
 * `sortByAttention` is tested on its own; this pins what the PAGE does with it — the
 * parts a unit test on the rule cannot see:
 *
 *  - every artist appears, including ones with no enquiries at all (they have no row in
 *    the counts view, and that absence means zero, not missing);
 *  - each row links to that artist's own inbox, which is the entire point of the screen;
 *  - the rendered ORDER is the triage order, not the order the database returned.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import ArtistsEnquiriesPage from '@/app/artists/page'
import { ownedArtists } from '@/app/roster-data'

vi.mock('@/app/roster-data', () => ({ ownedArtists: vi.fn() }))
vi.mock('@/app/roster-chrome', () => ({
  RosterShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionToolbar: ({ title }: { title: string }) => <h1>{title}</h1>,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))

let countRows: unknown[] = []
let countError: { code: string } | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { email: 'm@example.com' } } }) },
    from: () => ({ select: async () => ({ data: countRows, error: countError }) }),
  }),
}))

const mockedArtists = vi.mocked(ownedArtists)

beforeEach(() => {
  countRows = []
  countError = null
  mockedArtists.mockResolvedValue([])
})
afterEach(cleanup)

const renderPage = async () => render(await ArtistsEnquiriesPage())
const rowNames = () =>
  screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)

describe('/artists — the enquiries overview', () => {
  it('CRITICAL: each row links to that artist’s own inbox', async () => {
    mockedArtists.mockResolvedValue([{ id: 'a1', name: 'Lone Pine', slug: 'lone-pine' }] as never)
    countRows = [{ artist_id: 'a1', total: 3, unread: 2, latest_at: '2026-08-04T10:00:00Z' }]
    await renderPage()
    expect(screen.getByRole('link', { name: 'Lone Pine' })).toHaveAttribute(
      'href',
      '/artists/a1/enquiries',
    )
  })

  it('CRITICAL: an artist with NO enquiries still appears, showing zero', async () => {
    // They have no row in the counts view at all — the absence means zero. Dropping them
    // would hide an artist from the manager's own roster.
    mockedArtists.mockResolvedValue([{ id: 'quiet', name: 'Quiet One', slug: 'q' }] as never)
    countRows = []
    await renderPage()
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByRole('link', { name: 'Quiet One' })).toBeInTheDocument()
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('0')
  })

  it('CRITICAL: renders in triage order, not the order the database returned', async () => {
    mockedArtists.mockResolvedValue([
      { id: 'quiet', name: 'Quiet', slug: 'q' },
      { id: 'backlog', name: 'Backlog', slug: 'b' },
      { id: 'fresh', name: 'Fresh', slug: 'f' },
    ] as never)
    countRows = [
      { artist_id: 'backlog', total: 30, unread: 30, latest_at: '2026-06-01T09:00:00Z' },
      { artist_id: 'fresh', total: 2, unread: 1, latest_at: '2026-08-04T09:00:00Z' },
    ]
    await renderPage()
    expect(rowNames()).toEqual(['Fresh', 'Backlog', 'Quiet'])
  })

  it('totals the unread across the whole roster', async () => {
    mockedArtists.mockResolvedValue([
      { id: 'a', name: 'A', slug: 'a' },
      { id: 'b', name: 'B', slug: 'b' },
    ] as never)
    // Numbers chosen so the roster unread total (7) collides with no per-row cell.
    countRows = [
      { artist_id: 'a', total: 6, unread: 4, latest_at: '2026-08-04T09:00:00Z' },
      { artist_id: 'b', total: 5, unread: 3, latest_at: '2026-08-03T09:00:00Z' },
    ]
    await renderPage()
    expect(screen.getByText('7')).toBeInTheDocument() // 4 + 3 unread
    expect(screen.getByText(/11 enquiries in total/)).toBeInTheDocument()
  })

  it('shows an empty state when the manager has no artists', async () => {
    mockedArtists.mockResolvedValue([])
    await renderPage()
    expect(screen.getByText('No artists yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('degrades when the counts view has not been migrated yet', async () => {
    // The Book does the same. A roster with no numbers still beats a crashed page.
    mockedArtists.mockResolvedValue([{ id: 'a1', name: 'Lone Pine', slug: 'x' }] as never)
    countRows = []
    countError = { code: 'PGRST205' }
    await renderPage()
    expect(screen.getByRole('link', { name: 'Lone Pine' })).toBeInTheDocument()
  })

  it('CRITICAL: a real database error surfaces rather than rendering an empty roster', async () => {
    // "No enquiries" and "the query failed" must never look the same to a manager
    // deciding whether anyone needs replying to.
    mockedArtists.mockResolvedValue([{ id: 'a1', name: 'Lone Pine', slug: 'x' }] as never)
    countError = { code: '42501' } // insufficient privilege
    await expect(renderPage()).rejects.toBeTruthy()
  })
})
