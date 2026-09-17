// @vitest-environment jsdom
// WHAT A VIEW IS. Sam, 2026-09-17: "landing on the site should be the view. I don't think
// switching pages should add to the view total."
//
// So a view is ARRIVING: a page load whose referrer is not the site itself. Moving around
// inside the site, by a client-side link or a plain one that reloads the page, is not a
// view. A reload keeps the original referrer, so a fan who landed and reloads counts again,
// on both pipelines alike.
//
// History of this file, so nobody re-derives it: a first draft counted every path change
// (by patching `history`, which broke Next's router), then every path the router reported.
// Both answered a different question from the one Sam asked.
//
// PostHog is NOT told this rule. It captures a `$pageview` on every load by itself
// (`capture_pageview: true`), stamped with `$referring_domain` from the same browser
// referrer (read from the shipped array.js, 2026-09-17), and the comparison query drops
// the ones whose referring domain is the site's own host. The rule is applied twice, by two
// different programs, which is what keeps the two counts independent.
import { describe, expect, it, vi } from 'vitest'
import {
  createAnalytics,
  isInternalReferrer,
  type AnalyticsDeps,
  type LandingMemory,
} from '../../../packages/site-bridge/src/analytics'

function wired({
  href = 'https://www.skeenmusic.com/tour',
  referrer = 'https://l.instagram.com/',
  memory = new Set<string>() as LandingMemory,
  slug = 'skeen',
} = {}) {
  const fetchSpy = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(new Response(null, { status: 204 })),
  )
  const u = new URL(href)
  const loc = { href, pathname: u.pathname, hostname: u.hostname }
  const make = (s = slug) =>
    createAnalytics(
      { supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon', slug: s },
      { fetch: fetchSpy as unknown as typeof fetch, location: loc, referrer: () => referrer, landingMemory: memory } as AnalyticsDeps,
    )
  const views = () =>
    fetchSpy.mock.calls
      .map(([, init]) => JSON.parse(init.body as string) as { type: string; slug: string })
      .filter((b) => b.type === 'view')
  return { a: make(), make, views, fetchSpy }
}

describe('landing', () => {
  it('CRITICAL: arriving from another site is one view', () => {
    const { a, views } = wired()
    a.landing()
    expect(views()).toHaveLength(1)
  })

  it('CRITICAL: arriving with no referrer at all (typed, bookmarked, an app) is one view', () => {
    const { a, views } = wired({ referrer: '' })
    a.landing()
    expect(views()).toHaveLength(1)
  })

  it('CRITICAL: a page load that came from the site itself is NOT a view', () => {
    // A plain link inside the site (skeen's Hero "About") reloads the page. That is
    // switching pages, not landing.
    const { a, views } = wired({ href: 'https://www.skeenmusic.com/about', referrer: 'https://www.skeenmusic.com/' })
    a.landing()
    expect(views()).toHaveLength(0)
  })

  it('CRITICAL: www and the bare domain are the same site', () => {
    const { a, views } = wired({ href: 'https://skeenmusic.com/about', referrer: 'https://www.skeenmusic.com/' })
    a.landing()
    expect(views()).toHaveLength(0)
    const other = wired({ href: 'https://www.skeenmusic.com/about', referrer: 'https://skeenmusic.com/' })
    other.a.landing()
    expect(other.views()).toHaveLength(0)
  })

  it('CRITICAL: a different site that merely CONTAINS the host is still a landing', () => {
    // Suffix or substring matching would silence these.
    for (const referrer of ['https://notskeenmusic.com/', 'https://skeenmusic.com.evil.example/', 'https://blog.skeenmusic.co/']) {
      const { a, views } = wired({ referrer })
      a.landing()
      expect(views(), referrer).toHaveLength(1)
    }
  })

  it('CRITICAL: StrictMode, remounts and repeated calls count the landing ONCE per page load', () => {
    const { make, views } = wired()
    make().landing()
    make().landing()
    make().landing()
    expect(views()).toHaveLength(1)
  })

  it('CRITICAL: with no memory injected, reporters share the PAGE-wide one', () => {
    // Every real site takes this path; every other test injects a memory.
    const fetchSpy = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    const loc = { href: 'https://www.skeenmusic.com/', pathname: '/', hostname: 'www.skeenmusic.com' }
    const make = () =>
      createAnalytics(
        { supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon', slug: 'shared-default-slug' },
        { fetch: fetchSpy as unknown as typeof fetch, location: loc, referrer: () => '' },
      )
    make().landing()
    make().landing()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('one page load that shows two artists counts a landing for each', () => {
    // The lone-star template serves every artist from one app.
    const { make, views } = wired()
    make('skeen').landing()
    make('wren').landing()
    make('wren').landing()
    expect(views().map((v) => v.slug)).toEqual(['skeen', 'wren'])
  })

  it('an unreportable context reports nothing, and does not use up the landing', () => {
    // A preview deploy must not mark the page as landed, or nothing about it would change
    // the day its environment did; the memory only records what was actually sent.
    const fetchSpy = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    const memory = new Set<string>() as LandingMemory
    createAnalytics(
      { supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon', slug: 'skeen', environment: 'preview' },
      { fetch: fetchSpy as unknown as typeof fetch, location: { href: 'https://x.vercel.app/', pathname: '/', hostname: 'x.vercel.app' }, referrer: () => '', landingMemory: memory },
    ).landing()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(memory.size).toBe(0)
  })

  it('pageview() is still there for a site that wants no de-duplication', () => {
    const { a, views } = wired({ referrer: 'https://www.skeenmusic.com/' })
    a.pageview()
    a.pageview()
    expect(views()).toHaveLength(2)
  })

  it('an unconfigured site gets a landing that does nothing and does not throw', () => {
    expect(() => createAnalytics(null).landing()).not.toThrow()
  })
})

describe('isInternalReferrer', () => {
  it.each([
    ['https://www.skeenmusic.com/', 'www.skeenmusic.com', true],
    ['https://skeenmusic.com/x', 'www.skeenmusic.com', true],
    ['https://WWW.SkeenMusic.com/', 'skeenmusic.com', true],
    ['http://skeenmusic.com:8443/', 'skeenmusic.com', true],
    ['https://l.instagram.com/', 'skeenmusic.com', false],
    ['https://notskeenmusic.com/', 'skeenmusic.com', false],
    ['https://shop.skeenmusic.com/', 'skeenmusic.com', false],
    ['', 'skeenmusic.com', false],
    ['not a url', 'skeenmusic.com', false],
  ])('%s on %s → %s', (referrer, host, expected) => {
    expect(isInternalReferrer(referrer, host)).toBe(expected)
  })

  it('an empty host never matches, so a location without one cannot swallow every landing', () => {
    expect(isInternalReferrer('https://skeenmusic.com/', '')).toBe(false)
    // A referrer with no hostname of its own (a file, an extension page) would otherwise
    // "equal" an empty page host.
    expect(isInternalReferrer('file:///Users/fan/index.html', '')).toBe(false)
  })
})
