// The on-site write paths stay separate; a type on both would silently revert the editor.
/**
 * The ON-SITE registries stay DISJOINT and TOTAL (ADR 0009, amended by ADR 0010 /
 * PRESENCE_PLAN.md, 2026-09-10).
 *
 * Two registries now, and a type is in exactly one:
 *   LIVE_TOGGLE     — the working row's on_site IS the site (tour, merch, video, photo, link)
 *   DRAFT_PRESENCE  — the working row's on_site is a draft; the door reads the SNAPSHOT
 *                     (track, release)
 * The "selection reconciled at publish" path is gone. It used to serve releases and
 * merch, and it was the thing that silently reverted the editor's toggles at the next
 * publish — the failure ADR 0009 was written against, and which the editor's Music toggle
 * had reintroduced for songs inside releases.
 *
 * Every registry this file asserts over is derived from a TYPE or an exported const,
 * never hand-copied: a hand-written copy of a union goes stale in the widening direction
 * without failing anything.
 */
import { describe, expect, it } from 'vitest'
import { DRAFT_PRESENCE, LIVE_TOGGLE, PUBLISHABLE } from '@/lib/content'
import type { SlotTable } from '@/lib/site-editor/slots'

const liveEntities = Object.values(LIVE_TOGGLE)
const draftEntities = [...DRAFT_PRESENCE]

/** Every member of `SlotTable`, derived EXHAUSTIVELY from the type — a new member missing
 *  here is a COMPILE error. */
const SLOT_TABLE_SET: Record<SlotTable, true> = { media: true, videos: true }
const SLOT_TABLES = Object.keys(SLOT_TABLE_SET) as SlotTable[]

describe('on-site write paths', () => {
  it('CRITICAL: no entity is both live-toggled and draft-presence', () => {
    const both = liveEntities.filter((e) => (draftEntities as readonly string[]).includes(e))
    expect(both).toEqual([])
  })

  it('every live-toggle kind and every draft type maps to a real publishable entity', () => {
    for (const entity of [...liveEntities, ...draftEntities]) expect(PUBLISHABLE[entity]).toBeDefined()
  })

  it('CRITICAL: a DRAFT-PRESENCE type carries on_site IN ITS SNAPSHOT — or the door has nothing to read', () => {
    // The whole model: the public door reads presence from the published copy. A draft
    // type whose snapshot list lacks on_site would publish a song the door then gates on
    // the LIVE row — i.e. the old model, silently.
    for (const entity of draftEntities) {
      expect(PUBLISHABLE[entity].snapshot, `${entity}.snapshot lacks on_site`).toContain('on_site')
    }
  })

  it('every on-site type has an on_site column to gate on', async () => {
    const { serviceClient } = await import('@tests/helpers/supabase')
    const svc = serviceClient()
    const tables = [...liveEntities, ...draftEntities].map((e) => PUBLISHABLE[e].table)
    for (const table of [...new Set(tables)]) {
      const { error } = await svc.from(table).select('on_site').limit(1)
      expect(error, `${table}.on_site`).toBeNull()
    }
  })

  it('the two registries together cover every gated type', () => {
    const covered = new Set<string>([...liveEntities, ...draftEntities])
    for (const gated of ['media', 'track', 'link', 'video', 'tour_date', 'merch', 'release']) {
      expect(covered.has(gated), `${gated} is on neither on-site path`).toBe(true)
    }
  })

  it('CRITICAL: a SLOT can only place into a live-toggle table, never a draft one', () => {
    // A slot placement is an editor act with no publish step; a draft-presence table
    // behind a slot would be a placement fans never see.
    const liveTables = new Set(liveEntities.map((e) => PUBLISHABLE[e].table))
    const draftTables = draftEntities.map((e) => PUBLISHABLE[e].table)
    for (const t of SLOT_TABLES) {
      expect(liveTables.has(t), `slot table ${t} must be a live-toggle table`).toBe(true)
      expect(draftTables.includes(t), `slot table ${t} must NOT be a draft-presence table`).toBe(false)
    }
  })
})
