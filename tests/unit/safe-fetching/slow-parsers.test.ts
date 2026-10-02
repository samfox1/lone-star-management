/**
 * The readers that run on a site's fetched text finish quickly even on the worst text a hostile
 * site can serve, and still read normal pages exactly as before.
 *
 * Code:     src/lib/seo-tests/fresh.ts (sitemapLastmods), src/lib/seo-tests/html.ts (parsePage,
 *           linkKey), src/lib/url.ts (trimTrailingSlashes), src/lib/seo-tests/shared.ts (the
 *           preview check), src/lib/seo-tests/musicbrainz.ts (musicBrainzForms)
 * Feature:  safe fetching: every SEO/GEO check that reads a page or sitemap
 * Tier:     STRICT (AGENTS.md "Test depth"): security, and parsers of outside text. A regex that
 *           backtracks runs on the one JavaScript thread, where no timeout can stop it: a 32 KiB
 *           sitemap took 27 s and a 1 MiB page ~153 s, and every other request waited meanwhile
 *           (security review 2026-09-29, F4).
 * Covers:   • each reader gets its worst known input at (or past) the size it is allowed to read,
 *             and must finish within LIMIT_MS (5 s; the fixed readers take under half a second,
 *             the broken ones 27 s to hours, so it cannot pass by luck)
 *           • sitemap dates, every page parse, slash-heavy link paths and many-label profile links
 *           • the recorded corpus: normal and merely-broken pages and sitemaps read exactly as
 *             they did before the fix
 * Not here: byte caps and time limits on the fetch itself (size-and-time-limits.test.ts); what each
 *           reader finds on a normal page (the SEO checks' own tests under tests/unit/seo-tests).
 * Fixtures: generated hostile text (a unit repeated to the cap); the recorded pages and sitemaps
 *           with their recorded readings (tests/unit/safe-fetching/_parser-corpus.ts); a site's
 *           evidence built by tests/helpers/seo/page-fixture.ts.
 */
import { describe, expect, it } from 'vitest'
import { sitemapLastmods } from '@/lib/seo-tests/fresh'
import { linkKey, parsePage } from '@/lib/seo-tests/html'
import { musicBrainzForms } from '@/lib/seo-tests/musicbrainz'
import { SHARED_TESTS } from '@/lib/seo-tests/shared'
import { trimTrailingSlashes } from '@/lib/url'
import { PAGES, RECORDED, SITEMAPS } from '@tests/unit/safe-fetching/_parser-corpus'
import { ORIGIN, evidence, page } from '@tests/helpers/seo/page-fixture'

const KIB = 1024
const MIB = 1024 * KIB
/** Room for a noisy machine (the full suite runs many workers at once, where 0.4 s became > 1 s,
 *  2026-09-29); the broken versions take 27 s and up. */
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

describe('sitemap dates (sitemapLastmods), read on every Publish', () => {
  const CAP = 512 * KIB // fresh.ts reads the sitemap with maxBytes 512 KiB
  // The reviewer's input: `<lastmod>` and a long run of spaces, repeated to the cap (was 27 s at 32 KiB).
  it('CRITICAL: `<lastmod>` followed by a long run of spaces, repeated, at the cap', () => {
    within(() => sitemapLastmods(fill(`<lastmod>${' '.repeat(2000)}`, CAP)), 'lastmod + spaces')
  })

  // The other shapes that make a lazy match rescan: a tag never closed, a `<` inside, tabs.
  it('CRITICAL: other shapes that make a lazy match rescan: never closed, a `<` inside, tabs', () => {
    for (const unit of ['<lastmod>x', '<lastmod>a<', `<lastmod>\t\n${'x'.repeat(500)}`, `<lastmod> ${'x '.repeat(400)}</lastmo`]) {
      within(() => sitemapLastmods(fill(unit, CAP)), JSON.stringify(unit.slice(0, 20)))
    }
  })

  // The fix changed no reading: the recorded sitemaps give exactly the recorded dates.
  it('reads the recorded sitemaps exactly as before', () => {
    expect(SITEMAPS.map((s) => sitemapLastmods(s))).toEqual(RECORDED.sitemaps)
  })
})

describe('reading a page (parsePage), done for every page a check reads', () => {
  const CAP = MIB // evidence.ts PAGE_MAX_BYTES
  // The reviewer's ~153 s input: `<a href="` never closed, repeated to the 1 MiB cap.
  it('CRITICAL: a tag that never closes, repeated to the cap', () => {
    within(() => parsePage(fill('<a href="', CAP)), '<a href=" never closed')
  })

  // Every other way a tag can fail to close (open quote, missing `>`, a lone `<`).
  it('CRITICAL: the other ways a tag can fail to close', () => {
    for (const unit of ['<a ', '<a', "<p '", '<a href="x" ', '<', '</a ', '<a b="1"c=\'', '<img alt="x" src=\'']) {
      within(() => parsePage(fill(unit, CAP)), JSON.stringify(unit))
    }
  })

  // Script, style and title elements that never close, and a 5,000-letter tag name.
  it('CRITICAL: raw elements that never close, and long tag names', () => {
    for (const unit of ['<script>', '<style', '<title>x', `<${'a'.repeat(5000)} `]) {
      within(() => parsePage(fill(unit, CAP)), JSON.stringify(unit.slice(0, 12)))
    }
  })

  // The fix changed no reading: the recorded pages (normal and merely broken html) parse exactly
  // as recorded.
  it('reads the recorded pages exactly as before (normal and merely broken html)', () => {
    PAGES.forEach((html, i) => {
      expect(parsePage(html), html).toEqual(RECORDED.pages[i])
    })
  })
})

describe('link paths read off a page: a long run of slashes', () => {
  const slashes = `https://www.example.com/${'/'.repeat(MIB)}x`
  // Trimming the slashes off the end is linear on a megabyte of slashes, and trims only the end.
  it('CRITICAL: trimTrailingSlashes is linear, and trims only the END', () => {
    expect(within(() => trimTrailingSlashes(`${'/'.repeat(MIB)}x`), 'trim')).toBe(`${'/'.repeat(MIB)}x`)
    expect(trimTrailingSlashes('https://x.test///')).toBe('https://x.test')
    expect(trimTrailingSlashes('/a/b/')).toBe('/a/b')
    expect(trimTrailingSlashes('////')).toBe('')
    expect(trimTrailingSlashes('')).toBe('')
  })

  // The key a page's stated link is compared by, on a path of a megabyte of slashes.
  it('CRITICAL: linkKey (a link a page states) on a path of slashes', () => {
    within(() => linkKey(slashes), 'linkKey')
  })

  // The preview check on a share link (og:url) whose path is a megabyte of slashes, on the site's
  // OWN host (on another host the path is never looked at: "another site" wins first).
  it('CRITICAL: the preview check on an og:url whose path is a run of slashes', () => {
    const html = `<html><head><meta property="og:title" content="T"><meta property="og:url" content="${ORIGIN}/${'/'.repeat(MIB)}x"></head><body></body></html>`
    const e = evidence({ pages: [page('/', html)] })
    const r = within(() => SHARED_TESTS.preview(e), 'preview test')
    expect(JSON.stringify(r)).toContain('another page')
  })
})

describe('profile links with many labels (musicBrainzForms)', () => {
  // A Tidal address with 100 labels (the old pattern nested two quantifiers), with and without a path.
  it('CRITICAL: a Tidal host of 100 labels', () => {
    within(() => musicBrainzForms(`https://${'a.'.repeat(100)}tidal.com/x`), 'tidal labels')
    within(() => musicBrainzForms(`https://${'a.'.repeat(100)}tidal.com/`), 'tidal labels, no path')
  })

  // The fix still cleans a real Tidal link to the form MusicBrainz lists.
  it('still cleans a real Tidal link', () => {
    expect(musicBrainzForms('https://listen.tidal.com/artist/123')[0]).toBe('https://tidal.com/artist/123')
  })
})
