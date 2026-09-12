// How an on-site event is declared, and how each metric card labels its number.
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
  // Re-exported from @samfox1/site-bridge/analytics since 2026-09-12, so the attributes an
  // emitter WRITES and the delegated listener that READS them cannot drift apart. The
  // names changed with the move: `data-target` → `data-label` (target is the database
  // column, not what the site is declaring) and `data-entity-type` → `data-entity-kind`
  // (matching the `kind` field it carries). Every emitter goes through this function, so
  // nothing hand-writes the old names. Full rules: tests/unit/analytics/site-bridge-analytics.test.ts.
  it('attributes an event to an entity, lifting its label to the top level', () => {
    expect(trackAttrs('buy_click', { entity: { kind: 'merch', id: 'm1', label: 'Tee' } })).toEqual({
      'data-track': 'buy_click',
      'data-label': 'Tee',
      'data-entity-id': 'm1',
      'data-entity-kind': 'merch',
    })
  })

  it('emits just the event, or the event and a label when there is no row to point at', () => {
    expect(trackAttrs('view')).toEqual({ 'data-track': 'view' })
    expect(trackAttrs('link_click', { label: 'booking' })).toEqual({ 'data-track': 'link_click', 'data-label': 'booking' })
  })

  it('omits the label when the entity has none', () => {
    expect(trackAttrs('play', { entity: { kind: 'track', id: 't1' } })).toEqual({
      'data-track': 'play',
      'data-entity-id': 't1',
      'data-entity-kind': 'track',
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
