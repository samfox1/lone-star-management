// The search fold: which buckets and which stray hosts count as a search engine.
import { describe, expect, it } from 'vitest'
import { SEARCH_ENGINE_HOSTS, SEARCH_SOURCES, SOURCES, isSearchHost } from '@/lib/analytics-sources'

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
})
