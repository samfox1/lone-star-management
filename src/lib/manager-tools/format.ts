/**
 * THE MANAGER TOOLS' SHARED FORMATS (AGENTS.md, 2026-10-01: "shared formats in
 * `src/lib/manager-tools/format.ts`"). A date, a plural or a link written by hand drifts from
 * its copies; before writing one, use these. Pure: no React, no request.
 *
 * Each one reproduces, exactly, what the copies it replaced printed (tests/unit/manager-tools/
 * format.test.ts). Where two copies differed (a locale, a time zone, when the year shows) that
 * is an explicit option here, not a quiet change.
 */

export type DayOptions = {
  /** Undefined: the runtime's own (the manager's browser). The tools that pin English pass 'en-US'. */
  locale?: string
  /** Undefined: the runtime's own zone. Subscribers pass 'UTC' (the day they signed up, everywhere). */
  timeZone?: string
  /** Leave the year off when the day falls in `now`'s year ("Sep 29"); without it the year
   *  always shows ("Sep 29, 2026"). */
  now?: Date | number
}

/** A short calendar day: "Sep 29, 2026", or "Sep 29" in the year of `now`. */
export function shortDay(at: Date, { locale, timeZone, now }: DayOptions = {}): string {
  const year = now === undefined || at.getFullYear() !== new Date(now).getFullYear()
  return at.toLocaleDateString(locale, { timeZone, month: 'short', day: 'numeric', year: year ? 'numeric' : undefined })
}

/** A time of day: "9:14 PM". */
export function clockTime(at: Date, locale?: string): string {
  return at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

/** "1 page", "3 pages": the count, then the word that agrees with it. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A profile link as a person reads it: "https://www.discogs.com/artist/1" → "discogs.com/artist/1".
 *  Only an https link's scheme and "www." go; the rest (a trailing slash, a #part) stays. The
 *  crawl cards' `shortUrl` (crawl-model.ts) is a different reading: it parses the address, keeps
 *  "www." and drops the home page's slash. */
export function shortLink(url: string): string {
  return url.replace(/^https:\/\/(www\.)?/, '')
}

/** What every tool says when a save fails and the server gave no reason. */
export const SAVE_FAILED = 'Couldn’t save that.'
