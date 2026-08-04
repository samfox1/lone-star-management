// @vitest-environment jsdom
/**
 * The PUBLIC press kit page — the thing a promoter actually opens.
 *
 * Two rules are load-bearing here and neither is enforced anywhere else:
 *
 *  1. **A dangerous quote URL must not become a link.** `cleanPressQuotes` already
 *     strips one on the way in, but rows published before that guard existed sit in
 *     immutable revisions and can never be re-cleaned. Render-time `safeHref` is the
 *     only thing standing between an old revision and a stored-XSS sink on click.
 *  2. **An empty section renders NOTHING** — not an empty heading. skeen shipped
 *     placeholder content to production twice by breaking this rule, so it is pinned.
 *
 * The page is an async server component with no client hooks, so it is awaited to get
 * its JSX and that is handed to RTL. Supabase and the published-site read are mocked;
 * what is under test is the rendering, not the door (the door has its own tests).
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import EpkPage from '@/app/[slug]/epk/page'
import { parsePressQuotes } from '@/lib/epk'
import { getPublishedSite } from '@/lib/site'

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: async () => ({ data: [] }) }),
}))
vi.mock('@/lib/site', () => ({ getPublishedSite: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
// Real implementation by default; spied so ONE test can simulate the parse guard being
// bypassed and prove the render guard stands on its own (see the CRITICAL test below).
vi.mock('@/lib/epk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/epk')>()
  return { ...actual, parsePressQuotes: vi.fn(actual.parsePressQuotes) }
})

const mockedSite = vi.mocked(getPublishedSite)
const mockedParse = vi.mocked(parsePressQuotes)

/** A published site carrying only what the EPK reads. */
function site(artist: Record<string, unknown>) {
  return {
    artist: { id: 'a1', slug: 'lone-pine', name: 'Lone Pine', bio: null, hero_image_url: null, template: 'classic', spotify_artist_id: null, ...artist },
    tracks: [],
    tour_dates: [],
    merch: [],
    links: [],
    videos: [],
    media: [],
    site_content: {},
    styles: {},
  }
}

const renderPage = async () => render(await EpkPage({ params: Promise.resolve({ slug: 'lone-pine' }) }))

beforeEach(() => {
  mockedSite.mockReset()
  mockedParse.mockClear() // keeps the real implementation; drops any mockReturnValueOnce
})
afterEach(cleanup)

describe('public EPK page — press fields', () => {
  it('shows the pitch under the name', async () => {
    mockedSite.mockResolvedValue(site({ press_pitch: 'Austin four-piece.' }) as never)
    await renderPage()
    expect(screen.getByText('Austin four-piece.')).toBeInTheDocument()
  })

  it('shows each quote with its source', async () => {
    mockedSite.mockResolvedValue(
      site({ press_quotes: [{ quote: 'A blistering live act.', source: 'NME', url: null }] }) as never,
    )
    await renderPage()
    expect(screen.getByText(/A blistering live act\./)).toBeInTheDocument()
    expect(screen.getByText('NME')).toBeInTheDocument()
  })

  it('links the source when the quote has a safe URL', async () => {
    mockedSite.mockResolvedValue(
      site({ press_quotes: [{ quote: 'Great.', source: 'NME', url: 'https://nme.com/x' }] }) as never,
    )
    await renderPage()
    expect(screen.getByRole('link', { name: 'NME' })).toHaveAttribute('href', 'https://nme.com/x')
  })

  it('a javascript: URL in the stored row never becomes a link', async () => {
    // Belt: `parsePressQuotes` nulls it before the page ever sees it. This pins the
    // OUTCOME, and is deliberately not evidence about which layer did the work.
    mockedSite.mockResolvedValue(
      site({ press_quotes: [{ quote: 'Great.', source: 'NME', url: 'javascript:alert(1)' }] }) as never,
    )
    await renderPage()
    expect(screen.queryByRole('link', { name: 'NME' })).toBeNull()
    expect(screen.getByText('NME')).toBeInTheDocument()
  })

  it('CRITICAL: the render refuses a dangerous URL even if the parse guard lets one through', async () => {
    // Braces. `lib/url.ts` is explicit that render-time sanitization is the must-have
    // guard, because rows predating validation (or arriving by sync) can carry anything.
    // The test above CANNOT prove that: parse nulls the URL first, so stripping safeHref
    // out of the page leaves it green — a mutation check caught exactly that. Here the
    // parse layer is forced to pass the raw row through, so the only thing left between
    // an old revision and a stored-XSS sink on click is the page's own safeHref.
    mockedParse.mockReturnValueOnce([{ quote: 'Great.', source: 'NME', url: 'javascript:alert(1)' }])
    mockedSite.mockResolvedValue(site({ press_quotes: [] }) as never)
    await renderPage()
    expect(screen.queryByRole('link', { name: 'NME' })).toBeNull()
    expect(screen.getByText('NME')).toBeInTheDocument()
  })

  it('CRITICAL: no Press heading when there are no quotes', async () => {
    mockedSite.mockResolvedValue(site({ press_quotes: [] }) as never)
    await renderPage()
    expect(screen.queryByText('Press')).toBeNull()
  })

  it('renders nothing extra for a revision published before the press fields existed', async () => {
    mockedSite.mockResolvedValue(site({}) as never) // no press_pitch / press_quotes keys at all
    await renderPage()
    expect(screen.getByText('Lone Pine')).toBeInTheDocument()
    expect(screen.queryByText('Press')).toBeNull()
  })

  it('survives junk in press_quotes rather than 500ing the whole page', async () => {
    mockedSite.mockResolvedValue(site({ press_quotes: 'not an array' }) as never)
    await renderPage()
    expect(screen.getByText('Lone Pine')).toBeInTheDocument()
  })
})
