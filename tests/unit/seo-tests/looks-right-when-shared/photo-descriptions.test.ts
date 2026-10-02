/**
 * Proves the "Every photo has a description" test counts each real photo on the pages read
 * once, passes only when every one has a real description, and says "doesn't apply" or
 * "couldn't check" instead of passing when it saw no photos.
 *
 * Code:     src/lib/seo-tests/shared.ts (`alt`), with src/lib/seo-tests/match.ts
 *           (`describes`: is this text a real description)
 * Feature:  SEO test `alt` · Test tab "Looks right when shared"
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and
 *           tells the artist which photos to fix.
 * Covers:   • every photo described passes; one undescribed fails and is named
 *           • an empty description, a file name, "image", "IMG_1234" and other junk is not a
 *             description; a short real one is, in any script
 *           • decoration (hidden, role none, 1 × 1, icons of 48 px or less) and pictures in
 *             noscript, svg or template are not photos
 *           • one picture counts once across pages; an undescribed copy of it counts;
 *             pictures with no address are never merged
 *           • `na` with no photos on the pages and none in Tapir; unknown when Tapir has some
 *             (a script may add them) or a page couldn't be read in full
 * Not here: an unreachable home page (../honesty.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy home page and About page with one described photo
 *           each, and one hidden); `withBody` adds pictures to the home page, `homeOnly` does
 *           the same with no About page. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { SHARED_TESTS } from '@/lib/seo-tests/shared'
import { aboutHtml, evidence, expectPlainWords, homeHtml, known, page, rowOf } from '@tests/helpers/seo/page-fixture'

const a = SHARED_TESTS.alt
const withBody = (body: string, about: string | null = aboutHtml()) => a(evidence({ home: homeHtml({ body }), about }))
/** Pictures added to the home page, with no About page: the home page's one described photo plus these. */
const homeOnly = (body: string) => withBody(body, null)
/** A home page with no pictures at all. */
const bare = '<html><head><title>Skeen</title></head><body>hi</body></html>'

describe('every photo described passes', () => {
  // The one exact-wording check: the pass sentence counts the photos and the pages read, and the limits say it only looked at those pages. (verify-found A5)
  it('passes when every photo on every page has a description', () => {
    const r = a(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('2 of 2')
    expect(r.sentence).toBe('All 2 photos on the 2 pages we read have a description.')
    expect(r.limits).toMatch(/pages/)
    expectPlainWords(r)
  })

  // Short real descriptions count, in any script. (verify-found A2)
  it('counts a short real description, in any script', () => {
    expect(homeOnly('<img src="/k.jpg" alt="Skeen DJ set">').status).toBe('pass')
    expect(homeOnly('<img src="/k.jpg" alt="花火大会">').status).toBe('pass')
  })

  // "&amp;" in a description is still a description.
  it('reads a description with entities', () => {
    expect(withBody('<img src="/x.jpg" alt="Skeen &amp; band">').status).toBe('pass')
  })

  // The same picture on two pages is one photo.
  it('counts the same picture on two pages once', () => {
    expect(withBody('<img src="/about.jpg" alt="Skeen, Concord Music Hall">').value).toBe('2 of 2')
  })

  // A page that isn't there (404) is another test's problem, not a missing description.
  it('ignores a page that is not there', () => {
    expect(a(evidence({ pages: [page('/', homeHtml()), page('/gone', null, 404)] })).status).toBe('pass')
  })
})

describe('a photo without a real description fails', () => {
  // One undescribed photo fails, and the details name it, pointing to where photos are described.
  it('fails a photo with no description, naming it', () => {
    const r = withBody('<img src="/gallery/one.jpg">')
    expect(r.status).toBe('fail')
    expect(r.value).toBe('2 of 3')
    expect(rowOf(r, 'without a description')).toMatch(/gallery\/one\.jpg/)
    expect(r.action).toEqual(expect.objectContaining({ target: 'alt' }))
    expectPlainWords(r)
  })

  // An empty or blank description on a photo not marked as decoration is missing.
  it('fails an empty description on a photo not marked decorative', () => {
    expect(withBody('<img src="/x.jpg" alt="">').status).toBe('fail')
    expect(withBody('<img src="/x.jpg" alt="   ">').status).toBe('fail')
  })

  // File names, numbered placeholders, "image", "logo" and leftovers like "undefined" fill the field without describing anything. (verify-found A2)
  it.each(['IMG_1234.JPG', 'image', 'Image 1', 'photo 3', 'IMG_1234', 'DSC00123', 'image1', '.', '-', 'x', 'undefined', 'null', 'alt text', 'Screen Shot 2026-09-01 at 10.00.00 AM', 'logo'])('fails "%s" as not a description', (junk) => {
    expect(homeOnly(`<img src="/j.jpg" alt="${junk}">`).status).toBe('fail')
  })

  // The same picture twice: if one copy has no description, the picture is not described. (verify-found A3)
  it('counts an undescribed copy of a described picture', () => {
    expect(homeOnly('<img src="/twice.jpg" alt="Skeen at Smartbar"><img src="/twice.jpg">').status).toBe('fail')
  })

  // Pictures with no src (srcset only, lazy loaders, none at all) are each their own photo, never merged into one. (verify-found A1)
  it('never merges pictures that have no src', () => {
    expect(homeOnly('<img srcset="/a.jpg 1x" alt="Skeen on stage at the Salt Shed"><img srcset="/b.jpg 1x">').status).toBe('fail')
    const lazy = homeOnly('<img data-lazy-src="/a.jpg" alt="Skeen live"><img data-lazy-src="/b.jpg"><img data-lazy-src="/c.jpg"><img data-lazy-src="/d.jpg">')
    expect(lazy.status).toBe('fail')
    expect(lazy.value).toBe('2 of 5')
    expect(homeOnly('<img alt="Skeen live at the Salt Shed"><img>').status).toBe('fail')
  })

  // One undescribed photo is enough to fail, even when another page couldn't be read.
  it('fails even when another page could not be read', () => {
    expect(a(evidence({ pages: [page('/', homeHtml({ body: '<img src="/z.jpg">' })), page('/about', null, null, { error: 'timeout' })] })).status).toBe('fail')
  })
})

describe('what is not a photo', () => {
  // Pictures marked as decoration (aria-hidden, role presentation or none, hidden) and 1 × 1 pixels need no description.
  it('skips decorative pictures', () => {
    const body = '<img src="/a.jpg" alt="" role="presentation"><img src="/b.jpg" role="none"><img src="/c.jpg" hidden><img src="/px.gif" width="1" height="1">'
    expect(withBody(body).status).toBe('pass')
  })

  // Pictures inside noscript, template or svg are copies or not shown.
  it('skips pictures inside noscript, svg and template', () => {
    const body = '<noscript><img src="/n.jpg"></noscript><template><img src="/t.jpg"></template><svg><img src="/s.jpg"/></svg>'
    expect(withBody(body).status).toBe('pass')
  })

  // Small icons (both sides 48 px or less) are not photos. (verify-found A4)
  it('skips small icons', () => {
    expect(homeOnly('<img src="/ig.svg" width="20" height="20"><img src="/x.svg" width="24" height="24">').status).toBe('pass')
  })
})

describe('no photos seen', () => {
  // CRITICAL: no photos on the pages and none published in Tapir: nothing to describe, so the test does not apply (`na`, not a pass), and says why.
  it('does not apply with no photos anywhere', () => {
    const r = a(evidence({ home: bare, about: null }))
    expect(r.status).toBe('na')
    expect(r.value).toBe('no photos')
    expect(r.sentence).toMatch(/no photos/)
  })

  // CRITICAL: no photos on the pages while Tapir has published some: a script may add them where we can't see, so "couldn't check".
  it('is unknown with no photos on the pages but some in Tapir', () => {
    const k = known({}, { photos: [{ url: 'https://cdn.example/p.jpg', alt: null }, { url: 'https://cdn.example/g.jpg', alt: 'On stage' }] })
    const r = a(evidence({ home: bare, about: null, known: k }))
    expect(r.status).toBe('unknown')
    expect(rowOf(r, 'in Tapir: photos')).toBe('2 published')
  })

  // A page that couldn't be read, while every photo we saw is described: "couldn't check", not a pass.
  it('is unknown when a page could not be read and the rest are fine', () => {
    expect(a(evidence({ pages: [page('/', homeHtml()), page('/about', null, null, { error: 'timeout' })] })).status).toBe('unknown')
  })

  // A page cut at the read cap may hide an undescribed photo past the cut: "couldn't check".
  it('is unknown when a page was cut short', () => {
    expect(a(evidence({ pages: [page('/', homeHtml(), 200, { truncated: true })] })).status).toBe('unknown')
  })
})
