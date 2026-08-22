/**
 * The ONE law for what order music projects appear in — proved here, consumed by BOTH
 * the editor's Music panel (src/lib/music.ts) and a connected site's grid.
 *
 * It exists in the bridge, not in either app, because it was duplicated and the copies
 * disagreed: the editor ordered by the manager's drag while skeen's MusicGrid re-sorted
 * albums→EPs→singles, so every SoundCloud single (a standalone, therefore a "single")
 * was flung to the bottom-right of the grid no matter where Sam put it (2026-08-21).
 * A law two repos each restate is a law that drifts; this is the fix for that shape.
 */
import { describe, expect, it } from 'vitest'
import { isNewRelease, orderMusicProjects } from '@samfox1/site-bridge/music'

/** Newest → oldest, so a date sort and an insertion order can never agree by accident. */
const YOU = { key: 'release:you', minSort: 0, date: '2026-02-14' }
const HEAT = { key: 'release:heat', minSort: 0, date: '2025-05-09' }
const OUT = { key: 'release:out', minSort: 0, date: '2024-01-26' }
const LOOSE = { key: 'track:sc', minSort: 0, date: null }

const keys = (ps: { key: string }[]) => ps.map((p) => p.key)

describe('orderMusicProjects', () => {
  it('MANUAL MODE: distinct sort_orders are the order, beating the date sort', () => {
    // OUT is the OLDEST and numbered FIRST, so passing under a date sort is impossible.
    const out = orderMusicProjects([
      { ...YOU, minSort: 2 },
      { ...HEAT, minSort: 1 },
      { ...OUT, minSort: 0 },
    ])
    expect(keys(out)).toEqual(['release:out', 'release:heat', 'release:you'])
  })

  it('CRITICAL: a dragged standalone (a SoundCloud single) holds its place at the FRONT', () => {
    // The whole bug, in one assertion: the loose track is numbered first, and every
    // grouping/category rule that used to demote it must not.
    const out = orderMusicProjects([
      { ...YOU, minSort: 1 },
      { ...LOOSE, minSort: 0 },
      { ...HEAT, minSort: 2 },
    ])
    expect(keys(out)).toEqual(['track:sc', 'release:you', 'release:heat'])
  })

  it('a NEVER-DRAGGED catalog (every sort_order tied at the synced 0) falls back to newest-first', () => {
    const out = orderMusicProjects([OUT, YOU, HEAT])
    expect(keys(out)).toEqual(['release:you', 'release:heat', 'release:out'])
  })

  it('undated projects sort LAST under the date fallback, keeping their given order', () => {
    const other = { key: 'track:sc2', minSort: 0, date: null }
    const out = orderMusicProjects([LOOSE, OUT, other, YOU])
    expect(keys(out)).toEqual(['release:you', 'release:out', 'track:sc', 'track:sc2'])
  })

  it('does not mutate the array it is given', () => {
    const input = [OUT, YOU]
    orderMusicProjects(input)
    expect(keys(input)).toEqual(['release:out', 'release:you'])
  })

  it('a single project is neither manual nor re-dated — it just comes back', () => {
    expect(keys(orderMusicProjects([{ ...OUT, minSort: 7 }]))).toEqual(['release:out'])
    expect(orderMusicProjects([])).toEqual([])
  })
})

/**
 * The NEW badge (Sam, 2026-08-21: "songs should have a new tag that appears if they were
 * released in the last week"). Shared for the same reason the ordering is: the editor's
 * panel and the site's grid must agree about which covers are wearing it, and "a week"
 * is the kind of number that gets restated as 7, 8, or "this month" by the second copy.
 */
describe('isNewRelease', () => {
  const TODAY = '2026-08-21'

  it('a release from today, and one from exactly a week ago, are new', () => {
    expect(isNewRelease('2026-08-21', TODAY)).toBe(true)
    expect(isNewRelease('2026-08-14', TODAY)).toBe(true)
  })

  it('CRITICAL: a day past the window is not', () => {
    // The boundary is the whole rule; an off-by-one here is a badge that never expires.
    expect(isNewRelease('2026-08-13', TODAY)).toBe(false)
    expect(isNewRelease('2025-08-21', TODAY)).toBe(false)
  })

  it('CRITICAL: an UNRELEASED future date is not new — it has not happened yet', () => {
    // An announced-but-unreleased single would otherwise wear "NEW" for weeks before
    // anyone could hear it, and keep wearing it after.
    expect(isNewRelease('2026-08-22', TODAY)).toBe(false)
  })

  it('a project with no date is never new', () => {
    // Standalone SoundCloud songs land here until the manager dates them.
    expect(isNewRelease(null, TODAY)).toBe(false)
    expect(isNewRelease('', TODAY)).toBe(false)
  })

  it('crosses a month and a year boundary by real date maths, not string maths', () => {
    expect(isNewRelease('2025-12-30', '2026-01-02')).toBe(true)
    expect(isNewRelease('2026-07-30', '2026-08-02')).toBe(true)
    expect(isNewRelease('2026-06-30', '2026-08-02')).toBe(false)
  })

  it('honours a caller-chosen window', () => {
    expect(isNewRelease('2026-08-01', TODAY, 30)).toBe(true)
    expect(isNewRelease('2026-08-01', TODAY, 7)).toBe(false)
  })
})
