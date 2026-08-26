/**
 * auditLiveSite — the SEO / GEO page's "Run check". A fake fetch serves a site; every
 * rule is listed pass or fail, the graph is counted, the sitemap and robots are read.
 */
import { describe, expect, it } from 'vitest'
import { AUDIT_RULES, auditLiveSite } from '@/lib/seo-audit'

const HOME = `<html><head>
<meta name="description" content="Meet Skeen, a Chicago DJ, producer and filmmaker making house and techno for dark rooms.">
<link rel="canonical" href="https://www.example.com">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"MusicGroup","name":"Skeen","url":"https://www.example.com/"},{"@type":"MusicEvent","name":"X","startDate":"2026-09-01"}]}</script>
</head><body><section id="home"><h1>Skeen</h1></section><section id="shows"><h2>Tour</h2><img src="https://cdn/x.jpg" alt="Skeen"></section></body></html>`
const EDIT = `<html><head><meta name="robots" content="noindex"></head></html>`
const SITEMAP = `<urlset><url><loc>https://www.example.com/</loc><lastmod>2026-08-22T00:00:00.000Z</lastmod></url><url><loc>https://www.example.com/about</loc></url></urlset>`
const ROBOTS = `User-agent: *\nAllow: /\nSitemap: https://www.example.com/sitemap.xml`

function fakeFetch(pages: Record<string, string | null>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const body = pages[String(url)]
    return { ok: body != null, text: async () => body ?? '' } as Response
  }) as typeof fetch
}

describe('auditLiveSite', () => {
  it('CRITICAL: lists EVERY rule, pass or fail, and surfaces a fact-sheet field Google requires', async () => {
    const r = await auditLiveSite('https://www.example.com/', fakeFetch({
      'https://www.example.com/': HOME,
      'https://www.example.com/edit': EDIT,
      'https://www.example.com/sitemap.xml': SITEMAP,
      'https://www.example.com/robots.txt': ROBOTS,
    }))
    expect(r.url).toBe('https://www.example.com')
    expect(r.rules.map((x) => x.rule)).toEqual(AUDIT_RULES.map((x) => x.rule))
    expect(r.ok).toBe(false)
    expect(r.rules.find((x) => x.rule === 'facts')!.problems).toEqual(['MusicEvent #2 is missing location'])
    expect(r.rules.filter((x) => x.rule !== 'facts').every((x) => x.problems.length === 0)).toBe(true)
    expect(r.graph).toEqual({ MusicGroup: 1, MusicEvent: 1 })
    expect(r.sitemap).toEqual({ urls: ['https://www.example.com/', 'https://www.example.com/about'], lastmod: '2026-08-22T00:00:00.000Z' })
    expect(r.robots).toEqual({ ok: true, sitemap: true })
  })
  it('an unreachable site is an error, not a pass', async () => {
    const r = await auditLiveSite('https://down.example.com', fakeFetch({}))
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    expect(r.rules).toEqual([])
  })
})
