/**
 * IS THE LIVE SITE SHOWING THE LATEST PUBLISH? The trap this exists for: an artist's site caches
 * its pages for ~60 s (ISR, `export const revalidate = 60` in CONNECTING.md §6), so a test run
 * right after Publish can read the OLD page and report a stale result as if it were today's.
 *
 * THE MARKER. A bridge site's sitemap stamps its pages from the payload, never the clock
 * (CONNECTING.md §10), and the newest stamp names WHICH publish the site last read:
 *   • bridge 0.44 or older: every page is `published_at`, max(revisions.published_at), the
 *     exact moment of the latest publish, restyles included;
 *   • bridge 0.45: the homepage is `contentChangedAt(payload)`, the newest CONTENT change
 *     (a restyle moves no date), or a show that has passed since. `contentAt` below is that
 *     same function over the same door payload (known.ts), so the two cannot disagree.
 * The line is the last CONTENT change (`contentAt`; `publishedAt` on a database too old to
 * send `changed_at`), because what the tests read is content:
 *
 *   true   ANY lastmod is `contentAt`, `publishedAt`, or a publish moment at or after the line
 *          (within 1 s: Postgres keeps microseconds, a JS Date milliseconds). Any, not the
 *          newest: on tour, a show that passed after the last content change dates the 0.45
 *          homepage, and only a page that shows no tour (/about) still names the change. A
 *          stale site's pages are all older than the line, so none of them can match. After a
 *          Brand-only publish a 0.45 site still says `contentAt`, and that IS fresh: nothing a
 *          test reads has changed since.
 *   false  no lastmod matches, and the NEWEST is a publish moment BEFORE the line: confirmed
 *          stale (an older stamp alone proves nothing: a bio page unchanged for months)
 *   null   anything else: no sitemap, no timed lastmod, a date-only lastmod, or a newest stamp
 *          that is no publish we made (a site that stamps the time of the request; a passed
 *          show's midnight, which a stale site shows just the same, so it can never prove
 *          fresh). "Couldn't tell" is never reported as fresh.
 *
 * WHAT IT CANNOT PROVE. Each page is cached on its own. A fresh sitemap proves the site has read
 * the new publish from the database; the home page and /about regenerate on their own 60 s
 * clocks and serve their old copy ONCE to the first visitor after it runs out (stale-while-
 * revalidate). The wait below requests "/" on every poll so its copy is refreshed alongside the
 * sitemap, then pauses a moment before the run, but a page it did not poke can still be old.
 */
import { trimTrailingSlashes } from '@/lib/url'
import { guardedFetch, type GuardedOptions } from './guarded-fetch'

/** Postgres microseconds vs JS milliseconds, plus a little slack. */
const SAME_MOMENT_MS = 1_000

/** A lastmod with a time in it (`2026-09-28T21:14:03.123Z`). A date alone cannot name a publish. */
const TIMED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function stampsOf(lastmods: readonly (string | null | undefined)[] | null | undefined): number[] {
  return (lastmods ?? [])
    .filter((s): s is string => typeof s === 'string' && TIMED.test(s.trim()))
    .map((s) => Date.parse(s.trim()))
    .filter((n) => Number.isFinite(n))
}

/**
 * The verdict for one look at the site's sitemap lastmods. `moments` is every publish moment
 * for the artist (publish_moments), newest or not; `publishedAt` is the latest; `contentAt` the
 * last CONTENT change (known.ts), null on a database that sends no `changed_at`. See THE MARKER.
 */
export function siteFreshness(
  lastmods: readonly (string | null | undefined)[] | null | undefined,
  publishedAt: string | null | undefined,
  moments: readonly string[] = [],
  contentAt?: string | null,
): boolean | null {
  const latest = publishedAt ? Date.parse(publishedAt) : NaN
  if (!Number.isFinite(latest)) return null
  const content = contentAt ? Date.parse(contentAt) : NaN
  const line = Number.isFinite(content) ? content : latest
  const stamps = stampsOf(lastmods)
  if (stamps.length === 0) return null
  const near = (a: number, b: number) => Math.abs(a - b) <= SAME_MOMENT_MS
  const at = moments.map((m) => Date.parse(m)).filter((m) => Number.isFinite(m))
  const current = at.filter((m) => m >= line - SAME_MOMENT_MS)
  // ANY stamp: on tour a passed show's midnight dates the homepage, and only a page that shows
  // no tour (/about) still names the content change.
  if (stamps.some((s) => near(s, latest) || near(s, line) || current.some((m) => near(s, m)))) return true
  // Stale only on the NEWEST stamp: an older page (a bio unchanged for months) proves nothing.
  const newest = Math.max(...stamps)
  if (at.some((m) => m < line - SAME_MOMENT_MS && near(newest, m))) return false
  return null
}

const OPEN = '<lastmod>'
const CLOSE = '</lastmod>'

/**
 * The `<lastmod>` values of a sitemap, in order, trimmed. A sitemap INDEX lists sitemaps, not
 * pages. A value holding a `<` is not one (a CDATA, a nested tag), and the search goes on from
 * just after its `<lastmod>`, as the old regex did.
 *
 * A walk with indexOf, NOT a regex: this runs on a document the site serves, on every Publish,
 * before any claim, and `/<lastmod>\s*([^<]+?)\s*<\/lastmod>/` backtracked on `<lastmod>` +
 * spaces: 27 s for 32 KiB (security review 2026-09-29). Every position is looked at a bounded
 * number of times: the next `</lastmod>` is found once and reused until the walk passes it,
 * and each value is checked for `<` only up to the next `<`.
 */
export function sitemapLastmods(xml: string | null | undefined): string[] {
  if (!xml || /<sitemapindex[\s>]/i.test(xml)) return []
  const out: string[] = []
  let from = 0
  let close = -1
  for (;;) {
    const open = xml.indexOf(OPEN, from)
    if (open < 0) break
    const start = open + OPEN.length
    if (close < start) close = xml.indexOf(CLOSE, start)
    if (close < 0) break
    const lt = xml.indexOf('<', start)
    if (lt < close) {
      from = start // a `<` inside: not a value; look again after this <lastmod>
      continue
    }
    const value = xml.slice(start, close).trim()
    if (value) out.push(value)
    from = close + CLOSE.length
  }
  return out
}

/** A hop may stay on the site's host or its www / apex twin, and nowhere else. */
export function sameSite(origin: string): (url: string) => boolean {
  let host = ''
  let protocol = ''
  try {
    const u = new URL(origin)
    host = u.hostname.toLowerCase()
    protocol = u.protocol
  } catch {
    return () => false
  }
  const bare = host.replace(/^www\./, '')
  return (url: string) => {
    try {
      const u = new URL(url)
      const h = u.hostname.toLowerCase()
      return (u.protocol === protocol || u.protocol === 'https:') && (h === host || h === bare || h === `www.${bare}`)
    } catch {
      return false
    }
  }
}

export type FreshWait = {
  /** true = the site showed the latest publish before the run; false = still an older one when
   *  we stopped waiting; null = the site has no marker we can read (we waited a fixed time). */
  fresh: boolean | null
  waitedMs: number
  marker: 'sitemap' | 'none'
  /** The caller told it to stop (shouldStop / signal) before the site turned; `fresh` is null. */
  stopped?: true
}

export type WaitOptions = {
  origin: string
  publishedAt: string | null | undefined
  /** The last CONTENT change (known.ts `contentAt`); null/absent = judge by `publishedAt`. */
  contentAt?: string | null
  moments?: readonly string[]
  fetcher?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Longest wait for the marker. */
  maxWaitMs?: number
  /** Between looks. */
  intervalMs?: number
  /** With no marker at all, wait this long (the site's 60 s cache plus slack) and go. */
  fallbackWaitMs?: number
  /** After the marker turns, give "/" a moment to finish regenerating. */
  settleMs?: number
  /** Asked before every poll: true stops the wait (a newer publish superseded this one). */
  shouldStop?: () => boolean
  /** Aborting stops the wait before the next poll, and cuts a pause between polls short. */
  signal?: AbortSignal
}

const FRESH_MAX_WAIT_MS = 90_000
const INTERVAL_MS = 10_000
const FALLBACK_WAIT_MS = 70_000
const SETTLE_MS = 3_000
const POLL_TIMEOUT_MS = 8_000

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Wait, up to ~90 s, until the live site shows the latest publish. Never throws. Each look
 * fetches the sitemap (for the marker) and "/" (so the home page's cache turns over too), both
 * through the guarded fetch, both same-site only. Nothing published yet = nothing to wait for.
 */
export async function waitForFreshSite(o: WaitOptions): Promise<FreshWait> {
  const sleep = o.sleep ?? realSleep
  const now = o.now ?? Date.now
  const maxWaitMs = o.maxWaitMs ?? FRESH_MAX_WAIT_MS
  const intervalMs = o.intervalMs ?? INTERVAL_MS
  const fallbackWaitMs = Math.min(o.fallbackWaitMs ?? FALLBACK_WAIT_MS, maxWaitMs)
  const settleMs = o.settleMs ?? SETTLE_MS
  const start = now()
  const waited = () => now() - start
  if (!o.publishedAt) return { fresh: null, waitedMs: 0, marker: 'none' }
  const stop = () => o.signal?.aborted === true || o.shouldStop?.() === true
  // A pause the signal can end early. Resolves either way; the loop asks stop() next.
  const pause = (ms: number) =>
    o.signal
      ? Promise.race([sleep(ms), new Promise<void>((resolve) => o.signal!.addEventListener('abort', () => resolve(), { once: true }))])
      : sleep(ms)

  const base: GuardedOptions = { fetcher: o.fetcher, allow: sameSite(o.origin), timeoutMs: POLL_TIMEOUT_MS }
  const origin = trimTrailingSlashes(o.origin)
  const poke = () => guardedFetch(`${origin}/`, { ...base, maxBytes: 1024 }).catch(() => null)

  let sawMarker = false
  const stopped = (): FreshWait => ({ fresh: null, waitedMs: waited(), marker: sawMarker ? 'sitemap' : 'none', stopped: true })
  try {
    for (;;) {
      if (stop()) return stopped()
      const [map] = await Promise.all([guardedFetch(`${origin}/sitemap.xml`, { ...base, maxBytes: 512 * 1024 }).catch(() => null), poke()])
      const lastmods = map && map.status === 200 ? sitemapLastmods(map.text) : []
      const verdict = siteFreshness(lastmods, o.publishedAt, o.moments ?? [], o.contentAt)
      if (verdict !== null) sawMarker = true
      if (verdict === true) {
        await sleep(settleMs)
        return { fresh: true, waitedMs: waited(), marker: 'sitemap' }
      }
      if (!sawMarker && waited() >= fallbackWaitMs) {
        await poke()
        await sleep(settleMs)
        return { fresh: null, waitedMs: waited(), marker: 'none' }
      }
      if (waited() + intervalMs > maxWaitMs) return { fresh: sawMarker ? false : null, waitedMs: waited(), marker: sawMarker ? 'sitemap' : 'none' }
      await pause(intervalMs)
    }
  } catch {
    return { fresh: null, waitedMs: waited(), marker: sawMarker ? 'sitemap' : 'none' }
  }
}
