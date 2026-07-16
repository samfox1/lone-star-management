/**
 * The two ON-SITE write paths stay DISJOINT (ADR 0009).
 *
 * A type on both paths is a silent bug, not a loud one: `reconcileOnSite` sets
 * `on_site = false` for everything absent from the publish selection, so it reverts
 * the editor's live toggle at the next publish with no error anywhere — the item just
 * quietly leaves the site.
 *
 * This can't be a type error. The two registries are keyed in different vocabularies
 * on purpose (LIVE_TOGGLE by EDITOR kind — `photo`, `tour`; ON_SITE_ENTITIES by
 * ENTITY — `media`, `tour_date`), which is exactly why `video` and `merch` sat in the
 * live map with no caller for weeks without anyone noticing an overlap. Translating
 * through LIVE_TOGGLE is what makes the two comparable, so that translation is what
 * this asserts over.
 */
import { describe, expect, it } from 'vitest'
import { LIVE_TOGGLE, ON_SITE_ENTITIES, PUBLISHABLE } from '@/lib/content'

const liveEntities = Object.values(LIVE_TOGGLE)

describe('on-site write paths', () => {
  it('CRITICAL: no entity is on both the live-toggle and publish-reconcile paths', () => {
    const both = liveEntities.filter((e) => (ON_SITE_ENTITIES as readonly string[]).includes(e))
    expect(both).toEqual([])
  })

  it('every live-toggle kind maps to a real publishable entity', () => {
    // The kind→entity map is hand-written; its tables are then derived from
    // PUBLISHABLE, so a bad entity here would resolve to an undefined table.
    for (const entity of liveEntities) expect(PUBLISHABLE[entity]).toBeDefined()
  })

  it('every on-site type has an on_site column to gate on', async () => {
    // Both paths write `on_site`; a type in either registry whose table has no such
    // column would fail only at runtime, on a write nobody tests by hand.
    const { serviceClient } = await import('./helpers/supabase')
    const svc = serviceClient()
    const tables = [...liveEntities, ...ON_SITE_ENTITIES].map((e) => PUBLISHABLE[e].table)
    for (const table of [...new Set(tables)]) {
      const { error } = await svc.from(table).select('on_site').limit(1)
      expect(error, `${table}.on_site`).toBeNull()
    }
  })

  it('the editor kinds and the reconciled entities together cover every gated type', () => {
    // A gated type in NEITHER registry has no way to be put on the site at all — the
    // opposite failure to an overlap, and just as quiet.
    const covered = new Set<string>([...liveEntities, ...ON_SITE_ENTITIES])
    for (const gated of ['media', 'track', 'link', 'video', 'tour_date', 'merch', 'release']) {
      expect(covered.has(gated), `${gated} is on neither on-site write path`).toBe(true)
    }
  })
})
