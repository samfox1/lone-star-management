/**
 * The live findability check behind the SEO / GEO page's "Run check" (SEO_GEO_PLAN).
 * Fetches the PUBLIC site the way a crawler does and runs the bridge's audits over the
 * html it gets back — the same rules a connected site's build test runs, so the page
 * and the build can never disagree about what "findable" means.
 */
import { auditJsonLd, auditSeo, type SeoFinding } from '@samfox1/site-bridge/seo'

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

export const AUDIT_RULES: { rule: string; label: string }[] = [
  { rule: 'description', label: 'Meta description (60+ chars)' },
  { rule: 'canonical', label: 'Canonical URL' },
  { rule: 'h1', label: 'Exactly one H1' },
  { rule: 'headings', label: 'A heading in every section' },
  { rule: 'alt', label: 'Alt text on every content image' },
  { rule: 'src', label: 'Image URLs are direct (no /_next/image)' },
  { rule: 'json-ld', label: 'Fact sheet (JSON-LD) present and parses' },
  { rule: 'robots', label: 'Homepage indexable; /edit noindex' },
  { rule: 'facts', label: 'Fact sheet has every field Google requires' },
]

async function text(url: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const r = await fetcher(url, { headers: { 'user-agent': 'lone-star-seo-check/1.0' }, cache: 'no-store' })
    return r.ok ? await r.text() : null
  } catch {
    return null
  }
}

export async function auditLiveSite(origin: string, fetcher: typeof fetch = fetch): Promise<LiveAudit> {
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
  }
  const rules = AUDIT_RULES.map((r) => ({ ...r, problems: findings.filter((f) => f.rule === r.rule).map((f) => f.problem) }))
  const sitemap = sitemapXml
    ? {
        urls: [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
        lastmod: sitemapXml.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? null,
      }
    : null
  const robots = robotsTxt ? { ok: true, sitemap: /Sitemap:/i.test(robotsTxt) } : null
  return { url: base, ok: rules.every((r) => r.problems.length === 0), rules, graph, releaseKinds, sitemap, robots }
}
