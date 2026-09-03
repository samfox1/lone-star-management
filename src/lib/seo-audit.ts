/**
 * The live findability check behind the SEO / GEO page's "Run check" (SEO_GEO_PLAN).
 * Fetches the PUBLIC site the way a crawler does and runs the bridge's audits over the
 * html it gets back — the same rules a connected site's build test runs, so the page
 * and the build can never disagree about what "findable" means.
 */
import { SEO_RULES, auditGeoFacts, auditJsonLd, auditSeo, type SeoFinding } from '@samfox1/site-bridge/seo'
import { isPublicSiteUrl } from './custom-site'

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
 *  was refused before it left, or ran out of redirect hops). */
type Fetched = { status: number | null; body: string | null }

const NOT_FETCHED: Fetched = { status: null, body: null }
/** apex → www is one hop, http → https another. Three is generous; the fourth is a loop. */
const MAX_HOPS = 3

/**
 * Fetch a url the server was told about by a MANAGER, never following it anywhere it
 * should not go. Every hop is re-checked against `isPublicSiteUrl`, because a public host
 * can 302 straight to `http://169.254.169.254/` and node's fetch would follow it happily.
 * Redirects are therefore taken by hand (`redirect: 'manual'`) rather than by the client.
 */
async function fetchGuarded(url: string, fetcher: typeof fetch): Promise<Fetched> {
  let target = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isPublicSiteUrl(target)) return NOT_FETCHED
    let r: Response
    try {
      r = await fetcher(target, { headers: { 'user-agent': 'lone-star-seo-check/1.0' }, cache: 'no-store', redirect: 'manual' })
    } catch {
      return NOT_FETCHED
    }
    const status = typeof r.status === 'number' ? r.status : r.ok ? 200 : 0
    if (status >= 300 && status < 400) {
      const location = r.headers?.get?.('location') ?? null
      let next: string | null = null
      try {
        next = location ? new URL(location, target).toString() : null
      } catch {
        next = null
      }
      if (!next) return { status, body: null }
      target = next
      continue
    }
    return { status, body: r.ok ? await r.text() : null }
  }
  return NOT_FETCHED
}

async function text(url: string, fetcher: typeof fetch): Promise<string | null> {
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

/** Visible text of an html page, roughly: scripts/styles dropped, tags stripped,
 *  entities turned back into the characters the manager actually typed. */
function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
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
  const base = origin.replace(/\/+$/, '')
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
  const ld = home.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  let graph: Record<string, number> = {}
  let releaseKinds: Record<string, number> = {}
  if (ld) {
    const summary = auditJsonLd(ld[1])
    graph = summary.counts
    releaseKinds = summary.kinds
    for (const f of summary.findings) findings.push({ rule: f.rule === 'json-ld' ? 'json-ld' : 'facts', problem: f.problem })
    try {
      findings.push(...auditGeoFacts(JSON.parse(ld[1])))
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
