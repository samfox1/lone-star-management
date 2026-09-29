/**
 * The live findability check behind the SEO / GEO page's "Run check" (SEO_GEO_PLAN).
 * Fetches the PUBLIC site the way a crawler does and runs the bridge's audits over the
 * html it gets back — the same rules a connected site's build test runs, so the page
 * and the build can never disagree about what "findable" means.
 */
import { SEO_RULES, auditGeoFacts, auditJsonLd, auditSeo, type SeoFinding } from '@samfox1/site-bridge/seo'
import { isPublicSiteUrl } from './custom-site'
import { trimTrailingSlashes } from './url'
import type { Resolver } from './net-guard'
import { guardedFetch } from './seo-tests/guarded-fetch'

export type LiveAudit = {
  url: string
  ok: boolean
  /** Rule → [] (pass) or the problems found. Every rule is listed, passed or not. */
  rules: { rule: string; label: string; problems: string[] }[]
  /** What the fact sheet states, by @type. */
  graph: Record<string, number>
  /** Releases by kind (album / ep / single / other): every release is a MusicAlbum node. */
  releaseKinds: Record<string, number>
  /** Sitemap facts a crawler would see. */
  sitemap: { urls: string[]; lastmod: string | null } | null
  robots: { ok: boolean; sitemap: boolean } | null
  error?: string
}

/** Derived from the bridge's registry (AGENTS.md rule 4), never listed here. */
export const AUDIT_RULES: readonly { rule: string; label: string }[] = SEO_RULES

/** What a fetch found: the body when it was 2xx, and the http status (null = it threw,
 *  was refused before it left, or ran out of redirect hops). `url` and `headers` belong to
 *  the LAST hop, the one that answered: set whenever a response that is not a redirect came
 *  back (the IndexNow ping reads where the key file really lives, and its version header).
 *  `truncated`: the body was longer than the cap and is only its start. */
type Fetched = { status: number | null; body: string | null; url?: string; headers?: Headers; truncated?: boolean }

const NOT_FETCHED: Fetched = { status: null, body: null }
/** Per hop, and for the whole call. The IndexNow ping runs this on every Publish. */
const FETCH_TIMEOUT_MS = 10_000
const FETCH_DEADLINE_MS = 20_000
/** A home page, a sitemap or a key file. The transport inflates gzip, so without a cap a few
 *  hundred KB on the wire could be gigabytes in memory (security review 2026-09-29, F3). */
const FETCH_MAX_BYTES = 2 * 1024 * 1024

/**
 * Fetch a url the server was told about by a MANAGER, never following it anywhere it should
 * not go, never reading more than FETCH_MAX_BYTES, never waiting past the deadline.
 *
 * A thin wrapper over the SEO tests' `guardedFetch` (lib/seo-tests/guarded-fetch), so both
 * guarded fetches share one walk: every hop re-checked against `isPublicSiteUrl` (a public host
 * can 302 straight to `http://169.254.169.254/`), where each NAME points checked at connect by
 * lib/net-guard's transport (the default, and what the global `fetch` is swapped for), a capped
 * body read that races the timeout. `fetcher` is for tests, or a production wrapper around
 * `pickTransport()`.
 */
export async function fetchGuarded(
  url: string,
  fetcher?: typeof fetch,
  opts: { resolver?: Resolver; timeoutMs?: number; maxBytes?: number } = {},
): Promise<Fetched> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS
  const r = await guardedFetch(url, {
    fetcher,
    resolver: opts.resolver,
    userAgent: 'lone-star-seo-check/1.0',
    timeoutMs,
    deadlineMs: Math.max(timeoutMs, FETCH_DEADLINE_MS),
    maxBytes: opts.maxBytes ?? FETCH_MAX_BYTES,
  })
  if (r.status === null) return NOT_FETCHED
  if (r.error === 'bad-redirect') return { status: r.status, body: null }
  const ok = r.status >= 200 && r.status < 300
  const body = ok && !r.error ? r.text : null
  return { status: r.status, body, url: r.finalUrl ?? undefined, headers: new Headers(r.headers), ...(r.truncated ? { truncated: true } : {}) }
}

async function text(url: string, fetcher?: typeof fetch): Promise<string | null> {
  return (await fetchGuarded(url, fetcher)).body
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** `&#x27;` → `'`. React escapes the apostrophes, quotes and ampersands a bio is full of,
 *  so text compared against the RAW bio has to be decoded, not blanked (review, M2). */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const lower = body.toLowerCase()
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[lower] ?? whole
  })
}

/** `html` with every `<tag…</tag>` block (first close after each open, as a lazy match
 *  would) replaced by a space. Linear: once no close is left, no later open can have one. */
function dropBlocks(html: string, tag: string): string {
  const open = new RegExp(`<${tag}`, 'gi')
  const close = new RegExp(`</${tag}>`, 'gi')
  const out: string[] = []
  let from = 0
  for (let m = open.exec(html); m; m = open.exec(html)) {
    close.lastIndex = m.index + tag.length + 1
    const c = close.exec(html)
    if (!c) break
    out.push(html.slice(from, m.index), ' ')
    from = close.lastIndex
    open.lastIndex = from
  }
  out.push(html.slice(from))
  return out.join('')
}

/** Every `<…>` (at least one character inside) replaced by a space. Linear: the first `>`
 *  after a `<` ends it, and once no `>` is left, no later `<` can start a tag. */
function dropTags(html: string): string {
  const out: string[] = []
  let from = 0
  let at = html.indexOf('<')
  while (at >= 0) {
    const gt = html.indexOf('>', at + 1)
    if (gt < 0) break
    if (gt === at + 1) {
      at = html.indexOf('<', at + 1)
      continue
    }
    out.push(html.slice(from, at), ' ')
    from = gt + 1
    at = html.indexOf('<', from)
  }
  out.push(html.slice(from))
  return out.join('')
}

/**
 * Visible text of an html page, roughly: scripts/styles dropped, tags stripped, entities
 * turned back into the characters the manager actually typed.
 *
 * Walked, not regexed: `/<script[\s\S]*?<\/script>/` and `/<[^>]+>/` rescanned to the end
 * of the page from every open that never closes, quadratic on a page the server fetched
 * (security review 2026-09-29, F4). Same answers as those regexes.
 */
export function visibleText(html: string): string {
  return decodeEntities(dropTags(dropBlocks(dropBlocks(html, 'script'), 'style')))
    .replace(/\s+/g, ' ')
    .trim()
}

const LD_TYPE = /type="application\/ld\+json"/gi

/**
 * The first JSON-LD block's text: the first `<script …type="application/ld+json"…>` (within
 * the tag) and everything up to the next `</script>`, or null. The same answer as the old
 * `/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i`, which was
 * worse than quadratic on a page of unclosed `<script` tags. Linear: the tag's end and the
 * next `type=` are found once and reused until the walk passes them.
 */
export function firstJsonLd(html: string): string | null {
  const open = /<script/gi
  let gt = -1
  let typeAt = -1
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const body = m.index + 7
    if (gt < body) gt = html.indexOf('>', body)
    if (gt < 0) return null
    if (typeAt < body) {
      LD_TYPE.lastIndex = body
      const t = LD_TYPE.exec(html)
      typeAt = t ? t.index : Number.POSITIVE_INFINITY
    }
    if (typeAt < gt) {
      const close = /<\/script>/gi
      close.lastIndex = gt + 1
      const c = close.exec(html)
      return c ? html.slice(gt + 1, c.index) : null
    }
  }
  return null
}

/** Same scheme, host and port as the site being audited. */
function sameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}

export async function auditLiveSite(
  origin: string,
  fetcher: typeof fetch = fetch,
  opts: { bio?: string | null } = {},
): Promise<LiveAudit> {
  const base = trimTrailingSlashes(origin)
  const blank = { url: base, ok: false, rules: [], graph: {}, releaseKinds: {}, sitemap: null, robots: null } satisfies Omit<LiveAudit, 'error'>
  // The one place the server fetches a manager-supplied address. A private / loopback /
  // link-local target is the server's own network, and this check reports fragments of
  // what it reads back to the browser — so it is refused here, before any request.
  if (!isPublicSiteUrl(base)) return { ...blank, error: 'That address is not a public website.' }
  const [home, edit, sitemapXml, robotsTxt] = await Promise.all([
    text(`${base}/`, fetcher),
    fetchGuarded(`${base}/edit`, fetcher),
    text(`${base}/sitemap.xml`, fetcher),
    text(`${base}/robots.txt`, fetcher),
  ])
  if (!home) return { ...blank, error: 'Could not fetch the site.' }
  // A 404 is an ANSWER — this site has no /edit page, so there is nothing to be indexed.
  // Anything else (429, 500, a thrown fetch) means nobody LOOKED, which is not a pass.
  const editError = edit.body == null && edit.status !== 404 ? (edit.status ? `HTTP ${edit.status}` : 'no response') : null
  const findings: SeoFinding[] = auditSeo({ home, edit: edit.body, editError })
  const ld = firstJsonLd(home)
  let graph: Record<string, number> = {}
  let releaseKinds: Record<string, number> = {}
  if (ld !== null) {
    const summary = auditJsonLd(ld)
    graph = summary.counts
    releaseKinds = summary.kinds
    for (const f of summary.findings) findings.push({ rule: f.rule === 'json-ld' ? 'json-ld' : 'facts', problem: f.problem })
    try {
      findings.push(...auditGeoFacts(JSON.parse(ld)))
    } catch {
      /* already reported by auditJsonLd */
    }
  }
  const sitemap = sitemapXml
    ? {
        urls: [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
        lastmod: sitemapXml.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? null,
      }
    : null
  // GEO: the bio must be VISIBLE somewhere a crawler lands — the homepage or any page the
  // sitemap names (that is where /about lives). The first sentence is the witness.
  const bio = (opts.bio ?? '').replace(/\s+/g, ' ').trim()
  if (bio) {
    const needle = bio.slice(0, 60).toLowerCase()
    const pages = [home]
    // A <loc> is text from a document the server was pointed at, so it is a request the
    // ATTACKER writes. Same-origin only: the bio lives on the artist's own site, and
    // nothing else here is worth a server-side fetch (review 2026-09-03, H1).
    for (const u of (sitemap?.urls ?? []).filter((x) => sameOrigin(x, base) && x.replace(/\/$/, '') !== base).slice(0, 10)) {
      const t = await text(u, fetcher)
      if (t) pages.push(t)
    }
    if (!pages.some((p) => visibleText(p).toLowerCase().includes(needle))) {
      findings.push({ rule: 'bio-visible', problem: 'the bio is not visible on the homepage or any sitemap page (only in meta / JSON-LD)' })
    }
  }
  const known = new Set(AUDIT_RULES.map((r) => r.rule))
  const rules = AUDIT_RULES.map((r) => ({
    ...r,
    problems: findings.filter((f) => (r.rule === 'other' ? !known.has(f.rule) : f.rule === r.rule)).map((f) => f.problem),
  })).filter((r) => r.rule !== 'other' || r.problems.length > 0)
  const robots = robotsTxt ? { ok: true, sitemap: /Sitemap:/i.test(robotsTxt) } : null
  return { url: base, ok: rules.every((r) => r.problems.length === 0), rules, graph, releaseKinds, sitemap, robots }
}
