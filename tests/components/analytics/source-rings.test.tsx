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

  it('CRITICAL: there is never an Other ring — the bucket unfolds into one ring per referrer host, at its rank', () => {
    const withOther = [
      src('instagram', 80, 0.4),
      src('other', 60, 0.3, { hosts: [{ host: 'search.brave.com', visitors: 50 }, { host: 'kagi.com', visitors: 10 }] }),
      src('youtube', 30, 0.15), src('google', 20, 0.1), src('tiktok', 6, 0.03), src('direct', 4, 0.02),
    ]
    render(<SourceRings sources={withOther} />)
    const list = screen.getByRole('list', { name: 'Sources' })
    const names = () => within(list).getAllByRole('img').map((r) => r.getAttribute('aria-label')!.split(':')[0])
    // Brave's 50 outrank YouTube's 30; kagi's 10 wait behind See all.
    expect(names()).toEqual(['instagram', 'search.brave.com', 'youtube', 'google', 'kagi.com'])
    expect(screen.queryByText(/^other$/i)).toBeNull()
    // A host ring's share is of everyone, like any ring: 50 of 200.
    expect(within(list).getByRole('img', { name: 'search.brave.com: 50 visitors, 25%' })).toBeTruthy()
    const seeAll = within(list).getByRole('button', { name: /\+2see all/i })
    expect(seeAll).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(seeAll)
    expect(names()).toEqual(['instagram', 'search.brave.com', 'youtube', 'google', 'kagi.com', 'tiktok', 'direct'])
    expect(screen.queryByText(/^other$/i)).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: /show fewer/i }))
    expect(within(list).getAllByRole('img')).toHaveLength(5)
  })

  it('a host ring is marked by its first letter, since no platform mark fits it', () => {
    render(<SourceRings sources={[src('other', 9, 1, { hosts: [{ host: 'search.brave.com', visitors: 9 }] })]} />)
    const ring = screen.getByRole('img', { name: /^search\.brave\.com:/ })
    expect(ring.querySelector('[data-mark]')!.textContent).toBe('s')
    expect(ring.querySelector('[data-mark] svg')).toBeNull()
  })

  it('counts every hidden source on the tile, named ones too', () => {
    render(<SourceRings sources={EIGHT} />)
    // Eight sources, none Other: five show, three wait.
    expect(screen.getByRole('button', { name: /\+3see all/i })).toBeTruthy()
  })

  it('has no tile when everything already fits — five or fewer, with no Other', () => {
    render(<SourceRings sources={EIGHT.slice(0, 5)} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getAllByRole('img')).toHaveLength(5)
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
