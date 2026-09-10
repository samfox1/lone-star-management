/**
 * ITEMS JOINED THE DELTA MODEL — deliberately (Sam, 2026-08-18): an item's base lives
 * in SITE code, so a raw stored string freezes whatever the card looked like on the
 * day of the edit, and connected sites redeploy on their own schedules. The item
 * editor works in plain changed tokens; the sentinel is worn only in storage, and only
 * for sites whose splitter re-wears it (0.25.4's window/inner fix).
 */
import { describe, expect, it } from 'vitest'
import { fromItemStored, toItemStored, withStyleVars } from '@/lib/site-editor/style-controls'

describe('toItemStored / fromItemStored', () => {
  const NEW_SITE = withStyleVars({}, '0.25.4')
  const OLD_SITE = withStyleVars({}, '0.25.3')

  it('CRITICAL: a 0.25.4 site stores the sentinel; readback strips it (round-trip)', () => {
    const stored = toItemStored(NEW_SITE, 'opacity-50 rounded-[24px]')
    expect(stored).toBe('lse-delta opacity-50 rounded-[24px]')
    expect(fromItemStored(stored)).toBe('opacity-50 rounded-[24px]')
  })

  it('CRITICAL: a PRE-0.25.4 site keeps raw strings — its splitter would break the window half', () => {
    expect(toItemStored(OLD_SITE, 'opacity-50 rounded-[24px]')).toBe('opacity-50 rounded-[24px]')
  })

  it('clearing every token stores the empty string (row deleted), never a bare sentinel', () => {
    expect(toItemStored(NEW_SITE, '')).toBe('')
    expect(toItemStored(NEW_SITE, '   ')).toBe('')
  })

  it('a legacy raw row reads back unchanged', () => {
    expect(fromItemStored('opacity-50')).toBe('opacity-50')
  })
})
