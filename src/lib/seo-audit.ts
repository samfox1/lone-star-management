/**
 * The live findability check behind the SEO / GEO page's "Run check" (SEO_GEO_PLAN).
 * Fetches the PUBLIC site the way a crawler does and runs the bridge's audits over the
 * html it gets back — the same rules a connected site's build test runs, so the page
 * and the build can never disagree about what "findable" means.
 */
import { SEO_RULES, auditGeoFacts, auditJsonLd, auditSeo, type SeoFinding } from '@samfox1/site-bridge/seo'

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

async function text(url: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const r = await fetcher(url, { headers: { 'user-agent': 'lone-star-seo-check/1.0' }, cache: 'no-store' })
    return r.ok ? await r.text() : null
  } catch {
    return null
  }
}

/** Visible text of an html page, roughly: scripts/styles dropped, tags stripped. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function auditLiveSite(
  origin: string,
  fetcher: typeof fetch = fetch,
  opts: { bio?: string | null } = {},
): Promise<LiveAudit> {
  const base = origin.replace(/\/+$/, '')
  const [home, edit, sitemapXml, robotsTxt] = await Promise.all([
    text(`${base}/`, fetcher),
    text(`${base}/edit`, fetcher),
    text(`${base}/sitemap.xml`, fetcher),
    text(`${base}/robots.txt`, fetcher),
  ])
  if (!home) {
    return { url: base, ok: false, rules: [], graph: {}, releaseKinds: {}, sitemap: null, robots: null, error: 'Could not fetch the site.' }
  }
  const findings: SeoFinding[] = auditSeo({ home, edit })
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
    for (const u of (sitemap?.urls ?? []).filter((x) => x.replace(/\/$/, '') !== base).slice(0, 10)) {
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
