/**
 * THE SUBSCRIBERS TOOL'S RULES (Sam, 2026-09-24; prototypes/subscribers_ledger_20260924.html).
 *
 * The page is a ledger of the emails the site's signup door (`subscribe()`, the only INSERT
 * path) collected. A manager may also REMOVE one (Sam, 2026-09-28; `deleteSubscriber` below,
 * `subscribers_delete` RLS policy, 20260928140500). Everything else it decides that is not
 * layout lives here, pure, so it is pinned without a DOM or a database
 * (tests/unit/manager-tools/subscribers/subscribers-lib.test.ts) and mutated by Stryker: the
 * search, the three sorts, the highlight, the dates, the CSV the export route sends, the
 * export link, and the mailto link.
 *
 * Dates are UTC everywhere. The ledger renders on the server AND in the browser, and a local
 * time zone would let the two disagree (a hydration mismatch) and let the page and the CSV
 * name different days for the same signup.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { shortDay } from '../format'

export type Subscriber = { id: string; email: string; created_at: string }

export type SubscriberSort = 'new' | 'old' | 'az'

/** The segmented control, in order. The component renders exactly this. */
export const SUBSCRIBER_SORTS: readonly { key: SubscriberSort; label: string }[] = [
  { key: 'new', label: 'Newest' },
  { key: 'old', label: 'Oldest' },
  { key: 'az', label: 'A–Z' },
]

/** One run of an email's text: `hit` runs are the part that matches the search. */
export type Segment = { text: string; hit: boolean }

const needleOf = (query: string) => query.trim().toLowerCase()

/**
 * The rows whose email contains the query, ignoring case and surrounding spaces, in the order
 * given. Plain text matching (`includes`), never a RegExp built from input, so "." is a dot.
 */
export function filterSubscribers<T extends Subscriber>(rows: readonly T[], query: string): T[] {
  const needle = needleOf(query)
  if (!needle) return [...rows]
  return rows.filter((r) => r.email.toLowerCase().includes(needle))
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)
/** Case-insensitive, then by exact case, so the order never depends on the input's order.
 *  A plain code-unit compare, not localeCompare: the server's ICU and the browser's could
 *  order an odd character differently, and the ledger renders on both. */
const byEmail = (a: Subscriber, b: Subscriber) => cmp(a.email.toLowerCase(), b.email.toLowerCase()) || cmp(a.email, b.email)
/** By the INSTANT: PostgREST writes a varying number of fractional digits, and an offset
 *  other than +00:00 would make a string compare lie. */
const byTime = (a: Subscriber, b: Subscriber) => Date.parse(a.created_at) - Date.parse(b.created_at)

const ORDER: Record<SubscriberSort, (a: Subscriber, b: Subscriber) => number> = {
  new: (a, b) => byTime(b, a) || byEmail(a, b),
  old: (a, b) => byTime(a, b) || byEmail(a, b),
  az: (a, b) => byEmail(a, b) || byTime(b, a),
}

/** A sorted COPY; the array given is left as it was. */
export function sortSubscribers<T extends Subscriber>(rows: readonly T[], sort: SubscriberSort): T[] {
  return [...rows].sort(ORDER[sort])
}

/**
 * The email split into plain and matching runs, every non-overlapping occurrence, in the
 * email's own case. The segments are RAW text that joins back to the email exactly: the
 * component renders them as React text and <mark> children, which escapes them, so nothing
 * here (or there) ever builds HTML from the query.
 */
export function highlightSegments(text: string, query: string): Segment[] {
  const needle = needleOf(query)
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

/** "Sep 22, 2026", in UTC. */
export function formatSubscribedDate(iso: string): string {
  return shortDay(new Date(iso), { locale: 'en-US', timeZone: 'UTC' })
}

/** "2026-09-22", in UTC: the CSV's `subscribed_at`. */
export function subscribedDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

/** The OWASP CSV-injection starters: a spreadsheet runs a cell that begins with one. */
const FORMULA_START = /^[=+\-@\t\r]/
const NEEDS_QUOTES = /[",\r\n]/

/**
 * One CSV field. A value a spreadsheet would run as a formula gets a leading apostrophe
 * FIRST (Excel and Sheets show it as text), then anything holding a comma, quote or line
 * break is quoted with its quotes doubled (RFC 4180), so the apostrophe sits inside.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const CSV_HEADER = 'email,subscribed_at'

/** The export: the header, then every subscriber NEWEST first (the page's default order),
 *  each line CRLF-terminated. */
export function subscribersCsv(rows: readonly Subscriber[]): string {
  const lines = [CSV_HEADER, ...sortSubscribers(rows, 'new').map((r) => `${csvCell(r.email)},${csvCell(subscribedDay(r.created_at))}`)]
  return lines.map((l) => `${l}\r\n`).join('')
}

/** `<artist-slug>-subscribers-<YYYY-MM-DD>.csv`, dated in UTC. The slug is cut down to
 *  [a-z0-9-] so it can never break out of the Content-Disposition header. */
export function exportFilename(slug: string, now: number): string {
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${safe || 'artist'}-subscribers-${new Date(now).toISOString().slice(0, 10)}.csv`
}

/**
 * A mailto: link to one subscriber. `subscribe()` allows any non-space, non-@ characters, so
 * "?", "&" and "#" can reach here; each side of the @ is URL-encoded so an address can never
 * add a cc, a subject or a body. The @ itself stays literal, as mail clients expect.
 */
export function mailtoHref(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return `mailto:${encodeURIComponent(email)}`
  return `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}`
}

/** The shown emails as one line for a BCC field: "a@x.com, b@y.com". */
export function emailList(rows: readonly Subscriber[]): string {
  return rows.map((r) => r.email).join(', ')
}

/**
 * The export route's link for the CURRENT search (Sam, 2026-09-28: "Download CSV" and
 * "Copy all" both follow the toolbar's search now, instead of the CSV always being the
 * full list). Trimmed exactly the way the search itself is (`filterSubscribers`'s
 * `needleOf`), so trailing spaces never change the URL, and the plain path with no query
 * string when there is nothing to filter by — a link a test (or a person) can compare
 * against the base route.
 */
export function exportHref(artistId: string, query: string): string {
  const q = query.trim()
  const base = `/artists/${artistId}/subscribers/export`
  return q ? `${base}?q=${encodeURIComponent(q)}` : base
}

export type DeleteResult = { ok: true } | { ok: false; error: string }

/**
 * Remove one subscriber (Sam, 2026-09-28). `.eq('artist_id', artistId)` scopes the delete
 * to THIS artist even though `id` alone already identifies the row, so a mismatched
 * artistId can never reach a row it does not belong to. `.select('id')` reads back what
 * was actually removed: the `subscribers_delete` RLS policy turns a stranger's delete into
 * `error: null` over zero matched rows (AGENTS.md rule 3), so the caller (the server
 * action) can tell that apart from a real removal instead of reporting a silent success.
 */
export async function deleteSubscriber(supabase: SupabaseClient, artistId: string, id: string): Promise<DeleteResult> {
  const { data, error } = await supabase.from('subscribers').delete().eq('id', id).eq('artist_id', artistId).select('id')
  if (error) return { ok: false, error: 'Could not remove that subscriber.' }
  if (!(data ?? []).length) return { ok: false, error: 'That subscriber is no longer there.' }
  return { ok: true }
}
