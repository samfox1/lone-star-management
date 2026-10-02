/**
 * Everything the "Can be found" tests read from the live site, fetched ONCE per run.
 *
 *   1. "/" as a person (a browser's User-Agent). Where it lands decides the origin the rest
 *      of the run uses, so a bare-domain → www redirect is not paid on every request. How it
 *      answered is `reach`, the one run-level fact ("we couldn't reach your site").
 *   2. /robots.txt and /BingSiteAuth.xml.
 *   3. The sitemap: each same-site `Sitemap:` line in robots.txt (at most 3), then /sitemap.xml,
 *      until one reads. Gzip is unpacked (capped); xml, a text list and RSS / Atom are read
 *      (sitemaps.org and Google accept all three). An index is followed ONE level, 3 lists.
 *   4. Paths: "/" plus up to `maxPaths - 1` more (default 5 in all). The artist's key pages come
 *      first (about, bio, music, releases, shows, tour, events, press), from the sitemap or from
 *      the home page's own links; then the rest of the sitemap; then the rest of the links.
 *      Each is visited as a person and as every bot in FETCHING_BOTS, under its exact name.
 *
 * SAFETY. Every request goes through guardedFetch, whose `allow` is `sameSite`: this site,
 * www or bare, http or https, and nothing else. An address a sitemap or robots.txt names on
 * another host is counted, never fetched. What a redirect tried to reach is named in `error`.
 * Nothing that reads fetched text backtracks: the sitemap reader is a linear scan (a regex
 * here once took 170 s on a 2 MiB hostile file, and no timeout can interrupt a regex).
 *
 * POLITENESS. At most 4 requests at a time, 10 s each, and the whole run inside `budgetMs`
 * (55 s). A request that got NO answer (dropped, timed out) is tried once more after a short
 * pause, inside the budget; an answer, even an error, never is. What the budget did not reach
 * is "out-of-time" (`status: null`), which the tests read as "couldn't check", never a pass.
 * Pages are read up to 1 MiB, robots.txt up to the 500 KiB anyone obeys, a sitemap up to
 * 2 MiB (10 MiB once unpacked). Text is decoded in the charset the page names.
 *
 * It never throws.
 */
import { setMaxListeners } from 'node:events'
import { gunzipSync } from 'node:zlib'
import { isPublicSiteUrl } from '@/lib/custom-site'
import { pickTransport } from '@/lib/net-guard'
import { BROWSER_UA, FETCHING_BOTS } from './bots'
import { guardedFetch, type GuardedResponse } from '@/lib/guarded-fetch'
import { parseAttrs, parsePage, siteName } from './html'
import { ROBOTS_MAX_BYTES, parseRobots } from './robots-txt'
import type { SeoEvidence, SeoPageFetch } from './types'

export type GatheredSite = Pick<SeoEvidence, 'origin' | 'gatheredAt' | 'paths' | 'plain' | 'byBot' | 'robots' | 'sitemap' | 'bing' | 'reach'>

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
const RETRY_PAUSE_MS = 250
const PAGE_MAX_BYTES = 1024 * 1024
const SITEMAP_MAX_BYTES = 2 * 1024 * 1024
const SITEMAP_UNZIPPED_MAX = 10 * 1024 * 1024
/** Read one byte past the limit, so the parser can tell the file went on. */
const ROBOTS_READ_BYTES = ROBOTS_MAX_BYTES + 1024
/** Sitemap pages kept in the evidence (the count of all of them is `total`). */
const SITEMAP_KEEP = 500
const MAX_CHILD_SITEMAPS = 3
const MAX_NAMED_SITEMAPS = 3
const PAGE_ACCEPT = 'text/html,application/xhtml+xml,*/*;q=0.8'

/** Only the headers a test reads. Never cookies. */
const KEEP_HEADERS = new Set([
  'content-type', 'x-robots-tag', 'link', 'location',
  'cache-control', 'age', 'expires', 'last-modified', 'cf-cache-status', 'x-vercel-cache',
  'server', 'cf-mitigated', 'x-vercel-mitigated', 'x-amzn-waf-action', 'retry-after',
])

/** The artist's own pages: where a bio, releases and shows live. Opened before anything else. */
const KEY_PAGE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(about|bio|biography|music|releases?|discography|shows?|tour|tours|events?|dates|live|press|epk)(?:\/|$)/i
/** Links that are files, not pages. */
const FILE_LINK = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|pdf|mp3|mp4|m4a|wav|flac|zip|css|js|mjs|json|xml|txt|webm|mov|woff2?)$/i

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

/* ── bytes → text ───────────────────────────────────────────────────────────────────── */

function decoderFor(label: string | null): TextDecoder {
  try {
    if (label) return new TextDecoder(label.trim().toLowerCase(), { fatal: false })
  } catch {
    // An unknown label ("utf8mb4", junk): UTF-8, as a browser falls back.
  }
  return new TextDecoder('utf-8', { fatal: false })
}

/** The charset a document names: the Content-Type header, a byte order mark, else a
 *  `<meta charset>` in its first 2 KB (read as Latin-1, which never fails). Else UTF-8. */
function decodeBody(bytes: Uint8Array, contentType: string | undefined): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? '')?.[1] ?? null
  if (fromHeader) return decoderFor(fromHeader).decode(bytes)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decoderFor('utf-8').decode(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decoderFor('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decoderFor('utf-16be').decode(bytes)
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048))
  const meta = /<meta\b[^>]{0,300}?charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ?? null
  return decoderFor(meta).decode(bytes)
}

function isHtmlType(contentType: string | undefined, text: string | null): boolean {
  const type = (contentType ?? '').toLowerCase()
  if (type) return type.includes('text/html') || type.includes('application/xhtml+xml')
  return /^\s*</.test(text ?? '')
}

/* ── the sitemap: a linear scan ─────────────────────────────────────────────────────── */

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\uFFFD'
}

/** Element text: CDATA unwrapped, entities decoded, trimmed. `raw` is one element's content,
 *  already bounded by the scan, and every step here is a single pass. */
function xmlText(raw: string): string {
  let s = ''
  let i = 0
  for (;;) {
    const open = raw.indexOf('<![CDATA[', i)
    if (open < 0) {
      s += decodeXmlEntities(raw.slice(i))
      break
    }
    s += decodeXmlEntities(raw.slice(i, open))
    const close = raw.indexOf(']]>', open + 9)
    if (close < 0) {
      s += raw.slice(open + 9)
      break
    }
    s += raw.slice(open + 9, close)
    i = close + 3
  }
  return s.trim()
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,8}|#\d{1,10}|[a-z]{2,6});/gi, (whole, body: string) => {
    const b = body.toLowerCase()
    if (b.startsWith('#x')) return codePoint(Number.parseInt(b.slice(2), 16))
    if (b.startsWith('#')) return codePoint(Number.parseInt(b.slice(1), 10))
    return XML_ENTITIES[b] ?? whole
  })
}

const NAME_CHAR = /[A-Za-z0-9_:.-]/

/** The local name of the tag starting at `lt` ("ns:loc" → "loc"), lower-cased, and whether it
 *  closes. Reads at most 64 characters. */
function tagAt(text: string, lt: number): { name: string; closing: boolean; nameEnd: number } {
  let i = lt + 1
  const closing = text[i] === '/'
  if (closing) i++
  const start = i
  while (i < text.length && i - start < 64 && NAME_CHAR.test(text[i])) i++
  const full = text.slice(start, i).toLowerCase()
  const colon = full.lastIndexOf(':')
  return { name: colon >= 0 ? full.slice(colon + 1) : full, closing, nameEnd: i }
}

export type ParsedSitemap = {
  kind: 'urlset' | 'index' | null
  format: 'xml' | 'text' | 'feed' | 'html' | 'other'
  locs: string[]
  lastmods: (string | null)[]
}

/**
 * A sitemap: a urlset of <url>s, a sitemapindex of <sitemap>s, an RSS / Atom feed, or a text
 * list of addresses (sitemaps.org, Google). Tag names may carry a namespace prefix.
 *
 * LINEAR: one pass over the text by `indexOf`, each character looked at a bounded number of
 * times whatever the input (no regex runs over the body). An element left open ends the scan.
 */
export function parseSitemap(text: string): ParsedSitemap {
  const locs: string[] = []
  const lastmods: (string | null)[] = []
  const firstLt = text.indexOf('<')
  if (firstLt < 0 || !/^\s*$/.test(text.slice(0, Math.min(firstLt, 4096)))) {
    // No markup at the start: a text list, one address per line, when there is one.
    const lines = text.split(/\r\n|\r|\n/, 60_000).map((l) => l.trim()).filter(Boolean)
    const urls = lines.filter((l) => /^https?:\/\/\S+$/i.test(l))
    if (urls.length && urls.length === lines.length) return { kind: 'urlset', format: 'text', locs: urls, lastmods: urls.map(() => null) }
    return { kind: null, format: firstLt < 0 ? 'other' : looksHtml(text) ? 'html' : 'other', locs, lastmods }
  }
  let root: string | null = null
  let entry: { loc: string | null; lastmod: string | null } | null = null
  let pos = firstLt
  while (pos >= 0 && pos < text.length) {
    // Skip what cannot hold elements.
    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4)
      if (end < 0) break
      pos = text.indexOf('<', end + 3)
      continue
    }
    if (text.startsWith('<![CDATA[', pos)) {
      const end = text.indexOf(']]>', pos + 9)
      if (end < 0) break
      pos = text.indexOf('<', end + 3)
      continue
    }
    if (text[pos + 1] === '?' || text[pos + 1] === '!') {
      const end = text.indexOf('>', pos + 2)
      if (end < 0) break
      pos = text.indexOf('<', end + 1)
      continue
    }
    const tag = tagAt(text, pos)
    const gt = text.indexOf('>', tag.nameEnd)
    if (gt < 0) break
    const selfClosing = text[gt - 1] === '/'
    if (!tag.closing && root === null && tag.name) {
      root = tag.name
      if (!['urlset', 'sitemapindex', 'rss', 'feed', 'rdf'].includes(root)) return { kind: null, format: root === 'html' || looksHtml(text) ? 'html' : 'other', locs, lastmods }
    }
    const entryName = tag.name === 'url' || tag.name === 'sitemap' || tag.name === 'item' || tag.name === 'entry'
    if (entryName && !tag.closing && !selfClosing) {
      entry = { loc: null, lastmod: null }
      pos = text.indexOf('<', gt + 1)
      continue
    }
    if (entryName && tag.closing) {
      if (entry?.loc) {
        locs.push(entry.loc)
        lastmods.push(entry.lastmod)
      }
      entry = null
      pos = text.indexOf('<', gt + 1)
      continue
    }
    if (entry && !tag.closing) {
      // Atom: <link href="…"/>.
      if (tag.name === 'link' && root === 'feed') {
        const href = parseAttrs(text.slice(tag.nameEnd, selfClosing ? gt - 1 : gt)).href
        if (href && !entry.loc) entry.loc = href.trim()
        if (selfClosing) {
          pos = text.indexOf('<', gt + 1)
          continue
        }
      }
      const field = tag.name === 'loc' || (tag.name === 'link' && root !== 'feed') ? 'loc'
        : tag.name === 'lastmod' || tag.name === 'updated' || tag.name === 'pubdate' ? 'lastmod' : null
      if (field && !selfClosing) {
        const end = closingTag(text, gt + 1, tag.name)
        if (end === null) break
        // sitemaps.org: an address is under 2,048 characters. Past 8 KB it is junk either way,
        // and not decoding it keeps a hostile file cheap.
        const value = xmlText(text.slice(gt + 1, Math.min(end.start, gt + 1 + 8192)))
        if (field === 'loc' && !entry.loc && value) entry.loc = value
        if (field === 'lastmod' && !entry.lastmod && value) entry.lastmod = value
        pos = text.indexOf('<', end.after)
        continue
      }
    }
    pos = text.indexOf('<', gt + 1)
  }
  const kind = root === 'sitemapindex' ? 'index' : root === null ? null : 'urlset'
  const format = root === 'rss' || root === 'feed' || root === 'rdf' ? 'feed' : root === null ? 'other' : 'xml'
  return { kind, format, locs, lastmods }
}

/** Where `</name>` (any prefix) starts after `from`, and where it ends. null = never closed.
 *  Each `</` is looked at once. */
function closingTag(text: string, from: number, name: string): { start: number; after: number } | null {
  let i = from
  for (;;) {
    const at = text.indexOf('</', i)
    if (at < 0) return null
    const tag = tagAt(text, at)
    if (tag.name === name) {
      const gt = text.indexOf('>', tag.nameEnd)
      if (gt < 0) return null
      return { start: at, after: gt + 1 }
    }
    i = at + 2
  }
}

function looksHtml(text: string): boolean {
  const head = text.slice(0, 4096).toLowerCase()
  return head.includes('<html') || head.includes('<!doctype html') || head.includes('<body') || head.includes('<head')
}

/** A fetched sitemap's bytes as text: gzip unpacked (to a cap), else decoded as UTF-8. */
function sitemapText(bytes: Uint8Array | null, contentType: string | undefined): { text: string | null; tooBig: boolean } {
  if (!bytes) return { text: null, tooBig: false }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: false }).decode(gunzipSync(bytes, { maxOutputLength: SITEMAP_UNZIPPED_MAX })), tooBig: false }
    } catch (e) {
      const tooBig = e instanceof RangeError || (e as { code?: string })?.code === 'ERR_BUFFER_TOO_LARGE'
      return { text: null, tooBig }
    }
  }
  // sitemaps.org: a sitemap is UTF-8. The header's charset is ignored, as Google does.
  void contentType
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), tooBig: false }
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

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    }, { once: true })
  })
}

/* ── the run ───────────────────────────────────────────────────────────────────────── */

function noAnswer(path: string, error: string): SeoPageFetch {
  return { path, finalUrl: null, status: null, headers: {}, html: null, error }
}

type Visited = { r: GuardedResponse; text: string | null; error: string | null }

function reachOf(home: SeoPageFetch): NonNullable<SeoEvidence['reach']> {
  const s = home.status
  if (s == null) {
    // A redirect we refused to follow is still an answer from the site.
    if (/^not-(allowed|public): /.test(home.error ?? '')) return { state: 'answered', status: null, error: home.error }
    return { state: 'no-answer', status: null, ...(home.error ? { error: home.error } : {}) }
  }
  if (s >= 500) return { state: 'server-error', status: s }
  if (s === 401 || s === 403 || s === 429) return { state: 'refused', status: s }
  return { state: 'answered', status: s }
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
      robots: { status: null, body: null, error: 'not-public' }, sitemap: null,
      reach: { state: 'no-answer', status: null, error: 'not-public' },
    }
  }

  const began = Date.now()
  const runSignal = AbortSignal.timeout(budgetMs)
  // Every request of the run listens to this one signal (~70 of them): not a leak.
  setMaxListeners(0, runSignal)
  const allow = (url: string) => sameSite(url, start)
  const outOfTime = () => runSignal.aborted || Date.now() - began >= budgetMs

  /** One guarded visit, as bytes, decoded in the document's charset. One more try when there
   *  was NO answer (dropped, timed out) and the budget allows; never after an answer. Names
   *  where a refused redirect pointed. */
  const visit = async (url: string, userAgent: string, maxBytes: number, accept: string, utf8Only = false): Promise<Visited> => {
    const once = async (): Promise<Visited> => {
      if (outOfTime()) return { r: { status: null, finalUrl: null, hops: 0, headers: {}, text: null, bytes: null, truncated: false }, text: null, error: 'out-of-time' }
      let lastLocation: string | null = null
      const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
        const here = String(input)
        const signal = init?.signal ? AbortSignal.any([init.signal, runSignal]) : runSignal
        const headers = new Headers(init?.headers)
        headers.set('accept', accept)
        const res = await base(input, { ...init, headers, signal })
        try {
          const loc = res.headers?.get?.('location')
          lastLocation = loc ? new URL(loc, here).toString() : null
        } catch {
          lastLocation = null
        }
        return res
      }) as typeof fetch
      const r = await guardedFetch(url, { fetcher, userAgent, timeoutMs, maxBytes, allow, as: 'bytes' })
      // robots.txt MUST be UTF-8 (RFC 9309), and Google reads anything else as junk: so do we.
      const text = r.bytes ? (utf8Only ? new TextDecoder('utf-8', { fatal: false }).decode(r.bytes) : decodeBody(r.bytes, r.headers['content-type'])) : null
      let error: string | null = null
      if (r.status == null && r.error === 'timeout' && runSignal.aborted) error = 'out-of-time'
      else if (r.error) error = (r.error === 'not-allowed' || r.error === 'not-public') && lastLocation ? `${r.error}: ${lastLocation}` : r.error
      return { r, text, error }
    }
    const first = await once()
    const dropped = first.r.status == null && (first.error === 'network' || first.error === 'timeout')
    if (!dropped || outOfTime() || budgetMs - (Date.now() - began) < RETRY_PAUSE_MS + 500) return first
    await pause(RETRY_PAUSE_MS, runSignal)
    return once()
  }

  const toPage = (path: string, { r, text, error }: Visited): SeoPageFetch => {
    const fetched: SeoPageFetch = {
      path,
      finalUrl: r.finalUrl,
      status: r.status,
      headers: keepHeaders(r.headers),
      html: is2xx(r.status) && isHtmlType(r.headers['content-type'], text) ? text : null,
    }
    if (error) fetched.error = error
    if (r.truncated) fetched.truncated = true
    return fetched
  }

  // 1. The home page, as a person. Where it lands is the origin for the rest.
  const home = toPage('/', await visit(`${start}/`, BROWSER_UA, PAGE_MAX_BYTES, PAGE_ACCEPT))
  let site = start
  if (home.finalUrl && sameSite(home.finalUrl, start)) site = new URL(home.finalUrl).origin

  // 2. robots.txt and Bing's file, side by side.
  const [robotsR, bingR] = await Promise.all([
    visit(`${site}/robots.txt`, BROWSER_UA, ROBOTS_READ_BYTES, '*/*', true),
    visit(`${site}/BingSiteAuth.xml`, BROWSER_UA, 64 * 1024, '*/*'),
  ])
  const robots: SeoEvidence['robots'] = { status: robotsR.r.status, body: is2xx(robotsR.r.status) ? robotsR.text : null }
  if (robotsR.error && robotsR.r.status == null) robots.error = robotsR.error
  const bingText = is2xx(bingR.r.status) ? bingR.text ?? '' : ''
  const bing = {
    siteAuth: {
      status: bingR.r.status,
      // Bing's codes are 32 hex characters. A catch-all html page, or a placeholder, is not one.
      hasUser: bingText.toLowerCase().includes('<users') && /<user>\s*[0-9a-f]{32}\s*<\/user>/i.test(bingText),
    },
  }

  // 3. The sitemap: each same-site line robots.txt names, then /sitemap.xml, until one reads.
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
  const namedElsewhere = named.filter((s) => !sameSite(s, site))
  const candidates = [...new Set([...namedHere.slice(0, MAX_NAMED_SITEMAPS), `${site}/sitemap.xml`])]
  const tried: { url: string; status: number | null; visited: Visited; parsed: ParsedSitemap; tooBig: boolean }[] = []
  for (const url of candidates) {
    const got = await visit(url, BROWSER_UA, SITEMAP_MAX_BYTES, '*/*')
    const body = is2xx(got.r.status) ? sitemapText(got.r.bytes, got.r.headers['content-type']) : { text: null, tooBig: false }
    const parsed: ParsedSitemap = body.text !== null ? parseSitemap(body.text) : { kind: null, format: 'other', locs: [], lastmods: [] }
    tried.push({ url, status: got.r.status, visited: got, parsed, tooBig: body.tooBig })
    if (parsed.kind !== null) break
  }
  // The one we report: the first that read, else the first that answered 2xx (so "it's a web
  // page" can be said), else the first we tried.
  const main = tried.find((t) => t.parsed.kind !== null) ?? tried.find((t) => is2xx(t.status)) ?? tried[0]
  const offSite: string[] = []
  const badLocs: string[] = []
  let locs: string[] = []
  let lastmods: (string | null)[] = []
  let truncated = main.visited.r.truncated || main.tooBig
  let children: { url: string; status: number | null }[] | undefined
  let childTotal: number | undefined
  if (main.parsed.kind === 'urlset') {
    locs = main.parsed.locs
    lastmods = main.parsed.lastmods
  } else if (main.parsed.kind === 'index') {
    const here: string[] = []
    for (const u of main.parsed.locs) {
      if (sameSite(u, site)) here.push(u)
      else offSite.push(u)
    }
    childTotal = here.length
    const childUrls = here.slice(0, MAX_CHILD_SITEMAPS)
    const got = await pool(childUrls.map((u) => () => visit(u, BROWSER_UA, SITEMAP_MAX_BYTES, '*/*')), CONCURRENCY)
    children = childUrls.map((url, i) => ({ url, status: got[i].r.status }))
    got.forEach(({ r }) => {
      truncated ||= r.truncated
      if (!is2xx(r.status)) return
      const body = sitemapText(r.bytes, r.headers['content-type'])
      truncated ||= body.tooBig
      if (body.text === null) return
      const child = parseSitemap(body.text)
      // One level only: an index inside an index is not followed.
      if (child.kind !== 'urlset') return
      locs.push(...child.locs)
      lastmods.push(...child.lastmods)
    })
  }
  const here: number[] = []
  let otherSpelling = 0
  const siteOrigin = new URL(site).origin
  locs.forEach((u, i) => {
    let parsed: URL | null = null
    try {
      parsed = new URL(u)
    } catch {
      parsed = null
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) badLocs.push(u)
    else if (sameSite(u, site)) {
      here.push(i)
      if (parsed.origin !== siteOrigin) otherSpelling++
    } else offSite.push(u)
  })
  const sitemap: NonNullable<SeoEvidence['sitemap']> = {
    status: main.status,
    urls: here.slice(0, SITEMAP_KEEP).map((i) => locs[i]),
    lastmods: here.slice(0, SITEMAP_KEEP).map((i) => lastmods[i]),
    url: main.url,
    parsed: main.parsed.kind !== null,
    format: main.parsed.format,
    namedInRobots: namedHere.length > 0,
    total: here.length,
    offSite: { count: offSite.length, examples: offSite.slice(0, 3) },
  }
  if (badLocs.length) sitemap.badLocs = { count: badLocs.length, examples: badLocs.slice(0, 3) }
  if (otherSpelling) sitemap.otherSpelling = otherSpelling
  if (tried.length > 1) sitemap.tried = tried.map((t) => ({ url: t.url, status: t.status }))
  if (namedElsewhere.length) sitemap.namedElsewhere = namedElsewhere.slice(0, 3)
  if (truncated) sitemap.truncated = true
  if (children) sitemap.children = children
  if (childTotal !== undefined) sitemap.childTotal = childTotal
  if (main.visited.error && main.status == null) sitemap.error = main.visited.error

  // 4. The pages: the artist's key pages first, from the sitemap or the home page's links.
  const listed: string[] = []
  for (const i of here) {
    const p = pathOf(locs[i])
    if (!listed.includes(p)) listed.push(p)
    if (listed.length >= 200) break
  }
  const linked: string[] = []
  if (home.html) {
    const from = home.finalUrl ?? `${site}/`
    for (const href of parsePage(home.html).links.slice(0, 500)) {
      let u: URL
      try {
        u = new URL(href, from)
      } catch {
        continue
      }
      if (!sameSite(u.toString(), site) || FILE_LINK.test(u.pathname)) continue
      const p = u.pathname || '/'
      if (p !== '/' && p !== new URL(from).pathname && !linked.includes(p)) linked.push(p)
    }
  }
  const key = (p: string) => KEY_PAGE.test(p)
  const paths = ['/']
  for (const p of [...listed.filter(key), ...linked.filter(key), ...listed, ...linked]) {
    if (paths.length >= maxPaths) break
    if (!paths.includes(p)) paths.push(p)
  }
  type Job = { who: 'plain' | string; path: string; ua: string }
  const jobs: Job[] = []
  for (const path of paths) {
    if (path !== '/') jobs.push({ who: 'plain', path, ua: BROWSER_UA })
    for (const bot of FETCHING_BOTS) jobs.push({ who: bot.key, path, ua: bot.userAgent ?? BROWSER_UA })
  }
  const answers = await pool(jobs.map((j) => async () => toPage(j.path, await visit(`${site}${j.path}`, j.ua, PAGE_MAX_BYTES, PAGE_ACCEPT))), CONCURRENCY)
  const plain: SeoPageFetch[] = [home]
  const byBot: Record<string, SeoPageFetch[]> = Object.fromEntries(FETCHING_BOTS.map((b) => [b.key, [] as SeoPageFetch[]]))
  jobs.forEach((j, i) => (j.who === 'plain' ? plain : byBot[j.who]).push(answers[i]))

  return { origin: site, gatheredAt, paths, plain, byBot, robots, sitemap, bing, reach: reachOf(home) }
}
