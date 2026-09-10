// One sort order for the library pages: newest, oldest, and A to Z.
/**
 * ONE ORDER FOR THE LIBRARY PAGES (Music, Videos), in a pure module.
 *
 * Both browsers used to carry their own copy of "newest first": Music with a
 * release-date-then-added rule, Videos with an added-only rule that was the same rule
 * with no dates. Two copies of one rule drift — the music copy's undated sentinel
 * disagreed with itself for weeks — and neither lived where Stryker could see it, because
 * a .tsx component is not in the mutation slice. This module is.
 *
 * The rule: release date descending, an UNDATED item counting as just added (first under
 * Newest, last under Oldest); then created_at descending — when it landed in the library.
 */
import { describe, expect, it } from 'vitest'
import { compareLibrary, sortLibrary, type LibrarySort } from '@/lib/library-order'

const item = (title: string, release_date: string | null | undefined, created_at?: string) => ({
  title, release_date, created_at,
})

const titles = (list: { title: string }[]) => list.map((i) => i.title)

describe('newest: dated by date, undated first, ties by when they were added', () => {
  it('CRITICAL: an undated item sorts ABOVE every dated one', () => {
    const list = [item('Old', '2019-01-01'), item('Just added', null), item('Recent', '2026-01-01')]
    expect(titles(sortLibrary(list, 'newest'))).toEqual(['Just added', 'Recent', 'Old'])
  })

  it('CRITICAL: an EMPTY-STRING date is undated too', () => {
    // `||`, not `??`: a blank date input stores ''. The old `??` let it fall through to a
    // string compare it lost against every real date.
    expect(titles(sortLibrary([item('Old', '2019-01-01'), item('Blank', '')], 'newest'))).toEqual(['Blank', 'Old'])
  })

  it('CRITICAL: two undated items order by created_at, most recent first', () => {
    const list = [
      item('First in', null, '2026-09-01T00:00:00Z'),
      item('Last in', null, '2026-09-09T00:00:00Z'),
      item('Second in', null, '2026-09-05T00:00:00Z'),
    ]
    expect(titles(sortLibrary(list, 'newest'))).toEqual(['Last in', 'Second in', 'First in'])
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
})

describe('oldest is newest reversed, and a–z is by title', () => {
  it('CRITICAL: oldest puts the undated item LAST — one sentinel, both directions', () => {
    const list = [item('Old', '2019-01-01'), item('Just added', null), item('Recent', '2026-01-01')]
    expect(titles(sortLibrary(list, 'oldest'))).toEqual(['Old', 'Recent', 'Just added'])
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
    expect(titles(list)).toEqual(['B', 'A'])
  })

  it('compareLibrary is the comparator sortLibrary uses', () => {
    const sorts: LibrarySort[] = ['newest', 'oldest', 'az']
    const list = [item('Zebra', '2026-01-01'), item('Apple', null, '2026-09-09'), item('Mango', '2019-01-01')]
    for (const s of sorts) expect(titles([...list].sort(compareLibrary(s)))).toEqual(titles(sortLibrary(list, s)))
  })
})
