// Naming one image slot inside a repeated component, like a wall of polaroids.
/**
 * Component slots (lib/site-editor/manifest) — the address of one image inside a
 * repeated component, e.g. skeen's polaroid wall.
 *
 * The site owns both the count and the slot names; lone-star only knows the SHAPE of a
 * role, which is what `media.site_role`'s CHECK enforces (20260724120000). These helpers
 * are the single place that shape is built, so the editor, the DB and skeen can't drift.
 */
import { describe, expect, it } from 'vitest'
import { componentSlotRole } from '@/lib/site-editor/manifest'

/** Mirrors the DB CHECK on media.site_role. */
const SITE_ROLE_RE = /^[a-z0-9_]{1,64}$/

describe('componentSlotRole', () => {
  it('builds the role skeen already declares as a field key', () => {
    // skeen's polaroidField(n, part) is `polaroid_${n}_${part}` — these must agree, or a
    // photo placed in the editor lands on a role skeen never reads.
    expect(componentSlotRole('polaroid', 1, 'photo')).toBe('polaroid_1_photo')
    expect(componentSlotRole('polaroid', 5, 'caption')).toBe('polaroid_5_caption')
  })

  it('produces a role the DB CHECK accepts, for every slot of a 5-card wall', () => {
    for (let n = 1; n <= 5; n++) {
      for (const slot of ['photo', 'caption']) {
        expect(componentSlotRole('polaroid', n, slot)).toMatch(SITE_ROLE_RE)
      }
    }
  })

  it('stays within the 64-char cap the CHECK enforces', () => {
    expect(componentSlotRole('a'.repeat(20), 99, 'b'.repeat(20)).length).toBeLessThanOrEqual(64)
  })
})

