// @vitest-environment jsdom
// The source rings, and the two ways a ring can misstate a share.
/**
 * A ring is a share of EVERYONE, so its arc must be proportional to the share and
 * nothing else — not to the largest source, not to a shared max. The card under a
 * selected ring says only what a source carries in the data: visitors, views,
 * hosts, and the change on the previous window. It never shows a per-song or
 * per-click figure, because no tally exists that could supply one honestly.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SourceRings } from '@/components/ui/source-rings'
import { GLYPH_KEYS } from '@/components/ui/source-glyphs'
import { SOURCE_KEYS } from '@/lib/analytics-sources'
import type { SourceSummary } from '@/lib/analytics'

const src = (source: string, visitors: number, share: number, extra: Partial<SourceSummary> = {}): SourceSummary => ({
  source, label: source, visitors, views: visitors * 2, share, hosts: [], trend: null, ...extra,
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

  it('CRITICAL: selecting a ring opens a card with only what a source carries', () => {
    const ig = src('instagram', 212, 0.42, {
      label: 'Instagram', views: 471, trend: 0.34,
      hosts: [{ host: 'l.instagram.com', visitors: 180 }, { host: 'instagram.com', visitors: 32 }],
    })
    render(<SourceRings sources={[ig, src('youtube', 91, 0.18)]} />)
    fireEvent.click(screen.getByRole('button', { name: /^instagram:/i }))
    const card = screen.getByRole('region', { name: /instagram detail/i })
    const text = card.textContent!
    expect(text).toContain('212')
    expect(text).toContain('471')
    expect(text).toContain('l.instagram.com')
    expect(text).toContain('+34.0%')
    // Never invented: no plays, no ticket rate, no top song, no new-vs-returning.
    expect(text).not.toMatch(/play|ticket|song|returning/i)
  })

  it('says "no previous window" rather than a percent against nothing', () => {
    render(<SourceRings sources={[src('tiktok', 5, 1, { trend: null })]} />)
    fireEvent.click(screen.getByRole('button', { name: /^tiktok:/i }))
    expect(screen.getByRole('region').textContent).toMatch(/no previous window/i)
  })

  it('selecting the open ring again closes it', () => {
    render(<SourceRings sources={[src('direct', 9, 1)]} />)
    const btn = screen.getByRole('button', { name: /^direct:/i })
    fireEvent.click(btn)
    expect(screen.queryByRole('region')).not.toBeNull()
    fireEvent.click(btn)
    expect(screen.queryByRole('region')).toBeNull()
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
