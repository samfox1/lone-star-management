// @vitest-environment jsdom
// THE TEMPLATE'S REPORTER. The bridge's rules are pinned in the site-bridge-*.test.ts
// suites; what only this component decides:
//   • a view is LANDING (Sam, 2026-09-17): `landing()` once on mount, and NOTHING when the
//     router moves. Switching pages is not a view.
//   • it runs NO PostHog mirror. This one app serves every artist at /[slug], and PostHog,
//     once started, keeps capturing with the FIRST artist's slug frozen in. The accuracy
//     cross-check runs on a single-artist site (skeen).
//   • unmount removes the click listener, because a leaked capture-phase listener counts
//     every later click twice.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const bridge = vi.hoisted(() => ({
  pathname: '/skeen',
  configs: [] as unknown[],
  deps: [] as unknown[],
  landing: vi.fn(),
  pageview: vi.fn(),
  unlisten: vi.fn(),
  createMirror: vi.fn(),
}))

vi.mock('next/navigation', () => ({ usePathname: () => bridge.pathname }))
vi.mock('@samfox1/site-bridge/mirror', () => ({ createMirror: bridge.createMirror }))
vi.mock('@samfox1/site-bridge/analytics', () => ({
  createAnalytics: (config: unknown, deps: unknown) => {
    bridge.configs.push(config)
    bridge.deps.push(deps)
    return {
      pageview: bridge.pageview,
      landing: bridge.landing,
      track: vi.fn(),
      attrs: vi.fn(),
      listen: () => bridge.unlisten,
    }
  },
}))

import { SiteAnalytics } from '@/components/site-analytics'

beforeEach(() => {
  bridge.pathname = '/skeen'
  bridge.configs.length = 0
  bridge.deps.length = 0
  for (const fn of [bridge.landing, bridge.pageview, bridge.unlisten, bridge.createMirror]) fn.mockReset()
  vi.unstubAllEnvs()
})

describe('SiteAnalytics', () => {
  it('CRITICAL: reports a landing once on mount, never a bare pageview', () => {
    render(<SiteAnalytics slug="skeen" />)
    expect(bridge.landing).toHaveBeenCalledTimes(1)
    expect(bridge.pageview).not.toHaveBeenCalled()
  })

  it('CRITICAL: switching pages is NOT another view', () => {
    const { rerender } = render(<SiteAnalytics slug="skeen" />)
    bridge.pathname = '/skeen/r/abc'
    rerender(<SiteAnalytics slug="skeen" />)
    expect(bridge.landing).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: unmount removes the click listener', () => {
    const { unmount } = render(<SiteAnalytics slug="skeen" />)
    unmount()
    expect(bridge.unlisten).toHaveBeenCalledTimes(1)
  })

  it('CRITICAL: runs no PostHog mirror, even with a key in the environment', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_live')
    render(<SiteAnalytics slug="skeen" />)
    expect(bridge.createMirror).not.toHaveBeenCalled()
    expect((bridge.deps[0] as { mirror?: unknown } | undefined)?.mirror).toBeUndefined()
  })

  it('passes the deploy environment, so preview deploys report nothing', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    render(<SiteAnalytics slug="skeen" />)
    expect((bridge.configs[0] as { environment?: string }).environment).toBe('preview')
  })
})
