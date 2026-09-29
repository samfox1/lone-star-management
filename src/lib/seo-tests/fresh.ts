/**
 * IS THE LIVE SITE SHOWING THE LATEST PUBLISH? The trap this exists for: an artist's site caches
 * its pages for ~60 s (ISR, `export const revalidate = 60` in CONNECTING.md §6), so a test run
 * right after Publish can read the OLD page and report a stale result as if it were today's.
 *
 * THE MARKER. A bridge site's sitemap stamps every page with `lastModified` =
 * `payload.published_at` (the bridge's `sitemapEntries` / `lastModifiedFrom`, CONNECTING.md: "never
 * `new Date()`"), and `published_at` is max(revisions.published_at): the exact moment of a
 * publish. So the sitemap names WHICH publish the site last read:
 *
 *   true   its lastmod is the latest publish moment (within 1 s: Postgres keeps microseconds,
 *          a JS Date keeps milliseconds)
 *   false  its lastmod is an OLDER publish moment: confirmed stale
 *   null   anything else: no sitemap, no timed lastmod, a date-only lastmod, or a stamp that is
 *          no publish we made (a past show's date, a site that stamps the time of the request).
 *          "Couldn't tell" is never reported as fresh.
 *
 * WHAT IT CANNOT PROVE. Each page is cached on its own. A fresh sitemap proves the site has read
 * the new publish from the database; the home page and /about regenerate on their own 60 s
 * clocks and serve their old copy ONCE to the first visitor after it runs out (stale-while-
 * revalidate). The wait below requests "/" on every poll so its copy is refreshed alongside the
 * sitemap, then pauses a moment before the run, but a page it did not poke can still be old.
 */
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
 * for the artist (publish_moments), newest or not; `publishedAt` is the latest.
 */
export function siteFreshness(
  lastmods: readonly (string | null | undefined)[] | null | undefined,
  publishedAt: string | null | undefined,
  moments: readonly string[] = [],
): boolean | null {
  const latest = publishedAt ? Date.parse(publishedAt) : NaN
  if (!Number.isFinite(latest)) return null
  const stamps = stampsOf(lastmods)
  if (stamps.length === 0) return null
  const newest = Math.max(...stamps)
  if (Math.abs(newest - latest) <= SAME_MOMENT_MS) return true
  const older = moments.map((m) => Date.parse(m)).filter((m) => Number.isFinite(m) && m < latest - SAME_MOMENT_MS)
  if (older.some((m) => Math.abs(newest - m) <= SAME_MOMENT_MS)) return false
  return null
}

/** The `<lastmod>` values of a sitemap, in order. A sitemap INDEX lists sitemaps, not pages. */
export function sitemapLastmods(xml: string | null | undefined): string[] {
  if (!xml || /<sitemapindex[\s>]/i.test(xml)) return []
  return [...xml.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/g)].map((m) => m[1])
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
}

export type WaitOptions = {
  origin: string
  publishedAt: string | null | undefined
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
}

export const FRESH_MAX_WAIT_MS = 90_000
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

  const base: GuardedOptions = { fetcher: o.fetcher, allow: sameSite(o.origin), timeoutMs: POLL_TIMEOUT_MS }
  const origin = o.origin.replace(/\/+$/, '')
  const poke = () => guardedFetch(`${origin}/`, { ...base, maxBytes: 1024 }).catch(() => null)

  let sawMarker = false
  try {
    for (;;) {
      const [map] = await Promise.all([guardedFetch(`${origin}/sitemap.xml`, { ...base, maxBytes: 512 * 1024 }).catch(() => null), poke()])
      const lastmods = map && map.status === 200 ? sitemapLastmods(map.text) : []
      const verdict = siteFreshness(lastmods, o.publishedAt, o.moments ?? [])
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
      await sleep(intervalMs)
    }
  } catch {
    return { fresh: null, waitedMs: waited(), marker: sawMarker ? 'sitemap' : 'none' }
  }
}
