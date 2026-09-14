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

  it('shows six, and the rest behind one control that names the count', () => {
    render(<SourceRings sources={EIGHT} />)
    const list = screen.getByRole('list', { name: 'Sources' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: /show all \(8\)/i }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(8)
  })

  it('has no expand control when six or fewer would fit anyway', () => {
    render(<SourceRings sources={EIGHT.slice(0, 6)} />)
    expect(screen.queryByRole('button', { name: /show all/i })).toBeNull()
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
    // The flip is CSS on hover/focus: the share starts hidden, the mark shown.
    expect(ring.querySelector('[data-share]')!.getAttribute('class')).toMatch(/\bopacity-0\b/)
    expect(ring.querySelector('[data-share]')!.getAttribute('class')).toMatch(/group-hover:opacity-100/)
    expect(ring.querySelector('[data-mark]')!.getAttribute('class')).toMatch(/group-hover:opacity-0/)
    expect(ring.getAttribute('tabindex')).toBe('0')
  })

  it('rounds the share to a whole percent, and a tiny source still shows one', () => {
    render(<SourceRings sources={[src('tiktok', 1, 0.004)]} />)
    expect(screen.getByRole('img', { name: /^tiktok:/i }).querySelector('[data-share]')!.textContent).toBe('0%')
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
