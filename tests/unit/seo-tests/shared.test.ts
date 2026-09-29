/**
 * "Looks right when shared": share, preview, alt. The share picture is judged from the
 * fetched file (evidence.shareImage, share-image.ts), the rest from the LIVE html.
 */
import { describe, expect, it } from 'vitest'
import { SHARED_TESTS } from '@/lib/seo-tests/shared'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import type { SeoEvidence, SeoTestResult } from '@/lib/seo-tests/types'
import { OG_IMAGE, aboutHtml, evidence, homeHtml, known, page } from './_page-fixture'

const ev = (r: SeoTestResult, label: string) => r.evidence.find((e) => e.label === label)?.value
const JARGON = /json-ld|\bmeta\b|og:|canonical|schema|@type|sameAs/i
function plain(r: SeoTestResult) {
  expect(r.value.length).toBeLessThanOrEqual(28)
  expect(r.sentence).not.toMatch(JARGON)
  if (r.status === 'fail') expect(r.sentence).toMatch(/^[a-z0-9]/)
  if (r.todo) expect(r.todo).not.toMatch(JARGON)
}
type Img = NonNullable<SeoEvidence['shareImage']>
const img = (over: Partial<Img>): Img => ({ url: OG_IMAGE, status: 200, contentType: 'image/png', width: 1200, height: 630, bytes: 32_000, format: 'png', ...over })

describe('SHARED_TESTS', () => {
  it('covers exactly the "shared" ids in defs.ts', () => {
    const ids = SEO_TEST_DEFS.filter((d) => d.group === 'shared').map((d) => d.id).sort()
    expect(Object.keys(SHARED_TESTS).sort()).toEqual(ids)
  })
  it('is unknown for every test when the home page did not answer', () => {
    for (const [id, test] of Object.entries(SHARED_TESTS)) {
      const r = test(evidence({ pages: [page('/', null, null, { error: 'network' })], shareImage: null }))
      expect(r.id).toBe(id)
      expect(r.status).toBe('unknown')
    }
  })
})

describe('share', () => {
  const s = SHARED_TESTS.share
  const withImg = (over: Partial<Img>) => s(evidence({ shareImage: img(over) }))
  it('passes a 1200×630 PNG, and says what it saw', () => {
    const r = s(evidence())
    expect(r.status).toBe('pass')
    expect(ev(r, 'size')).toBe('1200 × 630 · PNG · 31 KB')
    plain(r)
  })
  it('passes 2:1 pictures (1200×600, 1600×800)', () => {
    expect(withImg({ width: 1200, height: 600 }).status).toBe('pass')
    expect(withImg({ width: 1600, height: 800 }).status).toBe('pass')
  })
  it('calls it the "preview picture" in every word a manager reads (Sam, 2026-09-29)', () => {
    const cases: Partial<Img>[] = [{}, { status: 404 }, { status: 403 }, { status: null, error: 'not-https' }, { width: 600, height: 315 }, { contentType: 'text/html', format: null }]
    const results = [...cases.map((c) => withImg(c)), s(evidence({ home: homeHtml({ og: { 'og:image': null } }), shareImage: null }))]
    for (const r of results) {
      const shown = [r.value, r.sentence, r.todo, r.good, r.limits, r.action?.label].filter(Boolean).join(' | ')
      expect(shown).not.toMatch(/share (picture|image)/i)
    }
    expect(results[1].sentence).toMatch(/preview picture/)
  })
  it('fails when the page names no share picture', () => {
    const r = s(evidence({ home: homeHtml({ og: { 'og:image': null } }), shareImage: null }))
    expect(r.status).toBe('fail')
    expect(r.action).toEqual(expect.objectContaining({ kind: 'edit', target: 'share' }))
    plain(r)
  })
  it('is unknown when the page names a picture we did not open', () => {
    expect(s(evidence({ shareImage: null })).status).toBe('unknown')
  })
  it('is unknown when the picture did not answer (timeout, network)', () => {
    expect(withImg({ status: null, error: 'timeout', contentType: null, width: null, height: null, bytes: null, format: undefined }).status).toBe('unknown')
    expect(withImg({ status: null, error: 'network', contentType: null, width: null, height: null, bytes: null, format: undefined }).status).toBe('unknown')
  })
  it('fails a picture no one can load: http, a redirect to http, a private address, a bad address', () => {
    for (const error of ['not-https', 'redirect-not-https', 'not-public', 'bad-url']) {
      const r = withImg({ status: null, error, contentType: null, width: null, height: null, bytes: null, format: undefined })
      expect(r.status, error).toBe('fail')
      plain(r)
    }
  })
  it('fails a broken link (404)', () => {
    const r = withImg({ status: 404, contentType: 'text/html', width: null, height: null, format: null })
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/404/)
  })
  it('fails something that is not a picture, whatever it claims', () => {
    expect(withImg({ contentType: 'text/html', format: null, width: null, height: null }).status).toBe('fail')
    // The header says PNG; the bytes say otherwise.
    expect(withImg({ contentType: 'image/png', format: null, width: null, height: null }).status).toBe('fail')
    // The bytes say PNG; the header says html (some apps trust the header).
    expect(withImg({ contentType: 'text/html' }).status).toBe('fail')
  })
  it('fails an svg (sharing apps do not show them)', () => {
    expect(withImg({ contentType: 'image/svg+xml', format: 'svg', width: null, height: null }).status).toBe('fail')
  })
  it('is unknown for a picture format we cannot measure', () => {
    expect(withImg({ contentType: 'image/avif', format: 'avif', width: null, height: null }).status).toBe('unknown')
  })
  it('fails a cut-off file', () => {
    // Size read from the header, but the file stops short of its stated length.
    expect(withImg({ broken: true }).status).toBe('fail')
    expect(withImg({ broken: true }).value).toBe('broken file')
    expect(withImg({ format: 'jpeg', contentType: 'image/jpeg', width: null, height: null }).status).toBe('fail')
  })
  it('fails a file over 5 MB', () => {
    expect(withImg({ bytes: 6_000_000 }).status).toBe('fail')
    expect(withImg({ bytes: 5 * 1024 * 1024, tooBig: true }).status).toBe('fail')
    expect(withImg({ bytes: 4_900_000 }).status).toBe('pass')
  })
  it('fails a 1×1 tracking gif', () => {
    const r = withImg({ contentType: 'image/gif', format: 'gif', width: 1, height: 1, bytes: 43 })
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
  })
  it('fails a small picture softly (blurry)', () => {
    const r = withImg({ width: 600, height: 315 })
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
    expect(r.good).toMatch(/1200 × 630/)
  })
  it('fails a square picture softly (cropped)', () => {
    const r = withImg({ width: 1200, height: 1200 })
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/crop/)
  })
})

describe('preview', () => {
  const p = SHARED_TESTS.preview
  const withOg = (og: Record<string, string | null>) => p(evidence({ home: homeHtml({ og }) }))
  it('passes a title, summary, address and card size that agree', () => {
    const r = p(evidence())
    expect(r.status).toBe('pass')
    expect(ev(r, 'shared title')).toBe('Skeen · Chicago house DJ and producer')
    plain(r)
  })
  it('fails with no shared title, or one without the name', () => {
    expect(withOg({ 'og:title': null }).status).toBe('fail')
    expect(withOg({ 'og:title': 'Chicago house DJ' }).status).toBe('fail')
  })
  it('fails with no shared summary, or only the name', () => {
    expect(withOg({ 'og:description': null }).status).toBe('fail')
    expect(withOg({ 'og:description': 'Skeen — official site' }).status).toBe('fail')
  })
  it('fails an address that is missing, on another site, or another page', () => {
    expect(withOg({ 'og:url': null }).status).toBe('fail')
    const r = withOg({ 'og:url': 'https://skeen-website.vercel.app/' })
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/skeen-website\.vercel\.app/)
    expect(withOg({ 'og:url': 'https://www.example-artist.com/about' }).status).toBe('fail')
  })
  it('passes the address with or without www, a trailing slash, or relative', () => {
    expect(withOg({ 'og:url': 'https://example-artist.com/' }).status).toBe('pass')
    expect(withOg({ 'og:url': 'https://www.example-artist.com/' }).status).toBe('pass')
    expect(withOg({ 'og:url': '/' }).status).toBe('pass')
  })
  it('fails softly with no card size for X', () => {
    const r = withOg({ 'twitter:card': null })
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
  })
  it('names every problem at once', () => {
    const r = withOg({ 'og:title': null, 'og:description': null })
    expect(r.sentence).toMatch(/title/)
    expect(r.sentence).toMatch(/description/)
    expect(r.lead).toBeUndefined()
  })
  it('decodes entities', () => {
    const r = withOg({ 'og:description': 'Skeen & friends: Chicago house, every weekend.' })
    expect(ev(r, 'shared description')).toBe('Skeen & friends: Chicago house, every weekend.')
  })
})

describe('alt', () => {
  const a = SHARED_TESTS.alt
  const withBody = (body: string, about: string | null = aboutHtml()) => a(evidence({ home: homeHtml({ body }), about }))
  it('passes when every content picture on every page has a description (decorative ones excluded)', () => {
    const r = a(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('2 of 2')
    plain(r)
  })
  it('fails a picture with no description, naming it', () => {
    const r = withBody('<img src="/gallery/one.jpg">')
    expect(r.status).toBe('fail')
    expect(r.value).toBe('2 of 3')
    expect(ev(r, 'without a description')).toMatch(/gallery\/one\.jpg/)
    expect(r.action).toEqual(expect.objectContaining({ target: 'alt' }))
    plain(r)
  })
  it('fails an empty description on a picture that is not marked decorative', () => {
    expect(withBody('<img src="/x.jpg" alt="">').status).toBe('fail')
    expect(withBody('<img src="/x.jpg" alt="   ">').status).toBe('fail')
  })
  it('fails a file name posing as a description', () => {
    expect(withBody('<img src="/x.jpg" alt="IMG_1234.JPG">').status).toBe('fail')
    expect(withBody('<img src="/x.jpg" alt="image">').status).toBe('fail')
  })
  it('skips decorative pictures: aria-hidden, role presentation/none, hidden, 1×1 pixels', () => {
    const body = '<img src="/a.jpg" alt="" role="presentation"><img src="/b.jpg" role="none"><img src="/c.jpg" hidden><img src="/px.gif" width="1" height="1">'
    expect(withBody(body).status).toBe('pass')
  })
  it('skips pictures inside noscript, svg and template (duplicates or not shown)', () => {
    const body = '<noscript><img src="/n.jpg"></noscript><template><img src="/t.jpg"></template><svg><img src="/s.jpg"/></svg>'
    expect(withBody(body).status).toBe('pass')
  })
  it('counts the same picture on two pages once', () => {
    const r = withBody('<img src="/about.jpg" alt="Skeen, Concord Music Hall">')
    expect(r.value).toBe('2 of 2')
  })
  it('reads a description with entities as a description', () => {
    expect(withBody('<img src="/x.jpg" alt="Skeen &amp; band">').status).toBe('pass')
  })
  it('CRITICAL: does not apply (`na`) with no photos on the pages and none published in Tapir: nothing described is not a pass', () => {
    const r = a(evidence({ home: '<html><head><title>Skeen</title></head><body>hi</body></html>', about: null }))
    expect(r.status).toBe('na')
    expect(r.value).toBe('no photos')
    // The page writes "Doesn't apply:" in front; the sentence gives the reason, not an echo.
    expect(r.sentence).toMatch(/no photos/)
  })
  it('CRITICAL: is unknown with no photos in the pages while Tapir has published some (a script may add them)', () => {
    const k = known({}, { photos: [{ url: 'https://cdn.example/p.jpg', alt: null }, { url: 'https://cdn.example/g.jpg', alt: 'On stage' }] })
    const r = a(evidence({ home: '<html><head><title>Skeen</title></head><body>hi</body></html>', about: null, known: k }))
    expect(r.status).toBe('unknown')
    expect(ev(r, 'in Tapir: photos')).toBe('2 published')
  })
  it('fails even when another page could not be read, if one picture is missing a description', () => {
    const r = a(evidence({ pages: [page('/', homeHtml({ body: '<img src="/z.jpg">' })), page('/about', null, null, { error: 'timeout' })] }))
    expect(r.status).toBe('fail')
  })
  it('is unknown when a page could not be read and the rest are fine', () => {
    const r = a(evidence({ pages: [page('/', homeHtml()), page('/about', null, null, { error: 'timeout' })] }))
    expect(r.status).toBe('unknown')
  })
  it('is unknown when a page was cut short', () => {
    const r = a(evidence({ pages: [page('/', homeHtml(), 200, { truncated: true })] }))
    expect(r.status).toBe('unknown')
  })
  it('ignores a page that is not there (404), which is another test’s problem', () => {
    const r = a(evidence({ pages: [page('/', homeHtml()), page('/gone', null, 404)] }))
    expect(r.status).toBe('pass')
  })
})
