// @vitest-environment jsdom
// The source rings, and the two ways a ring can misstate a share.
/**
 * A ring is a share of EVERYONE, so its arc must be proportional to the share and
 * nothing else — not to the largest source, not to a shared max. The share is
 * printed inside the ring on hover, never under it, and there is no detail card
 * (Sam, 2026-09-13).
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SourceRings } from '@/components/ui/source-rings'
import { GLYPH_KEYS } from '@/components/ui/source-glyphs'
import { SOURCE_KEYS } from '@/lib/analytics-sources'
import type { SourceSummary } from '@/lib/analytics'
import { noActionCounts } from '@/lib/source-story'

const src = (source: string, visitors: number, share: number, extra: Partial<SourceSummary> = {}): SourceSummary => ({
  source, label: source, visitors, views: visitors * 2, share, hosts: [], trend: null,
  actions: noActionCounts(), story: `Visitors from ${source} look and leave.`, ...extra,
})

const EIGHT = ['instagram', 'youtube', 'direct', 'google', 'tiktok', 'ai', 'facebook', 'x']
  .map((k, i) => src(k, 80 - i * 10, (80 - i * 10) / 380))

const arcLen = (el: Element) => Number(el.getAttribute('stroke-dasharray')!.split(' ')[0])
const C = 2 * Math.PI * 42

describe('SourceRings', () => {
  it('CRITICAL: the arc is the share of ALL visitors, not of the largest source', () => {
    const { container } = render(<SourceRings sources={[src('instagram', 60, 0.6), src('youtube', 40, 0.4)]} />)
    const arcs = [...container.querySelectorAll('[data-arc]')]
    expect(arcLen(arcs[0])).toBeCloseTo(0.6 * C, 1)
    // Normalised to the largest, YouTube would draw a full ring. It must not.
    expect(arcLen(arcs[1])).toBeCloseTo(0.4 * C, 1)
    expect(arcLen(arcs[1])).toBeLessThan(C)
  })

  it('CRITICAL: every search engine is ONE Search ring, and everything else without a mark is ONE Other ring', () => {
    const mixed = [
      src('instagram', 80, 0.4),
      src('google', 20, 0.1), src('bing', 4, 0.02),
      // The catch-all holds two search engines the door did not know, and one true stranger.
      src('other', 13, 0.065, { hosts: [{ host: 'duckduckgo.com', visitors: 5 }, { host: 'search.yahoo.com', visitors: 3 }, { host: 'weirdsite.net', visitors: 5 }] }),
      src('youtube', 30, 0.15), src('direct', 53, 0.265),
    ]
    render(<SourceRings sources={mixed} />)
    const list = screen.getByRole('list', { name: 'Sources' })
    const names = () => within(list).getAllByRole('img').map((r) => r.getAttribute('aria-label')!.split(':')[0])
    // Search = 20 + 4 + 5 + 3 = 32 of 200; Other = 5 of 200 (2.5%, printed 3%). Direct keeps its own ring.
    expect(names()).toEqual(['instagram', 'direct', 'Web search', 'youtube', 'Other'])
    expect(within(list).getByRole('img', { name: 'Web search: 32 visitors, 16%' })).toBeTruthy()
    expect(within(list).getByRole('img', { name: 'Other: 5 visitors, 3%' })).toBeTruthy()
    for (const gone of [/^google$/i, /^bing$/i, /duckduckgo/, /yahoo/, /weirdsite/]) expect(screen.queryByText(gone)).toBeNull()
    // Five rings, nothing hidden, no tile.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('the Web search ring wears a magnifying glass, not the Other mark', () => {
    render(<SourceRings sources={[src('google', 9, 1)]} />)
    const ring = screen.getByRole('img', { name: /^Web search:/ })
    expect(ring.querySelector('[data-mark] circle')).not.toBeNull()
    expect(ring.querySelector('[data-mark] svg')!.innerHTML).not.toBe(
      render(<SourceRings sources={[src('other', 9, 1, { hosts: [{ host: 'weirdsite.net', visitors: 9 }] })]} />)
        .container.querySelector('[data-mark] svg')!.innerHTML,
    )
  })

  it('other rows with no host at all still count as Other', () => {
    render(<SourceRings sources={[src('other', 7, 1, { hosts: [] })]} />)
    expect(screen.getByRole('img', { name: 'Other: 7 visitors, 100%' })).toBeTruthy()
  })

  it('CRITICAL: eight rings fit with no tile; a ninth turns the eighth slot into See all with everything past seven behind it', () => {
    const nine = [...EIGHT, src('spotify', 1, 0.01)]
    const eight = render(<SourceRings sources={EIGHT} />)
    expect(within(eight.getByRole('list', { name: 'Sources' })).getAllByRole('img')).toHaveLength(8)
    expect(eight.queryByRole('button')).toBeNull()
    eight.unmount()
    render(<SourceRings sources={nine} />)
    const list = screen.getByRole('list', { name: 'Sources' })
    expect(within(list).getAllByRole('img')).toHaveLength(7)
    fireEvent.click(within(list).getByRole('button', { name: /\+2see all/i }))
    expect(within(list).getAllByRole('img')).toHaveLength(9)
    expect(within(list).getByRole('button', { name: /show fewer/i })).toBeTruthy()
  })

  it('CRITICAL: the share lives IN the ring — the centre holds the mark and the number it flips to, and nothing is printed under the name', () => {
    const ig = src('instagram', 212, 0.42, { label: 'Instagram', views: 471 })
    const { container } = render(<SourceRings sources={[ig, src('youtube', 91, 0.18)]} />)
    const ring = screen.getByRole('img', { name: 'Instagram: 212 visitors, 42%' })
    expect(ring.querySelector('[data-mark]')).not.toBeNull()
    expect(ring.querySelector('[data-share]')!.textContent).toBe('42%')
    // The old "212 · 42%" line under the name, and the old detail card, are gone.
    expect(ring.textContent).not.toMatch(/212|471/)
    expect(container.querySelector('section')).toBeNull()
    expect(screen.queryByText(/visitors from/i)).toBeNull()
    // The flip is a 3D turn on hover/focus: one coin, two faces, the share face
    // pre-turned so it reads correctly once the coin is over.
    const coin = ring.querySelector('[data-coin]')!
    expect(coin.className).toMatch(/\btransform-3d\b/)
    expect(coin.className).toMatch(/group-hover:rotate-y-180/)
    expect(coin.className).toMatch(/group-focus-visible:rotate-y-180/)
    for (const face of ['[data-mark]', '[data-share]']) expect(coin.querySelector(face)!.className).toMatch(/\bbackface-hidden\b/)
    expect(coin.querySelector('[data-share]')!.className).toMatch(/\brotate-y-180\b/)
    expect(coin.querySelector('[data-mark]')!.className).not.toMatch(/\brotate-y-180\b/)
    expect(ring.getAttribute('tabindex')).toBe('0')
  })

  it('rounds the share to a whole percent, a tiny source still shows one, and one visitor is singular', () => {
    render(<SourceRings sources={[src('tiktok', 1, 0.004)]} />)
    expect(screen.getByRole('img', { name: 'tiktok: 1 visitor, 0%' }).querySelector('[data-share]')!.textContent).toBe('0%')
  })

  it('says what is missing rather than drawing an empty row', () => {
    render(<SourceRings sources={[]} empty="No visits yet." />)
    expect(screen.getByText('No visits yet.')).toBeTruthy()
  })
})

describe('the glyph registry', () => {
  it('CRITICAL: every source bucket has a mark — derived from SOURCES, never hand-listed', () => {
    expect([...GLYPH_KEYS].sort()).toEqual([...SOURCE_KEYS].sort())
  })
})
