/**
 * "HOW CRAWLERS SEE YOUR SITE": the facts behind the AI test's first section (types.ts
 * `SeoCrawl`; prototypes/seo_variants_20260930_r11.html). Built ONCE per run from the evidence
 * the 24 tests read, with the ENGINE'S OWN readers, so this section can never tell the manager
 * something the tests read differently:
 *
 *   robots.txt  robots-txt.ts `robotsVerdict` for every SEO_BOTS entry at "/", the deciding
 *               group and rule spelled as robots.txt lines ("User-agent: *", "Allow: /")
 *   sitemap     the list as evidence.ts read it; each page's status joined to the run's own
 *               visit the `list` test's way (found.ts `pathKey`: "/about/" is "/about")
 *   pages       the canonical each visitor was given and the noindex signals, read by the
 *               `allowed` test's readers (found.ts `canonicalTargets`, `visitNoindex`) for the
 *               person's copy and Google's and Bing's; each VISITING crawler's status
 *
 * FACTS, not verdicts. Every string is the site's own (or Google's / Bing's), kept as plain
 * text: the page renders it as text only. Pure, total (junk evidence gives empty answers, never
 * a throw), no network: the other spelling and the listing are found by the run (run.ts) and
 * passed in.
 */
import { FETCHING_BOTS, SEO_BOTS, robotsTokensOf } from './bots'
import { sameSite } from './evidence'
import { SEARCH_BOTS, canonicalTargets, pathKey, visitNoindex } from './found'
import { describeRule, robotsVerdict, type RobotsVerdict } from './robots-txt'
import type { SeoBot, SeoCrawl, SeoEvidence, SeoPageFetch } from './types'

/** How much of robots.txt is quoted. */
const CRAWL_ROBOTS_CHARS = 2_000
/** How many of the sitemap's pages are listed (the count of all of them is `total`). */
const CRAWL_SITEMAP_PAGES = 50
/** Caps on text that came from the site, so one runaway value can't swell the stored run. */
const PATH_MAX = 300
const DATE_MAX = 40
const URL_MAX = 500
const RULE_MAX = 300

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** The first `max` UTF-16 units, never ending on half of a two-unit character. */
function head(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}
const clip = (s: string, max: number) => (s.length <= max ? s : `${head(s, max - 1)}…`)

/** A path as the crawl shows it everywhere (pages, sitemap, listing), so rows can be matched. */
export const crawlPath = (path: string): string => clip(path, PATH_MAX)

const originOf = (e: SeoEvidence): string => (typeof e.origin === 'string' ? e.origin.replace(/\/+$/, '') : '')
const statusOf = (f: SeoPageFetch | undefined): number | null => (f && typeof f.status === 'number' ? f.status : null)
const visitAt = (list: unknown, path: string): SeoPageFetch | undefined =>
  Array.isArray(list) ? (list as (SeoPageFetch | null)[]).find((f): f is SeoPageFetch => !!f && typeof f === 'object' && f.path === path) : undefined
const byBotOf = (e: SeoEvidence): Record<string, unknown> => (e.byBot && typeof e.byBot === 'object' ? (e.byBot as Record<string, unknown>) : {})

/* ── robots.txt ─────────────────────────────────────────────────────────────────────── */

type CrawlBot = SeoCrawl['robots']['bots'][number]

/** The group robots-txt.ts chose (a lower-cased token or "*"), spelled with the token as the
 *  vendor writes it ("googlebot" → "User-agent: Googlebot"). */
function groupLine(bot: SeoBot, group: string | null | undefined): string | null {
  if (!group) return null
  if (group === '*') return 'User-agent: *'
  return `User-agent: ${robotsTokensOf(bot).find((t) => t.toLowerCase() === group) ?? group}`
}

function botRow(bot: SeoBot, v: RobotsVerdict): CrawlBot {
  return {
    key: bot.key,
    who: bot.who,
    token: bot.robotsToken,
    visits: bot.fetches,
    verdict: v.verdict,
    why: v.why,
    group: groupLine(bot, v.check?.group),
    rule: v.check?.rule ? clip(describeRule(v.check.rule), RULE_MAX) : null,
  }
}

const UNKNOWN: RobotsVerdict = { verdict: 'unknown', why: 'no-answer' }

function robotsOf(e: SeoEvidence): SeoCrawl['robots'] {
  const r = e.robots && typeof e.robots === 'object' ? e.robots : { status: null, body: null }
  const status = typeof r.status === 'number' ? r.status : null
  const body = typeof r.body === 'string' ? r.body : null
  return {
    url: `${originOf(e)}/robots.txt`,
    status,
    text: body === null ? null : head(body, CRAWL_ROBOTS_CHARS),
    truncated: body !== null && body.length > CRAWL_ROBOTS_CHARS,
    bots: SEO_BOTS.map((bot) => botRow(bot, safe(() => robotsVerdict({ status, body }, robotsTokensOf(bot), '/'), UNKNOWN))),
  }
}

/* ── the sitemap ────────────────────────────────────────────────────────────────────── */

const NO_SITEMAP: SeoCrawl['sitemap'] = { url: null, status: null, namedInRobots: false, total: 0, pages: [], sameDates: false }

function sitemapOf(e: SeoEvidence): SeoCrawl['sitemap'] {
  const sm = e.sitemap
  if (!sm || typeof sm !== 'object') return { ...NO_SITEMAP, pages: [] }
  const origin = originOf(e)
  const urls = Array.isArray(sm.urls) ? sm.urls : []
  const lastmods = Array.isArray(sm.lastmods) ? sm.lastmods : []
  // Every same-site page the list holds, in its order, with its date.
  const listed: { path: string; key: string; lastmod: string | null }[] = []
  urls.forEach((u, i) => {
    if (typeof u !== 'string' || !sameSite(u, origin)) return
    const url = safe(() => new URL(u), null)
    if (!url) return
    const lm = lastmods[i]
    listed.push({ path: `${url.pathname}${url.search}`, key: pathKey(url), lastmod: typeof lm === 'string' && lm.trim() !== '' ? lm.trim() : null })
  })
  // What a person got on each page the run opened, keyed the `list` test's way.
  const opened = new Map<string, number | null>()
  for (const f of Array.isArray(e.plain) ? e.plain : []) {
    if (!f || typeof f.path !== 'string') continue
    const key = safe(() => pathKey(new URL(`${origin}${f.path}`)), f.path)
    if (!opened.has(key)) opened.set(key, statusOf(f))
  }
  const first = listed[0]?.lastmod ?? null
  return {
    url: typeof sm.url === 'string' ? clip(sm.url, URL_MAX) : null,
    status: typeof sm.status === 'number' ? sm.status : null,
    namedInRobots: sm.namedInRobots === true,
    total: typeof sm.total === 'number' && Number.isFinite(sm.total) && sm.total >= 0 ? sm.total : urls.length,
    pages: listed.slice(0, CRAWL_SITEMAP_PAGES).map((p) => ({ path: crawlPath(p.path), lastmod: p.lastmod === null ? null : clip(p.lastmod, DATE_MAX), status: opened.get(p.key) ?? null })),
    // Every listed page on one date: the dates tell a search engine nothing.
    sameDates: listed.length > 1 && first !== null && listed.every((p) => p.lastmod === first),
  }
}

/* ── each opened page ───────────────────────────────────────────────────────────────── */

/** The first canonical a visit names, absolute; the text as written when it isn't an address. */
function canonicalOf(f: SeoPageFetch | undefined, origin: string, path: string): string | null {
  const t = safe(() => canonicalTargets(f, origin, path), [])[0]
  if (!t) return null
  return clip(t.url ? t.url.href : t.raw, URL_MAX)
}

function pagesOf(e: SeoEvidence): SeoCrawl['pages'] {
  const origin = originOf(e)
  const bots = byBotOf(e)
  // The moment `unavailable_after` is judged against: the run's, as the `allowed` test does.
  const now = Date.parse(e.gatheredAt) || Date.now()
  const names = [...SEARCH_BOTS] as string[]
  const paths = Array.isArray(e.paths) ? e.paths.filter((p): p is string => typeof p === 'string') : []
  return paths.map((path) => {
    const person = visitAt(e.plain, path)
    const google = visitAt(bots.googlebot, path)
    const bing = visitAt(bots.bingbot, path)
    // A signal in any of the three copies counts, scoped to everyone or to Google / Bing:
    // exactly what makes the `allowed` test say "asks search engines not to list it".
    const signals = [person, google, bing].map((f) => safe(() => visitNoindex(f, names, now), { header: null, meta: null }))
    return {
      path: crawlPath(path),
      status: statusOf(person),
      canonical: { person: canonicalOf(person, origin, path), google: canonicalOf(google, origin, path), bing: canonicalOf(bing, origin, path) },
      noindex: { meta: signals.some((s) => s.meta !== null), header: signals.some((s) => s.header !== null) },
      visits: Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, statusOf(visitAt(bots[b.key], path))])),
    }
  })
}

/* ── the whole section ──────────────────────────────────────────────────────────────── */

export function buildCrawl(evidence: SeoEvidence, extras: { otherHost: SeoCrawl['otherHost']; listing: SeoCrawl['listing'] }): SeoCrawl {
  const e = (evidence && typeof evidence === 'object' ? evidence : {}) as SeoEvidence
  return {
    v: 1,
    robots: safe(() => robotsOf(e), { url: '/robots.txt', status: null, text: null, truncated: false, bots: SEO_BOTS.map((bot) => botRow(bot, UNKNOWN)) }),
    sitemap: safe(() => sitemapOf(e), { ...NO_SITEMAP, pages: [] }),
    pages: safe(() => pagesOf(e), []),
    otherHost: extras?.otherHost ?? null,
    listing: { google: extras?.listing?.google ?? null, bing: extras?.listing?.bing ?? null },
  }
}
