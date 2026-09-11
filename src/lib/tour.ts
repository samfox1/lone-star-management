/**
 * Tour-date rules shared by the dashboard row and anything else that has to agree with it.
 *
 * `isPastShow` — by DATE, with the stored flag as the override (Sam, 2026-09-11: "They
 * should all say past"). A show dated before `today` is past whatever the flag says;
 * the flag catches a show with no date, or one the manager marks regardless. `today` is
 * a YYYY-MM-DD string the caller computed once, so the comparison is a plain string
 * compare and never depends on the reader's clock or timezone.
 */
export function isPastShow(show: { date: string | null; is_past: boolean }, today: string): boolean {
  if (show.is_past) return true
  return show.date !== null && show.date < today
}

/** Today as YYYY-MM-DD, UTC — the one place the dashboard reads the clock for shows. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}
