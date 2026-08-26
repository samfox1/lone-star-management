/**
 * auditSeo — CONNECTING §7 rule 6 as code (SEO_GEO_PLAN B5). Each rule is proven by a
 * page that breaks ONLY it; a page with all of them passes with [].
 */
import { describe, expect, it } from 'vitest'
import { auditSeo } from '@samfox1/site-bridge/seo'

const GOOD = `<html><head>
<meta name="description" content="Meet Skeen, a Chicago DJ, producer and filmmaker making house and techno for dark rooms.">
<link rel="canonical" href="https://www.example.com">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[]}</script>
</head><body>
<section id="home"><h1><img src="https://cdn/x/logo.png" alt="Skeen"></h1></section>
<section id="shows"><h2>Tour</h2></section>
<section id="work"><h2 class="sr-only">Music</h2><img src="https://cdn/x/night-drive.jpg" alt="Night Drive cover art"><img src="/car.png" alt="" aria-hidden="true"></section>
</body></html>`
const EDIT = `<html><head><meta name="robots" content="noindex, nofollow"></head><body></body></html>`
const rules = (findings: { rule: string }[]) => [...new Set(findings.map((f) => f.rule))]

describe('auditSeo', () => {
  it('a findable page returns no findings', () => {
    expect(auditSeo({ home: GOOD, edit: EDIT })).toEqual([])
  })
  it('short description', () => {
    expect(rules(auditSeo({ home: GOOD.replace(/content="[^"]*"/, 'content="Skeen"') }))).toEqual(['description'])
  })
  it('missing canonical, missing or broken JSON-LD', () => {
    expect(rules(auditSeo({ home: GOOD.replace(/<link rel="canonical"[^>]*>/, '') }))).toEqual(['canonical'])
    expect(rules(auditSeo({ home: GOOD.replace(/<script[\s\S]*?<\/script>/, '') }))).toEqual(['json-ld'])
    expect(rules(auditSeo({ home: GOOD.replace('"@graph":[]}', '"@graph":[') }))).toEqual(['json-ld'])
  })
  it('CRITICAL: exactly one h1, and a heading in every section', () => {
    expect(rules(auditSeo({ home: GOOD.replace('<h2>Tour</h2>', '<h1>Tour</h1>') }))).toEqual(['h1'])
    expect(rules(auditSeo({ home: GOOD.replace('<h2>Tour</h2>', '') }))).toEqual(['headings'])
  })
  it('CRITICAL: images — empty alt on content, no alt at all, and /_next/image src', () => {
    expect(rules(auditSeo({ home: GOOD.replace('alt="Night Drive cover art"', 'alt=""') }))).toEqual(['alt'])
    expect(rules(auditSeo({ home: GOOD.replace(' alt="Night Drive cover art"', '') }))).toEqual(['alt'])
    expect(rules(auditSeo({ home: GOOD.replace('src="https://cdn/x/night-drive.jpg"', 'src="/_next/image?url=x"') }))).toEqual(['src'])
  })
  it('robots: the homepage must not be noindex; /edit must be', () => {
    expect(rules(auditSeo({ home: GOOD.replace('<head>', '<head><meta name="robots" content="noindex">') }))).toEqual(['robots'])
    expect(rules(auditSeo({ home: GOOD, edit: '<html><head></head></html>' }))).toEqual(['robots'])
    expect(auditSeo({ home: GOOD, edit: null })).toEqual([])
  })
})
