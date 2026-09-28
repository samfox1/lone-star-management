/**
 * ONE ORDER FOR THE LIBRARY PAGES — Music and Videos — in a pure module.
 *
 * THE RULE.
 *   newest  release date descending, UNDATED LAST; within one date, and within the
 *           undated tail, most recently added first (created_at descending).
 *   oldest  the dated run reversed. The undated tail stays the tail, oldest-added first.
 *   az      by title, dates ignored.
 *
 * WHY UNDATED IS LAST, BOTH WAYS (Sam, 2026-09-28: "Last in both" — the site and this
 * page). The site orders an artist's music with `orderMusicProjects` from the bridge, and
 * its date fallback puts undated projects in a tail. This module used to read an undated
 * item as "just added" and put it FIRST under Newest (2026-09-09), so one song sat
 * top-left on the Music page and bottom-right on the site. So the date step below IS the
 * bridge's function, not a restatement of it: two copies of one law drift, and that is
 * the drift this replaces. Its sort is stable, so the added-order tie-break is applied
 * first and survives it.
 *
 * `||` for the date: a blank date input stores '', and only `||` reads that as undated.
 * Videos have no dates, so they all fall in the "undated" tail and the order is simply
 * created_at, which is the whole rule for that page.
 */
import { orderMusicProjects } from '@samfox1/site-bridge/music'

export type LibrarySort = 'newest' | 'oldest' | 'az'

/** Anything a library section shows: a release, a song, a video. `release_date` is
 *  optional because videos have none. */
export type LibraryItem = {
  title: string
  release_date?: string | null
  created_at?: string | null
}

const addedKey = (x: LibraryItem) => x.created_at || ''
const isDated = (x: LibraryItem) => Boolean(x.release_date)

/** A sorted COPY — the browsers hand these lists straight from props. The items come back
 *  as the same objects, so a caller's extra fields ride along. */
export function sortLibrary<T extends LibraryItem>(items: readonly T[], sort: LibrarySort): T[] {
  if (sort === 'az') return [...items].sort((a, b) => a.title.localeCompare(b.title))

  // 1. The tie-break first: most recently added first.
  const byAdded = [...items].sort((a, b) => addedKey(b).localeCompare(addedKey(a)))
  // 2. The site's law. minSort is tied (0) on purpose: this page has explicit sort
  //    buttons, so only the law's DATE fallback applies here, never a drag order.
  const newest = orderMusicProjects(byAdded.map((item) => ({ item, minSort: 0, date: item.release_date || null }))).map(
    (p) => p.item,
  )
  if (sort === 'newest') return newest

  // Oldest: reverse the dated run and the undated tail separately, so undated stays last.
  const dated = newest.filter(isDated)
  const undated = newest.filter((x) => !isDated(x))
  return [...dated.reverse(), ...undated.reverse()]
}
