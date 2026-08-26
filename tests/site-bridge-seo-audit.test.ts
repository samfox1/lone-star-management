/**
 * auditSeo — CONNECTING §7 rule 6 as code (SEO_GEO_PLAN B5). Each rule is proven by a
 * page that breaks ONLY it; a page with all of them passes with [].
 */
import { describe, expect, it } from 'vitest'
import { auditJsonLd, auditSeo } from '@samfox1/site-bridge/seo'

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

describe('auditJsonLd — the fields Google requires', () => {
  const graph = (nodes: unknown[]) => JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes })
  it('a complete sheet passes and is counted by type', () => {
    const r = auditJsonLd(graph([
      { '@type': 'MusicGroup', name: 'Skeen', url: 'https://x/' },
      { '@type': 'WebSite', name: 'Skeen', url: 'https://x/' },
      { '@type': 'MusicEvent', name: 'Skeen at V', startDate: '2026-09-01', location: { '@type': 'Place', name: 'V', address: { '@type': 'PostalAddress', addressLocality: 'C' } } },
      { '@type': 'MusicAlbum', name: 'EP', byArtist: { '@id': 'a' }, track: [{ '@type': 'MusicRecording', name: 'S', byArtist: { '@id': 'a' } }] },
    ]))
    expect(r.findings).toEqual([])
    expect(r.counts).toEqual({ MusicGroup: 1, WebSite: 1, MusicEvent: 1, MusicAlbum: 1, MusicRecording: 1 })
    expect(r.kinds).toEqual({ other: 1 }) // no albumReleaseType stated
  })
  it('releases are counted by KIND — a single is a MusicAlbum node too (Sam: "they just aren\'t all albums")', () => {
    const r = auditJsonLd(graph([
      { '@type': 'MusicAlbum', name: 'A', byArtist: { '@id': 'a' }, albumReleaseType: 'https://schema.org/AlbumRelease' },
      { '@type': 'MusicAlbum', name: 'B', byArtist: { '@id': 'a' }, albumReleaseType: 'https://schema.org/SingleRelease' },
      { '@type': 'MusicAlbum', name: 'C', byArtist: { '@id': 'a' }, albumReleaseType: 'https://schema.org/SingleRelease' },
      { '@type': 'MusicAlbum', name: 'D', byArtist: { '@id': 'a' }, albumReleaseType: 'https://schema.org/EPRelease' },
    ]))
    expect(r.counts.MusicAlbum).toBe(4)
    expect(r.kinds).toEqual({ album: 1, single: 2, ep: 1 })
  })
  it('CRITICAL: a missing required field is named, per node — nested tracks included', () => {
    const r = auditJsonLd(graph([
      { '@type': 'MusicEvent', name: 'X', startDate: '2026-09-01' },
      { '@type': 'VideoObject', name: 'V', thumbnailUrl: 'https://t', uploadDate: '2026-01-01' },
      { '@type': 'MusicAlbum', name: 'EP', byArtist: { '@id': 'a' }, track: [{ '@type': 'MusicRecording', byArtist: { '@id': 'a' } }] },
    ]))
    expect(r.findings.map((f) => f.problem)).toEqual([
      'MusicEvent #1 is missing location',
      'VideoObject #2 is missing description',
      'MusicAlbum #3 track 1 is missing name',
    ])
  })
  it('a MusicEvent location must carry an ADDRESS (Google requires it)', () => {
    const r = auditJsonLd(graph([{ '@type': 'MusicEvent', name: 'X', startDate: '2026-09-01', location: { '@type': 'Place', name: 'V' } }]))
    expect(r.findings.map((f) => f.problem)).toEqual(['MusicEvent #1 location has no address'])
  })
  it('junk input is a finding, never a throw', () => {
    expect(auditJsonLd('{not json').findings[0].rule).toBe('json-ld')
    expect(auditJsonLd({ '@context': 'x' }).findings[0].problem).toBe('no @graph array')
  })
})
