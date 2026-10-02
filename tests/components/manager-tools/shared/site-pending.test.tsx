// @vitest-environment jsdom
/**
 * The site Publish bar comes up when something is waiting, and says what.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/_ui/site-pending.tsx (SitePendingBar)
 * Feature:  Profile, SEO / GEO and Connections (Batch 3, Sam 2026-10-02) · the rising Publish bar
 * Tier:     LIGHT (AGENTS.md "Test depth"): the main path only. What the bar publishes is
 *           STRICT, and lives in site-riser.test.tsx.
 * Covers:   • a waiting link edit (what Connections makes) raises the bar, saying so
 *           • nothing waiting: the bar stays down
 * Not here: what Publish ships, and in what order (site-riser.test.tsx); the diff itself
 *           (diffUnpublished, the publish suites).
 * Fixtures: the unpublished diff, the ownership gate, the Supabase client, the publish
 *           actions and the router are mocks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SitePendingBar } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_ui/site-pending'
import { diffUnpublished, type UnpublishedDiff } from '@/lib/content'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({})) }))
vi.mock('@/lib/content', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/content')>()), diffUnpublished: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/_data', () => ({ requireArtist: vi.fn(async () => ({ id: 'a1' })), dashboardDiff: vi.fn() }))
vi.mock('@/app/artists/[id]/(dashboard)/actions', () => ({
  publishSiteWithPasswordAction: vi.fn(async () => ({ ok: true })),
  publishEntityAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

type Part = Partial<{ added: number; edited: number; deleted: number; dirty: boolean }>
const s = (x: Part = {}) => ({ added: 0, edited: 0, deleted: 0, dirty: false, ...x })
const diff = (link: Part = {}) =>
  ({ profile: s(), site_content: s(), link: s(link), media: { ...s(), site: s(), brand: s() } }) as unknown as UnpublishedDiff

const bar = () => document.querySelector('[data-publish-riser]') as HTMLElement
const down = () => /(^|\s)invisible(\s|$)/.test(bar().className)

describe('the site Publish bar (SitePendingBar)', () => {
  // A link edited in a Connections pop-up is waiting: the bar must rise and name it, or the edit is stranded.
  it('a waiting link edit raises the bar, saying so', async () => {
    vi.mocked(diffUnpublished).mockResolvedValueOnce(diff({ edited: 1, dirty: true }))
    render(await SitePendingBar({ artistId: 'a1' }))
    expect(down()).toBe(false)
    expect(screen.getByText('1 link changed · not on the site yet')).toBeInTheDocument()
  })

  // Nothing waiting: the bar stays down, so it never offers a Publish of nothing.
  it('nothing waiting: the bar stays down', async () => {
    vi.mocked(diffUnpublished).mockResolvedValueOnce(diff())
    render(await SitePendingBar({ artistId: 'a1' }))
    expect(down()).toBe(true)
  })
})
