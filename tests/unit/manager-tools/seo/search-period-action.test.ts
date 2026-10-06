/**
 * The Metrics page's seen / clicked chart asks for its other period only when it is clicked, through
 * a server action: a public door, so it must check the caller owns the artist before the loader
 * reads the registrations with the service client and asks Google and Bing.
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/search/actions.ts
 * Feature:  SEO / GEO page · Metrics, the review fix (2026-10-06): the page waits for one period,
 *           not every period
 * Tier:     STRICT (AGENTS.md "Test depth"): permissions; a non-owner must never reach the
 *           service-client read or the engines.
 * Covers:   • an owner gets the period's answer from the loader
 *           • a non-owner is refused and the loader is never called
 *           • a period that isn't one of the offered ones is refused before anything is asked
 * Not here: what the loader does (search-stats-ask.test.ts); the chart (search-tab.test.tsx).
 * Fixtures: the supabase client and the loader stubbed; ownership by the RLS-scoped artists read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let visible = true
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: visible ? { id: 'a1' } : null }) }) }) }),
  })),
}))
const ANSWER = { period: { key: '3m' } }
vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/search/load', () => ({ loadSearchStats: vi.fn(async () => ANSWER) }))

const load = () => import('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/search/actions')
const loader = async () => vi.mocked((await import('@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/search/load')).loadSearchStats)

beforeEach(async () => {
  visible = true
  ;(await loader()).mockClear()
})

describe('searchPeriodAction', () => {
  // The owner clicks 3m on the chart: the loader is asked for that artist and period.
  it('an owner gets the period\'s answer', async () => {
    const { searchPeriodAction } = await load()
    expect(await searchPeriodAction('a1', '3m')).toEqual({ answer: ANSWER })
    expect(await loader()).toHaveBeenCalledWith('a1', '3m')
  })

  // A caller who can't see the artist is refused, and nothing is read or asked.
  it('CRITICAL: a non-owner is refused and the loader is never called', async () => {
    const { searchPeriodAction } = await load()
    visible = false
    expect(await searchPeriodAction('a1', '3m')).toEqual({ error: 'Artist not found.' })
    expect(await loader()).not.toHaveBeenCalled()
  })

  // Only the offered periods: anything else is refused before the ownership read or the engines.
  it('CRITICAL: a period that is not offered is refused before anything is asked', async () => {
    const { searchPeriodAction } = await load()
    for (const bad of ['1y', '__proto__', '', 'toString']) {
      expect(await searchPeriodAction('a1', bad)).toEqual({ error: 'Unknown period.' })
    }
    expect(await loader()).not.toHaveBeenCalled()
  })
})
