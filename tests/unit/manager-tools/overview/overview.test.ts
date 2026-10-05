/**
 * What the Overview's rows and Publish bar say: the bar's words, a tool row's count and dot.
 *
 * Code:     src/lib/manager-tools/overview/overview.ts
 * Feature:  Manager tools · Overview (prototypes/overview_20261002.html, Sam 2026-10-05)
 * Tier:     LIGHT for the words (the page is new). The sweep is the one strict line: the bar
 *           must rise for EVERY section that can wait, or a change sits unpublished unseen.
 * Covers:   • every diff key, alone dirty, gives the bar words (derived from PUBLISHABLE)
 *           • the words: DIFF_SECTIONS order, links counted, media said by its halves
 *           • a count that could not be read shows nothing, never 0
 *           • Profile wears the dot of what its own bar ships (siteUnpublished)
 * Not here: the rows on the page (tests/components/manager-tools/overview/).
 * Fixtures: a clean diff built from PUBLISHABLE's keys, with chosen sections dirty.
 */
import { describe, expect, it } from 'vitest'
import { PUBLISHABLE, type UnpublishedDiff } from '@/lib/content'
import { toolDot, toolValue, waitingMessage } from '@/lib/manager-tools/overview/overview'

const DIFF_KEYS = ['profile', ...Object.keys(PUBLISHABLE)] as (keyof UnpublishedDiff)[]
const s = (n = 0) => ({ added: 0, edited: n, deleted: 0, dirty: n > 0 })

/** A diff with `dirty` sections edited (n = 1 unless given). Media carries both halves. */
function diff(dirty: Partial<Record<keyof UnpublishedDiff | 'media.site' | 'media.brand', number>> = {}): UnpublishedDiff {
  const out = Object.fromEntries(DIFF_KEYS.map((k) => [k, s(dirty[k])])) as Record<string, unknown>
  const site = s(dirty['media.site'])
  const brand = s(dirty['media.brand'])
  out.media = { ...s((dirty['media.site'] ?? 0) + (dirty['media.brand'] ?? 0)), site, brand }
  return out as unknown as UnpublishedDiff
}

describe('waitingMessage (the Publish bar)', () => {
  it('every section that can wait raises the bar: each key alone gives words', () => {
    expect(DIFF_KEYS.length).toBeGreaterThan(9) // non-vacuous: the registry really is that big
    const silent = DIFF_KEYS.filter((k) => waitingMessage(k === 'media' ? diff({ 'media.site': 1 }) : diff({ [k]: 1 })) === '')
    expect(silent).toEqual([])
    expect(waitingMessage(diff())).toBe('')
  })

  it('names what waits in a few words: links counted, photos and logos apart', () => {
    expect(waitingMessage(diff({ link: 1 }))).toBe('1 link changed')
    expect(waitingMessage(diff({ profile: 1, site_content: 2, link: 3 }))).toBe('Profile, 3 links and site text changed')
    expect(waitingMessage(diff({ 'media.site': 1, 'media.brand': 1 }))).toBe('Photos and logos changed')
  })
})

describe('a tool row', () => {
  it('shows a count only where one was read', () => {
    expect(toolValue('connections', { connected: 2, subscribers: 11, unread: 3 })).toEqual({ text: '2 connected', strong: false })
    expect(toolValue('enquiries', { connected: 0, subscribers: 0, unread: 3 })).toEqual({ text: '3 unread', strong: true })
    expect(toolValue('subscribers', { connected: 0, subscribers: null, unread: null })).toBeNull()
    expect(toolValue('enquiries', { connected: 0, subscribers: null, unread: null })).toBeNull()
    expect(toolValue('epk', { connected: 0, subscribers: 1, unread: 1 })).toBeNull()
  })

  it("Profile's dot is what its own bar ships: profile, site text, the site's photos; not a logo", () => {
    const none = {}
    expect(toolDot('profile', diff({ site_content: 1 }), none)).toBe(true)
    expect(toolDot('profile', diff({ 'media.site': 1 }), none)).toBe(true)
    expect(toolDot('profile', diff({ 'media.brand': 1 }), none)).toBe(false)
    expect(toolDot('connections', diff(), { connections: true })).toBe(true)
  })
})
