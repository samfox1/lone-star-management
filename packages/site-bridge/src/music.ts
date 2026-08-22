/**
 * The ONE law for what order an artist's music projects appear in.
 *
 * It lives in the bridge because it has to hold on BOTH sides of the wire: the editor's
 * Music panel and the connected site's grid must show the same thing in the same places,
 * or dragging a cover in the panel is a lie. They each used to state it themselves, and
 * they disagreed — lone-star ordered by the manager's drag, while skeen's MusicGrid
 * re-sorted albums → EPs → singles. A standalone SoundCloud track is a one-song project,
 * so it counted as a "single" and was flung to the bottom-right of the grid no matter
 * where Sam had put it (2026-08-21). Same defect shape as the music-rules twin that ran a
 * reverted rule for four weeks: a law two repos each restate is a law that drifts.
 *
 * Grouping is deliberately NOT here. Each side decides what a project IS (the editor
 * groups by parent release, a site may fall back to a cover heuristic when no releases
 * are published); this decides only what order the projects it was handed come back in.
 */

/**
 * EXACTLY what ordering needs to know about a project — deliberately no id or key, so a
 * caller passes its own project objects straight in and gets them straight back out with
 * whatever else they carry (`T extends OrderableProject`) rather than re-joining on a key.
 */
export type OrderableProject = {
  /**
   * The LOWEST `sort_order` among the project's songs — its position in the catalog.
   * A synced, never-dragged catalog has these all tied (0), which is what selects the
   * date fallback below.
   */
  minSort: number;
  /** The project's release date (ISO `YYYY-MM-DD`), or null for one that has none. */
  date: string | null;
};

/**
 * Order projects for display: the manager's drag if there is one, newest-first otherwise.
 *
 * MANUAL MODE — the tour-dates rule (Sam, 2026-08-18). A drag in the editor's Music panel
 * renumbers every track in the catalog, so the moment two projects hold DISTINCT minimums
 * somebody has arranged them and their arrangement IS the order. No category, date, or
 * platform may override it: that is the whole point of having dragged.
 *
 * Otherwise (every project tied, the state a freshly synced catalog is in) fall back to
 * newest release first, with undated projects in a stable tail — arbitrary, but the same
 * arbitrary on both sides of the wire.
 *
 * Returns a new array; the input is never mutated.
 */
export function orderMusicProjects<T extends OrderableProject>(projects: readonly T[]): T[] {
  const manual = new Set(projects.map((p) => p.minSort)).size > 1;
  // Both branches sort a COPY, and Array.prototype.sort is stable — so projects the
  // comparator calls equal keep the order the caller grouped them in.
  if (manual) return [...projects].sort((a, b) => a.minSort - b.minSort);
  return [...projects].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

/**
 * Is this release NEW — out in the last week (Sam, 2026-08-21)?
 *
 * `todayIso` is a parameter, never `new Date()` inside, for the reason the shows band
 * already threads one: a site renders on the server and caches, so "now" has to be the
 * render's now, decided by the caller — and a badge that reads the clock at module scope
 * is a badge no test can pin to a boundary.
 *
 * A FUTURE date is not new. An announced-but-unreleased single would otherwise wear the
 * badge for however long the announcement ran, and then keep wearing it for a week after
 * anyone could actually hear it, which is the opposite of what the badge is for.
 *
 * Dates are `YYYY-MM-DD`, compared as real days via UTC epoch — not by string maths,
 * which cannot subtract a week across the end of a month or a year.
 */
export function isNewRelease(
  date: string | null | undefined,
  todayIso: string,
  withinDays = 7,
): boolean {
  if (!date) return false;
  const then = Date.parse(`${date}T00:00:00Z`);
  const now = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then) || Number.isNaN(now)) return false;
  const days = (now - then) / 86_400_000;
  return days >= 0 && days <= withinDays;
}
