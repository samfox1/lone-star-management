// One sort order for the library pages: newest, oldest, and A to Z.
/**
 * ONE ORDER FOR THE LIBRARY PAGES (Music, Videos), in a pure module.
 *
 * UNDATED GOES LAST, IN BOTH DIRECTIONS (Sam, 2026-09-28: "Last in both" — on the site
 * and on the Music page). The site already put undated music last: that is the date
 * fallback of `orderMusicProjects` in the bridge. The Music page had its own rule that
 * read an undated item as "just added" and put it FIRST under Newest, so the two
 * disagreed about where the same song sits. The page now runs the bridge's law.
 *
 * The rule: release date descending, undated in a tail after every dated item; within a
 * date, and within the undated tail, most recently added first. Oldest reverses the
 * dated run only; the undated tail stays the tail.
 */
import { describe, expect, it } from 'vitest'
import { orderMusicProjects } from '@samfox1/site-bridge/music'
import { sortLibrary } from '@/lib/library-order'

const item = (title: string, release_date: string | null | undefined, created_at?: string) => ({
  title, release_date, created_at,
})

const titles = (list: { title: string }[]) => list.map((i) => i.title)

describe('newest: dated by date, undated LAST, ties by when they were added', () => {
  it('CRITICAL: an undated item sorts BELOW every dated one', () => {
    const list = [item('Old', '2019-01-01'), item('Undated', null), item('Recent', '2026-01-01')]
    expect(titles(sortLibrary(list, 'newest'))).toEqual(['Recent', 'Old', 'Undated'])
  })

  it('CRITICAL: an EMPTY-STRING date is undated too', () => {
    // A blank date input stores ''. It must read as undated, not as a date that loses
    // (or wins) a string compare against every real one.
    expect(titles(sortLibrary([item('Blank', ''), item('Old', '2019-01-01')], 'newest'))).toEqual(['Old', 'Blank'])
  })

  it('CRITICAL: two undated items order by created_at, most recent first', () => {
    const list = [
      item('First in', null, '2026-09-01T00:00:00Z'),
      item('Last in', null, '2026-09-09T00:00:00Z'),
      item('Second in', null, '2026-09-05T00:00:00Z'),
    ]
    expect(titles(sortLibrary(list, 'newest'))).toEqual(['Last in', 'Second in', 'First in'])
  })

  it('CRITICAL: two items with the SAME date order by created_at, most recent first', () => {
    const list = [
      item('Added first', '2025-05-05', '2026-01-01T00:00:00Z'),
      item('Added last', '2025-05-05', '2026-09-01T00:00:00Z'),
    ]
    expect(titles(sortLibrary(list, 'newest'))).toEqual(['Added last', 'Added first'])
  })

  it('CRITICAL: items with NO date field at all (videos) order by created_at alone', () => {
    // Videos carry no release_date. They must fall straight through to the added key
    // rather than all reading as "undated, tie" and keeping arrival order.
    const list = [item('Oldest', undefined, '2020-01-01'), item('Newest', undefined, '2026-09-09'), item('Mid', undefined, '2023-01-01')]
    expect(titles(sortLibrary(list, 'newest'))).toEqual(['Newest', 'Mid', 'Oldest'])
  })

  it('a dated item still sorts by its DATE, not by when it was typed in', () => {
    const list = [item('Newer', '2026-05-01', '2020-01-01'), item('Older', '2019-01-01', '2026-09-09')]
    expect(titles(sortLibrary(list, 'newest'))).toEqual(['Newer', 'Older'])
  })

  it("CRITICAL: newest is the SITE's order — the same answer as the bridge's orderMusicProjects", () => {
    // The site orders an un-dragged catalog with orderMusicProjects' date fallback. Feed
    // both the same mixed list (dated, undated, blank, a shared date) and they must agree,
    // or a song sits in one place on the Music page and another on the site.
    const list = [
      item('A', '2024-03-01', '2026-01-01'),
      item('B', null, '2026-09-01'),
      item('C', '2026-07-01', '2026-02-01'),
      item('D', '', '2026-03-01'),
      item('E', '2024-03-01', '2026-08-01'),
      item('F', null, '2026-04-01'),
    ]
    // The site's side: same tie-break the page uses (most recently added first), then its law.
    const byAdded = [...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    const site = orderMusicProjects(byAdded.map((i) => ({ ...i, minSort: 0, date: i.release_date || null })))
    expect(titles(sortLibrary(list, 'newest'))).toEqual(titles(site))
    expect(titles(site)).toEqual(['C', 'E', 'A', 'B', 'F', 'D']) // the expectation, spelled out
  })
})

describe('oldest reverses the dates, and a–z is by title', () => {
  it('CRITICAL: oldest puts the undated item LAST too — "last in both"', () => {
    const list = [item('Undated', null), item('Old', '2019-01-01'), item('Recent', '2026-01-01')]
    expect(titles(sortLibrary(list, 'oldest'))).toEqual(['Old', 'Recent', 'Undated'])
  })

  it('oldest orders the undated tail oldest-added first', () => {
    const list = [
      item('Dated', '2020-01-01'),
      item('Added last', null, '2026-09-09'),
      item('Added first', null, '2026-01-01'),
    ]
    expect(titles(sortLibrary(list, 'oldest'))).toEqual(['Dated', 'Added first', 'Added last'])
  })

  it('CRITICAL: a–z ignores dates entirely', () => {
    // Titles chosen so alphabetical order is NOT chronological order, or this could pass
    // on the newest comparator by accident.
    const list = [item('Zebra', '2026-01-01'), item('Apple', '2019-01-01'), item('Mango', null)]
    expect(titles(sortLibrary(list, 'az'))).toEqual(['Apple', 'Mango', 'Zebra'])
  })

  it('does not mutate its input', () => {
    const list = [item('B', '2020-01-01'), item('A', '2026-01-01')]
    sortLibrary(list, 'newest')
    sortLibrary(list, 'oldest')
    expect(titles(list)).toEqual(['B', 'A'])
  })

  it('hands back the SAME objects it was given (callers carry extra fields)', () => {
    const a = { ...item('A', '2026-01-01'), extra: 1 }
    const b = { ...item('B', '2020-01-01'), extra: 2 }
    const out = sortLibrary([b, a], 'newest')
    expect(out[0]).toBe(a)
    expect(out[1]).toBe(b)
  })
})
