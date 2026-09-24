// What the logo editor says after an upload, and which icons go when a logo is removed.
/**
 * logos/warnings.ts and the pure half of logos/remove.ts. The logo editor's component tests
 * reach both, but only through a white box, a gradient and a small transparent mark — a
 * 2026-09-23 mutation run left "black", "colored", "very large", every warning key, and the
 * "no logo → no icons" rule unwatched. Each is pinned here, at its boundary.
 */
import { describe, expect, it, vi } from 'vitest'
import { logoWarnings, NOT_FLAT_TEXT } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/logos/warnings'
import type { LogoAnalysis } from '@/lib/manager-tools/brand/image-checks'

vi.mock('@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions', () => ({
  deleteLogoAction: vi.fn(async () => ({})),
  setBrandAssetAction: vi.fn(async () => ({})),
}))
import { deleteLogoAction, setBrandAssetAction } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/actions'
import { iconsFramedFrom, NO_ICONS, removeLogo, removeQuestion, type IconUse } from '@/app/artists/[id]/(dashboard)/(manager-tools)/brand/logos/remove'

const clean: LogoAnalysis = { lowRes: false, flatBackground: null, hasTransparency: true, huge: false }
const say = (a: Partial<LogoAnalysis>) => logoWarnings({ ...clean, ...a })

describe('logoWarnings', () => {
  it('names the box by the word a manager recognises — white and black at their edges, anything else "colored"', () => {
    const box = (hex: string) => say({ flatBackground: hex, hasTransparency: false })[0].text
    expect(box('#ffffff')).toBe('This logo has a white box behind it.')
    expect(box('#f0f0f0')).toBe('This logo has a white box behind it.') // 240: still white
    for (const offWhite of ['#eff0f0', '#f0eff0', '#f0f0ef']) expect(box(offWhite), offWhite).toBe('This logo has a colored box behind it.')
    expect(box('#000000')).toBe('This logo has a black box behind it.')
    expect(box('#141414')).toBe('This logo has a black box behind it.') // 20: still black
    for (const offBlack of ['#151414', '#141514', '#141415']) expect(box(offBlack), offBlack).toBe('This logo has a colored box behind it.')
    expect(box('#e5484d')).toBe('This logo has a colored box behind it.')
  })

  it('each warning carries its own key — the flat one is what brings the eraser', () => {
    expect(say({ flatBackground: '#ffffff', hasTransparency: false }).map((w) => w.key)).toEqual(['flat'])
    expect(say({ hasTransparency: false })).toEqual([{ key: 'notFlat', text: NOT_FLAT_TEXT }])
    expect(say({ lowRes: true })).toEqual([{ key: 'lowRes', text: 'This logo is small, so it may look blurry.' }])
    expect(say({ huge: true })).toEqual([{ key: 'huge', text: 'This file is very large, so it will load slowly.' }])
  })

  it('a clean transparent logo says nothing; every problem at once says all of them, in order', () => {
    expect(say({})).toEqual([])
    expect(say({ flatBackground: '#000000', hasTransparency: false, lowRes: true, huge: true }).map((w) => w.key)).toEqual([
      'flat',
      'lowRes',
      'huge',
    ])
  })
})

describe('iconsFramedFrom', () => {
  const both = (favicon: string | null, home: string | null): IconUse => ({
    favicon: { exists: true, sourceMediaId: favicon },
    home_icon: { exists: true, sourceMediaId: home },
  })

  it('CRITICAL: no logo means no icons — even when no primary exists either (null ?? null is not a match)', () => {
    expect(iconsFramedFrom(both(null, null), null, null)).toEqual([])
  })

  it('icons that were never generated go with nothing (NO_ICONS is "none exist")', () => {
    expect(iconsFramedFrom(NO_ICONS, 'p1', 'p1')).toEqual([])
  })

  it('a null source is the primary; an explicit source is only that logo', () => {
    expect(iconsFramedFrom(both(null, 'l1'), 'p1', 'p1')).toEqual(['favicon'])
    expect(iconsFramedFrom(both(null, 'l1'), 'l1', 'p1')).toEqual(['home_icon'])
  })
})

describe('removeQuestion', () => {
  it('names the one icon that goes, by its own name', () => {
    expect(removeQuestion({ kind: 'added', id: 'l1' }, 'Tour', ['home_icon'])).toBe(
      'Remove “Tour”? The home-screen icon is made from it and goes too.',
    )
    expect(removeQuestion({ kind: 'builtin', purpose: 'logo_primary' }, 'Primary logo', ['favicon'])).toBe(
      'Remove the primary logo? The tab icon is made from it and goes too.',
    )
  })
})

describe('removeLogo', () => {
  it('CRITICAL: an icon that will not clear stops there, and says so — the next icon is not touched', async () => {
    vi.mocked(setBrandAssetAction)
      .mockResolvedValueOnce({}) // the logo itself
      .mockResolvedValueOnce({ error: 'permission denied' }) // the tab icon
    const res = await removeLogo('a1', { kind: 'builtin', purpose: 'logo_primary' }, ['favicon', 'home_icon'])
    expect(res).toEqual({ error: 'permission denied' })
    expect(vi.mocked(setBrandAssetAction).mock.calls.map((c) => c[1])).toEqual(['logo_primary', 'favicon'])
    expect(deleteLogoAction).not.toHaveBeenCalled()
  })
})
