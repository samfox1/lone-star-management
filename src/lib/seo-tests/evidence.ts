/**
 * Everything the "Can be found" tests read from the live site, fetched ONCE per run.
 *
 *   1. "/" as a person (a browser's User-Agent). Where it lands decides the origin the rest
 *      of the run uses, so a bare-domain → www redirect is not paid on every request.
 *   2. /robots.txt and /BingSiteAuth.xml.
 *   3. The sitemap: the first same-site `Sitemap:` line in robots.txt, else /sitemap.xml. A
 *      sitemap index is followed ONE level, to at most 3 lists on this site.
 *   4. Paths: "/" plus the first same-site sitemap pages, `maxPaths` in all (default 5). Each
 *      is visited as a person and as every bot in FETCHING_BOTS (bots.ts), under the bot's
 *      exact User-Agent.
 *
 * SAFETY. Every request goes through guardedFetch, whose `allow` is `sameSite`: this site,
 * www or bare, http or https, and nothing else. An address a sitemap lists on another host is
 * counted, never fetched. What a redirect tried to reach is named in `error`, never visited.
 *
 * POLITENESS. At most 4 requests at a time, 10 s each, and the whole run inside `budgetMs`
 * (55 s): one signal covers every request, redirects included, so the budget holds even when
 * a server answers slowly on every hop. What the budget did not reach is "no answer"
 * (`status: null`), which the tests read as "couldn't check", never as a pass. Pages are read
 * up to 1 MiB, robots.txt up to the 500 KiB anyone obeys, a sitemap up to 2 MiB.
 *
 * It never throws.
 */
import { isPublicSiteUrl } from '@/lib/custom-site'
import { pickTransport } from '@/lib/net-guard'
import { BROWSER_UA, FETCHING_BOTS } from './bots'
import { guardedFetch, type GuardedResponse } from './guarded-fetch'
import { ROBOTS_MAX_BYTES, parseRobots } from './robots-txt'
import type { SeoEvidence, SeoPageFetch } from './types'

export type GatheredSite = Pick<SeoEvidence, 'origin' | 'gatheredAt' | 'paths' | 'plain' | 'byBot' | 'robots' | 'sitemap' | 'bing'>

export type GatherOptions = {
  fetcher?: typeof fetch
  /** Pages to visit, "/" included. Default 5. */
  maxPaths?: number
  /** Each request's own limit. Default 10 s. */
  timeoutMs?: number
  /** The whole run's limit. Default 55 s. */
  budgetMs?: number
}

const CONCURRENCY = 4
const DEFAULT_MAX_PATHS = 5
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_BUDGET_MS = 55_000
const PAGE_MAX_BYTES = 1024 * 1024
const SITEMAP_MAX_BYTES = 2 * 1024 * 1024
/** Read one byte past the limit, so the parser can tell the file went on. */
const ROBOTS_READ_BYTES = ROBOTS_MAX_BYTES + 1024
/** Sitemap pages kept in the evidence (the count of all of them is `total`). */
const SITEMAP_KEEP = 500
const MAX_CHILD_SITEMAPS = 3

/** Only the headers a test reads. Never cookies. */
const KEEP_HEADERS = new Set([
  'content-type', 'x-robots-tag', 'link', 'location',
  'cache-control', 'age', 'expires', 'last-modified', 'cf-cache-status', 'x-vercel-cache',
  'server', 'cf-mitigated', 'x-vercel-mitigated', 'x-amzn-waf-action', 'retry-after',
])

/** "www.Example.com." → "example.com": the name that makes www and the bare domain one site. */
function siteName(host: string): string {
  return host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
}

/**
 * Is `url` on the same site as `origin`? Same name once a leading "www." is dropped from both,
 * over http or https, on the default port. A sub-domain (shop.example.com) is another site:
 * it can be run by anyone the owner points it at.
 */
export function sameSite(url: string, origin: string): boolean {
  try {
    const u = new URL(url)
    const o = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (u.port !== '') return false
    return siteName(u.hostname) === siteName(o.hostname)
  } catch {
    return false
  }
}

function pathOf(url: string): string {
  const u = new URL(url)
  return `${u.pathname}${u.search}` || '/'
}

function keepHeaders(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(all)) if (KEEP_HEADERS.has(k)) out[k] = v
  return out
}

function is2xx(status: number | null): boolean {
  return status != null && status >= 200 && status < 300
}

function isHtml(r: GuardedResponse): boolean {
  const type = (r.headers['content-type'] ?? '').toLowerCase()
  if (type) return type.includes('text/html') || type.includes('application/xhtml+xml')
  return /^\s*</.test(r.text ?? '')
}

/* ── the sitemap ────────────────────────────────────────────────────────────────────── */

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function xmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)
  const s = cdata ? cdata[1] : raw
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      const b = body.toLowerCase()
      if (b.startsWith('#x')) return String.fromCodePoint(Number.parseInt(b.slice(2), 16) || 0xfffd)
      if (b.startsWith('#')) return String.fromCodePoint(Number.parseInt(b.slice(1), 10) || 0xfffd)
      return XML_ENTITIES[b] ?? whole
    })
    .trim()
}

/** A sitemap (sitemaps.org): a urlset of <url>s or a sitemapindex of <sitemap>s. Tag names
 *  may carry a namespace prefix. Anything else (an html page, junk) is `kind: null`. */
export function parseSitemap(text: string): { kind: 'urlset' | 'index' | null; locs: string[]; lastmods: (string | null)[] } {
  const kind = /<(?:[\w-]+:)?urlset[\s>]/i.test(text) ? 'urlset' : /<(?:[\w-]+:)?sitemapindex[\s>]/i.test(text) ? 'index' : null
  if (!kind) return { kind: null, locs: [], lastmods: [] }
  const entry = kind === 'urlset' ? 'url' : 'sitemap'
  const locs: string[] = []
  const lastmods: (string | null)[] = []
  const re = new RegExp(`<(?:[\\w-]+:)?${entry}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${entry}>`, 'gi')
  for (const m of text.matchAll(re)) {
    const loc = /<(?:[\w-]+:)?loc(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?loc>/i.exec(m[1])
    if (!loc) continue
    const lastmod = /<(?:[\w-]+:)?lastmod(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?lastmod>/i.exec(m[1])
    locs.push(xmlText(loc[1]))
    lastmods.push(lastmod ? xmlText(lastmod[1]) : null)
  }
  return { kind, locs, lastmods }
}

/* ── a tiny pool ────────────────────────────────────────────────────────────────────── */

async function pool<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      out[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker))
  return out
}

/* ── the run ───────────────────────────────────────────────────────────────────────── */

function noAnswer(path: string, error: string): SeoPageFetch {
  return { path, finalUrl: null, status: null, headers: {}, html: null, error }
}

export async function gatherSiteEvidence(origin: string, opts: GatherOptions = {}): Promise<GatheredSite> {
  const gatheredAt = new Date().toISOString()
  const maxPaths = Math.max(1, opts.maxPaths ?? DEFAULT_MAX_PATHS)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  // Never the global fetch: `visit` wraps this, and a wrapped global fetch would resolve each
  // host again with no check on where it points (lib/net-guard).
  const base = pickTransport(opts.fetcher)

  let start: string
  try {
    start = isPublicSiteUrl(origin) ? new URL(origin).origin : ''
  } catch {
    start = ''
  }
  if (!start) {
    const none = [noAnswer('/', 'not-public')]
    return {
      origin, gatheredAt, paths: ['/'], plain: none,
      byBot: Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, none.map((p) => ({ ...p }))])),
      robots: { status: null, body: null }, sitemap: null,
    }
  }

  const began = Date.now()
  const runSignal = AbortSignal.timeout(budgetMs)
  const allow = (url: string) => sameSite(url, start)

  /** One guarded visit. Remembers where a refused redirect pointed, to name it. */
  const visit = async (url: string, userAgent: string, maxBytes: number): Promise<{ r: GuardedResponse; went: string | null }> => {
    if (runSignal.aborted || Date.now() - began >= budgetMs) {
      return { r: { status: null, finalUrl: null, hops: 0, headers: {}, text: null, bytes: null, truncated: false }, went: 'out-of-time' }
    }
    let lastLocation: string | null = null
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const here = String(input)
      const signal = init?.signal ? AbortSignal.any([init.signal, runSignal]) : runSignal
      const res = await base(input, { ...init, signal })
      try {
        const loc = res.headers?.get?.('location')
        lastLocation = loc ? new URL(loc, here).toString() : null
      } catch {
        lastLocation = null
      }
      return res
    }) as typeof fetch
    const r = await guardedFetch(url, { fetcher, userAgent, timeoutMs, maxBytes, allow })
    return { r, went: r.error === 'not-allowed' || r.error === 'not-public' ? lastLocation : null }
  }

  const toPage = (path: string, { r, went }: { r: GuardedResponse; went: string | null }): SeoPageFetch => {
    const fetched: SeoPageFetch = {
      path,
      finalUrl: r.finalUrl,
      status: r.status,
      headers: keepHeaders(r.headers),
      html: is2xx(r.status) && isHtml(r) ? r.text : null,
    }
    if (went === 'out-of-time') fetched.error = 'out-of-time'
    else if (r.error) fetched.error = went ? `${r.error}: ${went}` : r.error
    if (r.truncated) fetched.truncated = true
    return fetched
  }

  // 1. The home page, as a person. Where it lands is the origin for the rest.
  const home = toPage('/', await visit(`${start}/`, BROWSER_UA, PAGE_MAX_BYTES))
  let site = start
  if (home.finalUrl && sameSite(home.finalUrl, start)) site = new URL(home.finalUrl).origin

  // 2. robots.txt and Bing's file, side by side.
  const [robotsR, bingR] = await Promise.all([
    visit(`${site}/robots.txt`, BROWSER_UA, ROBOTS_READ_BYTES),
    visit(`${site}/BingSiteAuth.xml`, BROWSER_UA, 64 * 1024),
  ])
  const robots = { status: robotsR.r.status, body: is2xx(robotsR.r.status) ? robotsR.r.text : null }
  const bing = {
    siteAuth: {
      status: bingR.r.status,
      hasUser: is2xx(bingR.r.status) && /<users[\s>][\s\S]*<user>\s*[^<\s]+\s*<\/user>/i.test(bingR.r.text ?? ''),
    },
  }

  // 3. The sitemap.
  const named = robots.body
    ? parseRobots(robots.body).sitemaps.map((s) => {
        try {
          return new URL(s, `${site}/`).toString()
        } catch {
          return null
        }
      }).filter((s): s is string => s !== null)
    : []
  const namedHere = named.filter((s) => sameSite(s, site))
  const sitemapUrl = namedHere[0] ?? `${site}/sitemap.xml`
  const main = await visit(sitemapUrl, BROWSER_UA, SITEMAP_MAX_BYTES)
  const mainParsed = is2xx(main.r.status) ? parseSitemap(main.r.text ?? '') : { kind: null, locs: [], lastmods: [] }
  const offSite: string[] = []
  let locs: string[] = []
  let lastmods: (string | null)[] = []
  let truncated = main.r.truncated
  let children: { url: string; status: number | null }[] | undefined
  if (mainParsed.kind === 'urlset') {
    locs = mainParsed.locs
    lastmods = mainParsed.lastmods
  } else if (mainParsed.kind === 'index') {
    const childUrls = mainParsed.locs.filter((u) => {
      if (sameSite(u, site)) return true
      offSite.push(u)
      return false
    }).slice(0, MAX_CHILD_SITEMAPS)
    const got = await pool(childUrls.map((u) => () => visit(u, BROWSER_UA, SITEMAP_MAX_BYTES)), CONCURRENCY)
    children = childUrls.map((url, i) => ({ url, status: got[i].r.status }))
    got.forEach(({ r }) => {
      truncated ||= r.truncated
      if (!is2xx(r.status)) return
      const child = parseSitemap(r.text ?? '')
      // One level only: an index inside an index is not followed.
      if (child.kind !== 'urlset') return
      locs.push(...child.locs)
      lastmods.push(...child.lastmods)
    })
  }
  const here: number[] = []
  locs.forEach((u, i) => {
    if (sameSite(u, site)) here.push(i)
    else offSite.push(u)
  })
  const sitemap: NonNullable<SeoEvidence['sitemap']> = {
    status: main.r.status,
    urls: here.slice(0, SITEMAP_KEEP).map((i) => locs[i]),
    lastmods: here.slice(0, SITEMAP_KEEP).map((i) => lastmods[i]),
    url: sitemapUrl,
    parsed: mainParsed.kind !== null,
    namedInRobots: namedHere.length > 0,
    total: locs.length,
    offSite: { count: offSite.length, examples: offSite.slice(0, 3) },
  }
  if (truncated) sitemap.truncated = true
  if (children) sitemap.children = children
  if (main.r.error) sitemap.error = main.r.error

  // 4. The pages, as a person and as every bot. "/" for everyone first.
  const paths = ['/']
  for (const i of here) {
    if (paths.length >= maxPaths) break
    const p = pathOf(locs[i])
    if (!paths.includes(p)) paths.push(p)
  }
  type Job = { who: 'plain' | string; path: string; ua: string }
  const jobs: Job[] = []
  for (const path of paths) {
    if (path !== '/') jobs.push({ who: 'plain', path, ua: BROWSER_UA })
    for (const bot of FETCHING_BOTS) jobs.push({ who: bot.key, path, ua: bot.userAgent ?? BROWSER_UA })
  }
  const answers = await pool(jobs.map((j) => async () => toPage(j.path, await visit(`${site}${j.path}`, j.ua, PAGE_MAX_BYTES))), CONCURRENCY)
  const plain: SeoPageFetch[] = [home]
  const byBot: Record<string, SeoPageFetch[]> = Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, [] as SeoPageFetch[]]))
  jobs.forEach((j, i) => (j.who === 'plain' ? plain : byBot[j.who]).push(answers[i]))

  return { origin: site, gatheredAt, paths, plain, byBot, robots, sitemap, bing }
}
