/**
 * ONE ORDER FOR THE LIBRARY PAGES — Music and Videos — in a pure module.
 *
 * Both browsers used to carry their own copy of "newest first": Music with a
 * release-date-then-added rule, Videos with an added-only rule that is the same rule for
 * items that have no dates. Two copies of one rule drift, and the music copy did: its
 * undated sentinel disagreed with itself, so an undated release sank to the bottom under
 * BOTH sort directions (fixed 2026-09-09). Neither copy lived where Stryker could see it,
 * because a .tsx component is not in the mutation slice. This module is.
 *
 * THE RULE.
 *   newest  release date descending; an UNDATED item is the thing you just added, so it
 *           sorts FIRST; ties (and every undated item among the undated) by created_at
 *           descending — when it landed in the library. Sam, 2026-09-09: "the ones added
 *           most recently should show up first".
 *   oldest  exactly the reverse, so the undated item is LAST. One sentinel, both ways.
 *   az      by title, dates ignored.
 *
 * `||`, not `??`, for the date: a blank date input stores '', and only `||` reads that as
 * undated. A dated item still sorts by its DATE — a back-catalogue record typed in today
 * is not new; arrival order only decides among the undated.
 */

export type LibrarySort = 'newest' | 'oldest' | 'az'

/** Anything a library section shows: a release, a song, a video. `release_date` is
 *  optional because videos have none — every video reads as undated and the order falls
 *  straight through to `created_at`, which is the whole rule for that page. */
export type LibraryItem = {
  title: string
  release_date?: string | null
  created_at?: string | null
}

/** Sorts after every real date under a descending compare — "just added". */
const FAR_FUTURE = '9999'

const dateKey = (x: LibraryItem) => x.release_date || FAR_FUTURE
const addedKey = (x: LibraryItem) => x.created_at || ''

export function compareLibrary(sort: LibrarySort): (a: LibraryItem, b: LibraryItem) => number {
  if (sort === 'az') return (a, b) => a.title.localeCompare(b.title)
  const newest = (a: LibraryItem, b: LibraryItem) =>
    dateKey(b).localeCompare(dateKey(a)) || addedKey(b).localeCompare(addedKey(a))
  return sort === 'newest' ? newest : (a, b) => newest(b, a)
}

/** A sorted COPY — the browsers hand these lists straight from props. */
export function sortLibrary<T extends LibraryItem>(items: readonly T[], sort: LibrarySort): T[] {
  return [...items].sort(compareLibrary(sort))
}
