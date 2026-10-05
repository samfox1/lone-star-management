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

/**
 * A web address as a person reads it, the ONE shortener (profiles, the crawl cards and the AI
 * test's evidence each had their own until 2026-10-02, prototypes/batch2_compare_20261002.html):
 *
 *   "https://www.skeenmusic.com/"        → "www.skeenmusic.com"   (the home page's lone / goes)
 *   "https://www.instagram.com/skeen/"   → "www.instagram.com/skeen/"   (a page's own slash stays)
 *   "https://x.com/a?b=1#c"              → "x.com/a?b=1"   (a #part goes, a query stays)
 *   "http://skeenmusic.com/"             → "http://skeenmusic.com"   (http:// stays: worth seeing)
 *
 * "www." STAYS: the crawl's Address card says "skeenmusic.com → www.skeenmusic.com", and without
 * it that line would print the same address twice. Written as it came otherwise (no parsing, so a
 * host is never punycoded and a path never percent-encoded). Not an http(s) address: returned as
 * it came. Never capped; a caller that needs a cap clips the result.
 */
export function shortLink(url: string | null | undefined): string {
  if (!url) return ''
  const m = /^(https?):\/\/([^/?#]+)([^#]*)/i.exec(url.trim())
  if (!m) return url
  const [, scheme, host, rest] = m
  return `${scheme.toLowerCase() === 'http' ? 'http://' : ''}${host}${rest === '/' ? '' : rest}`
}

/** What every tool says when a save fails and the server gave no reason. */
export const SAVE_FAILED = 'Couldn’t save that.'

/** One run of a text: `hit` runs are the part that matches the search. */
export type Segment = { text: string; hit: boolean }

/**
 * A text split into plain and matching runs, every non-overlapping occurrence, in the text's
 * own case: the search highlight of Subscribers and Enquiries (moved here 2026-10-05). The
 * segments are RAW text that joins back to the text exactly: _ui/highlight.tsx renders them as
 * React text and <mark> children, which escapes them, so nothing here (or there) ever builds
 * HTML from the query.
 */
export function highlightSegments(text: string, query: string): Segment[] {
  const needle = query.trim().toLowerCase()
  const n = needle.length
  if (!n) return [{ text, hit: false }]
  const out: Segment[] = []
  let plainFrom = 0
  let i = 0
  while (i + n <= text.length) {
    if (text.slice(i, i + n).toLowerCase() === needle) {
      if (i > plainFrom) out.push({ text: text.slice(plainFrom, i), hit: false })
      out.push({ text: text.slice(i, i + n), hit: true })
      i += n
      plainFrom = i
    } else {
      i += 1
    }
  }
  if (plainFrom < text.length) out.push({ text: text.slice(plainFrom), hit: false })
  return out
}

/**
 * A mailto: link to one address (a subscriber, an enquiry's sender). `subscribe()` allows any
 * non-space, non-@ characters, so "?", "&" and "#" can reach here; each side of the @ is URL-encoded so an address can never
 * add a cc, a subject or a body. The @ itself stays literal, as mail clients expect.
 */
export function mailtoHref(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return `mailto:${encodeURIComponent(email)}`
  return `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}`
}
