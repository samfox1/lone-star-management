// @vitest-environment jsdom
// The press-kit download gate as the manager sees it: what is missing, and how to fix it.
/**
 * The download gate as the manager experiences it.
 *
 * `epkReadiness` decides; this pins what the page does with the decision. Two things
 * matter and neither is visible from a unit test on the rule:
 *
 *  1. An unmet requirement must show its HINT. The checklist is the only place a manager
 *     learns why the button is off, and "you have not published it yet" is the usual
 *     answer — invisible otherwise, since the dashboard shows them their draft.
 *  2. When the gate is closed there must be NO usable download link. A disabled-looking
 *     button that is still an anchor is a link somebody will right-click and copy.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import EpkPage from '@/app/artists/[id]/(dashboard)/epk/page'
import { getPublishedSite } from '@/lib/site'
import { requireArtist } from '@/app/artists/[id]/(dashboard)/_data'

vi.mock('@/lib/site', () => ({ getPublishedSite: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({ requireArtist: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/epk/press-kit-form', () => ({
  PressKitForm: () => <div data-testid="press-kit-form" />,
}))
vi.mock('@/app/artists/[id]/(dashboard)/epk/document-upload', () => ({
  DocumentUpload: ({ label }: { label: string }) => <div>{label}</div>,
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

    const link = screen.getByRole('link', { name: 'Download press kit' })
    expect(link).toHaveAttribute('href', '/artists/a1/epk/download')
  })

  it('CRITICAL: renders NO link at all when the gate is closed', async () => {
    // Not a disabled-looking anchor — a link somebody can right-click, copy and share.
    mockedSite.mockResolvedValue(fullSite)
    releases = []
    await renderPage()

    expect(screen.queryByRole('link', { name: 'Download press kit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download press kit' })).toBeDisabled()
  })

  it('CRITICAL: shows the hint for anything missing — the only place the reason appears', async () => {
    mockedSite.mockResolvedValue(fullSite)
    releases = []
    await renderPage()
    expect(screen.getByText(/Publish a release on the Music page/)).toBeInTheDocument()
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

    expect(screen.queryByRole('link', { name: 'Download press kit' })).toBeNull()
    // All four listed as outstanding, so the manager sees the whole job, not the first blocker.
    expect(screen.getAllByText(/still needed/)).toHaveLength(4)
  })

  it('always lists all four requirements, met or not', async () => {
    mockedSite.mockResolvedValue(fullSite)
    releases = [{ title: 'First Light' }]
    await renderPage()
    expect(screen.getAllByText(/^(done|still needed)$/)).toHaveLength(4)
  })

  it('offers both document slots', async () => {
    mockedSite.mockResolvedValue(fullSite)
    releases = [{ title: 'First Light' }]
    await renderPage()
    expect(screen.getByText('Stage plot')).toBeInTheDocument()
    expect(screen.getByText('Tech rider')).toBeInTheDocument()
  })
})
