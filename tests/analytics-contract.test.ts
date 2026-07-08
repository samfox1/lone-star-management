/**
 * The analytics contract seams, now pure + unit-testable (they used to be verifiable
 * only by clicking on a live public page):
 *   - trackAttrs: the ONE way an emitter declares an on-site event → data-attributes.
 *   - metricValue / metricLabel: the ONE definition of each content type's 30-day stat.
 */
import { describe, expect, it } from 'vitest'
import { trackAttrs } from '@/lib/events'
import { metricValue, metricLabel, type EntityCounts } from '@/lib/analytics'

describe('trackAttrs (event emission seam)', () => {
  it('attributes an event to an entity with all four data-attributes', () => {
    expect(trackAttrs('buy_click', { entity: { kind: 'merch', id: 'm1', label: 'Tee' } })).toEqual({
      'data-track': 'buy_click',
      'data-target': 'Tee',
      'data-entity-id': 'm1',
      'data-entity-type': 'merch',
    })
  })

  it('emits just the event (+ optional label) when there is no entity', () => {
    expect(trackAttrs('view')).toEqual({ 'data-track': 'view' })
    expect(trackAttrs('link_click', { label: 'booking' })).toEqual({ 'data-track': 'link_click', 'data-target': 'booking' })
  })

  it('omits data-target when the entity has no label', () => {
    expect(trackAttrs('play', { entity: { kind: 'track', id: 't1' } })).toEqual({
      'data-track': 'play',
      'data-entity-id': 't1',
      'data-entity-type': 'track',
    })
  })
})

describe('metricValue / metricLabel (per-card metric registry)', () => {
  const counts: EntityCounts = new Map<string, Record<string, number>>([
    ['rel', { link_click: 3 }], // release smart-link DSP clicks
    ['trkA', { play: 5, link_click: 2 }],
    ['trkB', { play: 1 }],
    ['merch1', { buy_click: 4, view: 99 }],
  ])

  it('release = plays + DSP clicks summed over the release AND its tracks', () => {
    // rel(3) + trkA(5+2) + trkB(1) = 11
    expect(metricValue(counts, 'release', ['rel', 'trkA', 'trkB'])).toBe(11)
  })

  it('single-item types count only their own event, ignoring others', () => {
    expect(metricValue(counts, 'merch', ['merch1'])).toBe(4) // buy_click, not view
    expect(metricValue(counts, 'tour_date', ['nope'])).toBe(0)
  })

  it('exposes a stable label per kind', () => {
    expect(metricLabel('merch')).toBe('buy clicks')
    expect(metricLabel('release')).toBe('listens')
    expect(metricLabel('video')).toBe('clicks from your site')
  })
})
