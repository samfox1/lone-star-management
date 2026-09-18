/**
 * The ONE law for which shows are PAST, and what order shows appear in.
 *
 * It lives in the bridge for the same reason `orderMusicProjects` does, and it arrived
 * here the same way: it was written once, correctly, in skeen's `lib/mapSite.ts`, and no
 * other site had it. The comments below are skeen's, moved rather than rewritten — they
 * record Sam's decisions and the reasons, which is the part that would be lost.
 *
 * THE PUBLISHED DOOR CANNOT DO THIS FOR A SITE. `get_public_site` orders `tour_dates` by
 * date and `published_at` and ignores `sort_order` entirely, so a site that renders the
 * payload in the order it arrives silently drops the manager's dragged order — the drag
 * works in the editor, publishes fine, and simply does not appear. That is a bug a site
 * author cannot see and would never think to look for, so the rule ships with the bridge.
 *
 * Bucketing, not just sorting: a site needs "upcoming" and "past" as two lists, and the
 * split is where the interesting rule is (a dateless show has no date to compare), so
 * this returns both rather than making each caller re-derive the halves.
 */

/**
 * EXACTLY what ordering needs to know about a show — the wire's own field names, so a
 * caller passes `payload.tour_dates` straight in, and `T extends OrderableShow` hands the
 * same objects back with everything else still on them. No mapping, no re-joining on an
 * id (the `orderMusicProjects` convention).
 */
export type OrderableShow = {
  /** ISO `YYYY-MM-DD`, or null for an UNDATED show (announced, date TBA). */
  date: string | null;
  /** The manager's "already played" flag, distinct from date math. */
  is_past?: boolean | null;
  /** The manager's dragged position. Null on a row no drag has touched. */
  sort_order?: number | null;
};

/**
 * A show is PAST if the manager flagged it an old show OR its date has already passed;
 * otherwise upcoming. The flag is how a DATELESS old show lands in Past — with no date
 * there's nothing to compare, so the toggle decides. A dateless, unflagged show is a TBA
 * upcoming date.
 *
 * `todayIso` is a parameter, never `new Date()` inside: a site renders on the server and
 * caches, so "now" has to be the render's now, decided by the caller — and a rule that
 * reads the clock at module scope is a rule no test can pin to a boundary.
 *
 * A show dated TODAY has not happened yet (strictly-less-than): a date is a day, and the
 * gig is tonight. Both sides are sliced to 10 characters so a value that arrived with a
 * time on it still compares as the day it names.
 */
export function isPastShow(show: OrderableShow, todayIso: string): boolean {
  return show.is_past === true || (!!show.date && show.date.slice(0, 10) < todayIso.slice(0, 10));
}

/**
 * Split shows into upcoming and past, each in the order a fan should read them.
 *
 * Within a bucket: dated first (upcoming ascending — the next show first; past descending
 * — the last one first), then undated. Undated shows have no date to sort by, so they
 * follow the manager's dragged order (`sort_order`) instead of arriving in whatever order
 * the payload happened to hold.
 *
 * MANUAL MODE (Sam, 2026-08-17): the first drag in the editor writes `sort_order` onto
 * every row it touches, and from then on the manager's order IS the order — date only
 * breaks ties for rows the drag never numbered. Untouched lists (all `sort_order` null)
 * keep the chronological default.
 *
 * The trigger is a DATED row carrying a number, because that is what proves a drag
 * happened over the real list: undated rows have always carried `sort_order` as their only
 * sequence, and reading one of those as a drag would strand every dated show behind it.
 *
 * Decided PER BUCKET, so dragging the past list does not renumber the upcoming one.
 *
 * Returns new arrays of the caller's own objects; the input is never mutated.
 */
export function orderShows<T extends OrderableShow>(
  shows: readonly T[],
  todayIso: string,
): { upcoming: T[]; past: T[] } {
  const order = (rows: readonly T[], dir: 1 | -1): T[] => {
    if (rows.some((s) => s.date && s.sort_order != null)) {
      return [...rows].sort((a, b) => {
        const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        return dir * (a.date ?? '').localeCompare(b.date ?? '');
      });
    }
    const dated = rows.filter((s): s is T & { date: string } => !!s.date);
    dated.sort((a, b) => dir * a.date.localeCompare(b.date));
    const undated = rows
      .filter((s) => !s.date)
      .sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER));
    return [...dated, ...undated];
  };
  return {
    upcoming: order(
      shows.filter((s) => !isPastShow(s, todayIso)),
      1,
    ),
    past: order(shows.filter((s) => isPastShow(s, todayIso)), -1),
  };
}
