/**
 * Hostile input, TIMED (STRICT: security, AGENTS.md "Test depth"). Security review 2026-09-29,
 * F4: the readers that run on a site's fetched text were regexes that backtrack, and a regex
 * runs on the one JavaScript thread, where no timeout, AbortSignal or run budget can stop it.
 * A 32 KiB sitemap of `<lastmod>` + spaces took 27 s; a page of `<a href="` never closed was
 * ~153 s at its 1 MiB cap. While one runs, every request to the server waits.
 *
 * Each reader gets its worst known input at (or past) the size it is allowed to read, and must
 * finish in LIMIT_MS. The broken versions take 30 s to hours at these sizes; the fixed ones
 * take well under half a second (a 1 MiB page of `<a<a<a…` is ~0.4 s, most of it collapsing
 * the ~2 MB of text such a page produces). The limit leaves room for a noisy machine (the full
 * suite runs many workers at once, where 0.4 s became > 1 s, 2026-09-29) and still cannot pass by
 * luck: the broken versions take 27 s and up. The recorded corpus pins that normal and
 * merely-broken pages read exactly as before.
 */
import { describe, expect, it } from 'vitest'
import { sitemapLastmods } from '@/lib/seo-tests/fresh'
import { linkKey, parsePage } from '@/lib/seo-tests/html'
import { musicBrainzForms } from '@/lib/seo-tests/musicbrainz'
import { SHARED_TESTS } from '@/lib/seo-tests/shared'
import { firstJsonLd, visibleText } from '@/lib/seo-audit'
import { trimTrailingSlashes } from '@/lib/url'
import { PAGES, RECORDED, SITEMAPS } from '@tests/unit/seo-tests/parser-corpus'
import { ORIGIN, evidence, page } from '@tests/unit/seo-tests/_page-fixture'

const KIB = 1024
const MIB = 1024 * KIB
const LIMIT_MS = 5000

/** `unit` repeated to exactly `bytes` characters (all ASCII here, so characters = bytes). */
const fill = (unit: string, bytes: number) => unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes)

function within<T>(fn: () => T, what: string): T {
  const t = performance.now()
  const out = fn()
  const ms = performance.now() - t
  expect(ms, `${what} took ${ms.toFixed(0)} ms`).toBeLessThan(LIMIT_MS)
  return out
}

describe('sitemapLastmods (fresh.ts): polled on every Publish, before any claim', () => {
  const CAP = 512 * KIB // fresh.ts reads the sitemap with maxBytes 512 KiB
  it('CRITICAL: `<lastmod>` followed by a long run of spaces, repeated, at the cap', () => {
    within(() => sitemapLastmods(fill(`<lastmod>${' '.repeat(2000)}`, CAP)), 'lastmod + spaces')
  })
  it('CRITICAL: other shapes that make a lazy match rescan: never closed, a `<` inside, tabs', () => {
    for (const unit of ['<lastmod>x', '<lastmod>a<', `<lastmod>\t\n${'x'.repeat(500)}`, `<lastmod> ${'x '.repeat(400)}</lastmo`]) {
      within(() => sitemapLastmods(fill(unit, CAP)), JSON.stringify(unit.slice(0, 20)))
    }
  })
  it('reads the recorded sitemaps exactly as before', () => {
    expect(SITEMAPS.map((s) => sitemapLastmods(s))).toEqual(RECORDED.sitemaps)
  })
})

describe('parsePage (html.ts): every page a test reads', () => {
  const CAP = MIB // evidence.ts PAGE_MAX_BYTES
  it('CRITICAL: a tag that never closes, repeated to the cap (the reviewer’s ~153 s input)', () => {
    within(() => parsePage(fill('<a href="', CAP)), '<a href=" never closed')
  })
  it('CRITICAL: the other ways a tag can fail to close', () => {
    for (const unit of ['<a ', '<a', "<p '", '<a href="x" ', '<', '</a ', '<a b="1"c=\'', '<img alt="x" src=\'']) {
      within(() => parsePage(fill(unit, CAP)), JSON.stringify(unit))
    }
  })
  it('CRITICAL: raw elements that never close, and long tag names', () => {
    for (const unit of ['<script>', '<style', '<title>x', `<${'a'.repeat(5000)} `]) {
      within(() => parsePage(fill(unit, CAP)), JSON.stringify(unit.slice(0, 12)))
    }
  })
  it('reads the recorded pages exactly as before (normal and merely broken html)', () => {
    PAGES.forEach((html, i) => {
      expect(parsePage(html), html).toEqual(RECORDED.pages[i])
    })
  })
})

describe('URL paths read off a page: a long run of slashes', () => {
  const slashes = `https://www.example.com/${'/'.repeat(MIB)}x`
  it('CRITICAL: trimTrailingSlashes is linear, and trims only the END', () => {
    expect(within(() => trimTrailingSlashes(`${'/'.repeat(MIB)}x`), 'trim')).toBe(`${'/'.repeat(MIB)}x`)
    expect(trimTrailingSlashes('https://x.test///')).toBe('https://x.test')
    expect(trimTrailingSlashes('/a/b/')).toBe('/a/b')
    expect(trimTrailingSlashes('////')).toBe('')
    expect(trimTrailingSlashes('')).toBe('')
  })
  it('CRITICAL: linkKey (a link a page states) on a path of slashes', () => {
    within(() => linkKey(slashes), 'linkKey')
  })
  it('CRITICAL: the preview test on an og:url whose path is a run of slashes', () => {
    // On the site's OWN host, or the path is never looked at ("another site" wins first).
    const html = `<html><head><meta property="og:title" content="T"><meta property="og:url" content="${ORIGIN}/${'/'.repeat(MIB)}x"></head><body></body></html>`
    const e = evidence({ pages: [page('/', html)] })
    const r = within(() => SHARED_TESTS.preview(e), 'preview test')
    expect(JSON.stringify(r)).toContain('another page')
  })
})

describe('musicBrainzForms (musicbrainz.ts): a profile link with many labels', () => {
  it('CRITICAL: a Tidal host of 100 labels (the old pattern nested two quantifiers)', () => {
    within(() => musicBrainzForms(`https://${'a.'.repeat(100)}tidal.com/x`), 'tidal labels')
    within(() => musicBrainzForms(`https://${'a.'.repeat(100)}tidal.com/`), 'tidal labels, no path')
  })
  it('still cleans a real Tidal link', () => {
    expect(musicBrainzForms('https://listen.tidal.com/artist/123')[0]).toBe('https://tidal.com/artist/123')
  })
})

describe('the old live check (seo-audit.ts)', () => {
  const CAP = 2 * MIB // fetchGuarded's cap
  it('CRITICAL: visibleText on scripts, styles and tags that never close', () => {
    for (const unit of ['<script', '<style', '<', '<script>', '<p a="']) {
      within(() => visibleText(fill(unit, CAP)), JSON.stringify(unit))
    }
  })
  it('CRITICAL: firstJsonLd on script tags that never close or never end', () => {
    for (const unit of ['<script type="application/ld+json"', '<script type="application/ld+json">', '<script ']) {
      within(() => firstJsonLd(fill(unit, CAP)), JSON.stringify(unit))
    }
  })
  it('visibleText still drops scripts and styles, strips tags and decodes entities', () => {
    expect(visibleText('<p>I&#x27;m <b>here</b></p><script>var x = "<p>no</p>"</script><style>p{}</style><p>too &amp; that</p>')).toBe("I'm here too & that")
  })
  it('firstJsonLd finds the first fact card, as before', () => {
    expect(firstJsonLd('<script type="text/javascript">x</script><script type="application/ld+json">{"a":1}</script><script type="application/ld+json">{"b":2}</script>')).toBe('{"a":1}')
    expect(firstJsonLd('<p>none</p>')).toBeNull()
  })
})
