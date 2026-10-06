// @vitest-environment jsdom
// The press-kit download gate as the manager sees it: what is missing, and where to fix it.
/**
 * The download gate as the manager experiences it.
 *
 * `epkReadiness` decides; this pins what the page does with the decision. Two things
 * matter and neither is visible from a unit test on the rule:
 *
 *  1. An unmet requirement must say where it is fixed. Since Batch 3 (Sam, 2026-10-02, Brand's
 *     ledger, minimal text) its ✓ row is a LINK there (a missing photo → Profile), and its hint
 *     ("…, then publish") is read to a screen reader; the page's Publish bar says when a fix is
 *     still waiting to be published.
 *  2. When the gate is closed there must be NO usable download link. A disabled-looking
 *     button that is still an anchor is a link somebody will right-click and copy.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import EpkPage from '@/app/artists/[id]/(dashboard)/(manager-tools)/epk/page'
import { getPublishedSite } from '@/lib/site'
import { requireArtist } from '@/app/artists/[id]/(dashboard)/_data'

vi.mock('@/lib/site', () => ({ getPublishedSite: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({ requireArtist: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/epk/press-kit-form', () => ({
  PressKitForm: () => <div data-testid="press-kit-form" />,
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/epk/document-upload', () => ({
  DocumentUpload: ({ label }: { label: string }) => <div>{label}</div>,
}))
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/site-pending', () => ({
  SitePendingBar: ({ artistId }: { artistId: string }) => <div data-testid="site-bar" data-artist={artistId} />,
}))

let releases: unknown[] = []
let pressRow: Record<string, unknown> = {}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: pressRow }) }) }),
    }),
    rpc: async () => ({ data: releases }),
  }),
}))

const mockedSite = vi.mocked(getPublishedSite)
const mockedArtist = vi.mocked(requireArtist)

/** A published site that satisfies every requirement. */
const fullSite = {
  artist: { id: 'a1', slug: 'lone-pine', name: 'Lone Pine', bio: 'A bio.', hero_image_url: null },
  links: [{ id: 'l1', label: 'Booking', url: 'mailto:b@example.com' }],
  media: [{ purpose: 'profile_photo', url: 'https://img/p.jpg' }],
  site_content: {},
} as never

const renderPage = async () => render(await EpkPage({ params: Promise.resolve({ id: 'a1' }) }))

afterEach(cleanup)

beforeEach(() => {
  mockedArtist.mockResolvedValue({ id: 'a1', slug: 'lone-pine', name: 'Lone Pine' } as never)
  pressRow = { press_pitch: null, press_quotes: [], tech_rider_path: null, stage_plot_path: null }
})

describe('EPK page — the gate', () => {
  it('CRITICAL: offers a real download link only when every requirement is met', async () => {
    mockedSite.mockResolvedValue(fullSite)
    releases = [{ title: 'First Light' }]
    await renderPage()

    const link = screen.getByRole('link', { name: 'Download' })
    expect(link).toHaveAttribute('href', '/artists/a1/epk/download')
  })

  it('CRITICAL: renders NO link at all when the gate is closed', async () => {
    // Not a disabled-looking anchor — a link somebody can right-click, copy and share.
    mockedSite.mockResolvedValue(fullSite)
    releases = []
    await renderPage()

    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled()
  })

  it('CRITICAL: a missing requirement links to where it is fixed, its reason read to a screen reader', async () => {
    mockedSite.mockResolvedValue(fullSite)
    releases = []
    await renderPage()
    const row = screen.getByRole('link', { name: /At least one release/ })
    expect(row).toHaveAttribute('href', '/artists/a1/music')
    expect(row).toHaveTextContent(/Publish a release on the Music page/)
  })

  it('a missing photo links to Profile (Sam\u2019s mock, 2026-10-02)', async () => {
    mockedSite.mockResolvedValue({ ...(fullSite as object), media: [] } as never)
    releases = [{ title: 'First Light' }]
    await renderPage()
    expect(screen.getByRole('link', { name: /A photo/ })).toHaveAttribute('href', '/artists/a1/profile')
    // Met requirements are not links: there is nothing to go and do.
    expect(screen.queryByRole('link', { name: /A bio/ })).toBeNull()
  })

  // The contact rule reads only a published mailto: link (or a template site's booking_email),
  // and the first one is typed in the editor's Links › Contact list. Settings once sat here and
  // could set neither, so the red row was a dead end (Sam, 2026-10-05: "the editor's Contact links").
  it('a missing contact email links to the editor, where a contact is added', async () => {
    mockedSite.mockResolvedValue({ ...(fullSite as object), links: [] } as never)
    releases = [{ title: 'First Light' }]
    await renderPage()
    const row = screen.getByRole('link', { name: /A contact email/ })
    expect(row).toHaveAttribute('href', '/artists/a1/editor')
    expect(row).toHaveTextContent(/editor.*then publish/)
  })

  it('does not show hints for requirements already met', async () => {
    mockedSite.mockResolvedValue(fullSite)
    releases = [{ title: 'First Light' }]
    await renderPage()
    expect(screen.queryByText(/Publish a release on the Music page/)).toBeNull()
  })

  it('CRITICAL: nothing published at all closes the gate on every requirement', async () => {
    mockedSite.mockResolvedValue(null)
    releases = [{ title: 'First Light' }]
    await renderPage()

    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull()
    // All four listed as outstanding, so the manager sees the whole job, not the first blocker.
    expect(screen.getAllByText(/still needed/)).toHaveLength(4)
  })

  it('always lists all four requirements, met or not', async () => {
    mockedSite.mockResolvedValue(fullSite)
    releases = [{ title: 'First Light' }]
    await renderPage()
    expect(screen.getAllByText(/^, (done|still needed)/)).toHaveLength(4)
  })

  it('offers both document slots', async () => {
    mockedSite.mockResolvedValue(fullSite)
    releases = [{ title: 'First Light' }]
    await renderPage()
    expect(screen.getByText('Stage plot')).toBeInTheDocument()
    expect(screen.getByText('Tech rider')).toBeInTheDocument()
  })

  it('carries the site Publish bar for this artist: the pitch, quotes and documents reach the PDF only once published', async () => {
    mockedSite.mockResolvedValue(fullSite)
    releases = [{ title: 'First Light' }]
    await renderPage()
    expect(screen.getByTestId('site-bar')).toHaveAttribute('data-artist', 'a1')
  })
})
