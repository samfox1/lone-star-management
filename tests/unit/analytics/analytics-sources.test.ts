// The search fold: which buckets and which stray hosts count as a search engine.
import { describe, expect, it } from 'vitest'
import { SEARCH_ENGINE_HOSTS, SEARCH_SOURCES, SOURCES, isSearchHost, ringsOf } from '@/lib/analytics-sources'

describe('the search fold', () => {
  it('CRITICAL: the search buckets are derived from the registry, never hand-listed', () => {
    expect([...SEARCH_SOURCES].sort()).toEqual(SOURCES.filter((s) => (s as { kind?: string }).kind === 'search').map((s) => s.key).sort())
    expect(SEARCH_SOURCES).toContain('google')
    expect(SEARCH_SOURCES).toContain('bing')
    expect(SEARCH_SOURCES).not.toContain('direct')
  })

  it('matches a search host on the host or any parent domain, case-insensitively', () => {
    for (const h of SEARCH_ENGINE_HOSTS) expect(isSearchHost(h), h).toBe(true)
    expect(isSearchHost('search.yahoo.com')).toBe(true)
    expect(isSearchHost('www.DuckDuckGo.com')).toBe(true)
    expect(isSearchHost('html.duckduckgo.com')).toBe(true)
  })

  it('does not fold a stranger, a look-alike, or a bare word', () => {
    expect(isSearchHost('weirdsite.net')).toBe(false)
    expect(isSearchHost('notduckduckgo.com')).toBe(false)
    expect(isSearchHost('brave.com')).toBe(false) // the browser's site, not its search
    expect(isSearchHost('com')).toBe(false)
    expect(isSearchHost('')).toBe(false)
  })

  it('CRITICAL: a portal is a search only at its search host — Yahoo News and AOL Mail are not searches', () => {
    expect(isSearchHost('search.yahoo.com')).toBe(true)
    expect(isSearchHost('news.yahoo.com')).toBe(false)
    expect(isSearchHost('finance.yahoo.com')).toBe(false)
    expect(isSearchHost('search.aol.com')).toBe(true)
    expect(isSearchHost('mail.aol.com')).toBe(false)
  })
})

describe('ringsOf', () => {
  const src = (source: string, visitors: number, hosts: { host: string; visitors: number }[] = []) =>
    ({ source, label: source, visitors, hosts })
  const names = (rings: ReturnType<typeof ringsOf>) => rings.map((r) => `${r.key}:${r.visitors}`)

  it('CRITICAL: every search engine is one Web search ring, the markless are one Other ring, and every share is of everyone', () => {
    const rings = ringsOf([
      src('instagram', 80), src('google', 20), src('bing', 4),
      src('other', 13, [{ host: 'duckduckgo.com', visitors: 5 }, { host: 'search.yahoo.com', visitors: 3 }, { host: 'weirdsite.net', visitors: 5 }]),
      src('youtube', 30), src('direct', 53),
    ])
    // Search = 20 + 4 + 5 + 3 = 32; Other = 5; total 200. Ranked.
    expect(names(rings)).toEqual(['instagram:80', 'direct:53', 'search:32', 'youtube:30', 'other:5'])
    expect(rings.map((r) => r.share)).toEqual([0.4, 0.265, 0.16, 0.15, 0.025])
    expect(rings.find((r) => r.key === 'search')!.label).toBe('Web search')
    expect(rings.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1, 10)
  })

  it('draws no fold ring for nothing: no search, no strangers → exactly the input, and no zero rings', () => {
    expect(names(ringsOf([src('instagram', 60), src('youtube', 40)]))).toEqual(['instagram:60', 'youtube:40'])
    expect(names(ringsOf([src('other', 0, [])]))).toEqual([])
  })

  it('hostless Other visitors (an unknown utm_source) still count as Other', () => {
    expect(names(ringsOf([src('other', 7, [])]))).toEqual(['other:7'])
    expect(names(ringsOf([src('other', 9, [{ host: 'duckduckgo.com', visitors: 4 }])]))).toEqual(['other:5', 'search:4'])
  })

  it('an empty window is no rings and no division by zero', () => {
    expect(ringsOf([])).toEqual([])
  })
})
