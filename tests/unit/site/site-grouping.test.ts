// The two helpers behind the On-site / Off-site toggle and the group-by-origin layout.
/**
 * The two pure helpers behind the content pages' On-site/Off-site toggle + group-by-
 * origin layout. Pure functions, so the filtering/bucketing rules are unit-testable
 * without mounting a browser.
 */
import { describe, expect, it } from 'vitest'
import { filterBySite, siteEmptyTitle } from '@/app/artists/[id]/(dashboard)/on-site-filter'
import { groupByOrigin } from '@/app/artists/[id]/(dashboard)/origin'

const item = (id: string, on_site: boolean, source: string) => ({ id, on_site, source })

describe('filterBySite', () => {
  const items = [item('a', true, 'x'), item('b', false, 'y'), item('c', true, 'z')]

  it('all → everything', () => {
    expect(filterBySite(items, 'all')).toHaveLength(3)
  })
  it('on → only live (on-site) items', () => {
    expect(filterBySite(items, 'on').map((i) => i.id)).toEqual(['a', 'c'])
  })
  it('off → only off-site (hidden) items', () => {
    expect(filterBySite(items, 'off').map((i) => i.id)).toEqual(['b'])
  })
  it('a null on_site counts as off-site, never vanishing from both tabs', () => {
    const withNull = [{ id: 'n', on_site: null as unknown as boolean, source: 'x' }]
    expect(filterBySite(withNull, 'off')).toHaveLength(1)
    expect(filterBySite(withNull, 'on')).toHaveLength(0)
  })
})

describe('siteEmptyTitle', () => {
  it('shares the off/on copy and defers only the all-title to the caller', () => {
    expect(siteEmptyTitle('off', 'No videos yet')).toBe('Nothing off-site')
    expect(siteEmptyTitle('on', 'No videos yet')).toBe('Nothing on the site yet')
    expect(siteEmptyTitle('all', 'No videos yet')).toBe('No videos yet')
  })
})

describe('groupByOrigin', () => {
  const items = [
    item('a', true, 'manual'),
    item('b', true, 'spotify'),
    item('c', true, 'spotify'),
    item('d', true, 'weird'),
  ]
  const label = (k: string) => k.toUpperCase()
  const groups = groupByOrigin(items, (i) => i.source, ['spotify', 'apple', 'manual'], label)

  it('orders known origins by `order`, appends unknown ones, drops empty', () => {
    // spotify (present) → manual (present) → weird (unknown, appended). apple: empty, dropped.
    expect(groups.map((g) => g.key)).toEqual(['spotify', 'manual', 'weird'])
  })
  it('buckets items under their origin and labels each group', () => {
    const spotify = groups.find((g) => g.key === 'spotify')!
    expect(spotify.items.map((i) => i.id)).toEqual(['b', 'c'])
    expect(spotify.label).toBe('SPOTIFY')
  })
})
