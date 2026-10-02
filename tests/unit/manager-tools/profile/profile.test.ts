/**
 * Profile's pure parts: the name's rule (one copy for the row and the action) and the nudge under
 * the Bio row.
 *
 * Code:     src/lib/manager-tools/profile/profile.ts
 * Feature:  Profile (PROFILE_TOOL_PLAN.md, 2026-10-02)
 * Tier:     STRICT for the name's rule (a validator); LIGHT for the nudge's words.
 * Covers:   • a blank or too-long name is refused; a padded one is fine
 *           • the nudge counts only the bios a Publish left out of date, and says nothing otherwise
 * Not here: the bios' states themselves (bio-state.test.ts).
 * Fixtures: BioRow objects built with only the field the nudge reads.
 */
import { describe, expect, it } from 'vitest'
import { ARTIST_NAME_MAX, artistNameError, outsideBiosNudge } from '@/lib/manager-tools/profile/profile'
import type { BioRow, BioState } from '@/lib/manager-tools/seo/profiles/bio-state'

const row = (state: BioState | null) => ({ state }) as BioRow

describe('the name', () => {
  // Something, and not too long; spaces around it don't count.
  it('CRITICAL: a blank or too-long name is refused; a padded one is fine', () => {
    expect(artistNameError('')).toBe('Give the artist a name.')
    expect(artistNameError('   ')).toBe('Give the artist a name.')
    expect(artistNameError('x'.repeat(ARTIST_NAME_MAX + 1))).toMatch(/too long/)
    expect(artistNameError(` ${'x'.repeat(ARTIST_NAME_MAX)} `)).toBeNull()
    expect(artistNameError('  Skeen ')).toBeNull()
  })
})

describe('the nudge', () => {
  // Only "may be out of date" counts; unread rows say nothing.
  it('counts only the stale bios, and says nothing when none or unread', () => {
    expect(outsideBiosNudge([row('stale'), row('current'), row('unconfirmed'), row('recheck'), row(null)])).toBe('1 outside bio may be out of date')
    expect(outsideBiosNudge([row('stale'), row('stale')])).toBe('2 outside bios may be out of date')
    expect(outsideBiosNudge([row('current')])).toBe('')
    expect(outsideBiosNudge(null)).toBe('')
  })
})
