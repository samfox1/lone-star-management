/**
 * Proves the "Your page title says who you are" test passes a title that names the artist and
 * their city or sound, and fails every title that doesn't.
 *
 * Code:     src/lib/seo-tests/who.ts (`title`), reading the page with src/lib/seo-tests/html.ts
 * Feature:  SEO test `title` · Test tab "Says who you are"
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and
 *           tells the artist a claim about it; a wrong verdict is advice they act on.
 * Covers:   • a title with the name plus the city or sound passes; the name alone, filler
 *             ("Official Website"), an error page's title or a missing name fails
 *           • over 70 characters is a soft fail ("Almost"); exactly 70 passes; characters,
 *             not code units, are counted
 *           • what Tapir holds for the title is labelled "in Tapir", written vs built
 *           • the real page title is read: not an svg's, one React streams into the body is,
 *             entities decoded, a second title noted
 *           • a huge or broken page is read quickly and never hangs
 * Not here: an unreachable or cut-short home page (../honesty.test.ts); how pages are read
 *           (../page-reading/html.test.ts); the share title (../looks-right-when-shared/link-preview.test.ts).
 * Fixtures: _page-fixture.ts (a healthy site; each case changes one thing). Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import { evidence, expectPlainWords, homeHtml, known, rowOf } from '@tests/unit/seo-tests/_page-fixture'

const t = WHO_TESTS.title

describe('a title that says who you are passes', () => {
  // The one exact-wording check: the pass sentence quotes the live title, and the details say it matches Tapir's.
  it('passes the healthy title, quoting it and naming where Tapir’s came from', () => {
    const r = t(evidence())
    expect(r.status).toBe('pass')
    expect(r.sentence).toBe('Your site’s title is “Skeen · Chicago house DJ and producer”.')
    expect(rowOf(r, 'title')).toBe('Skeen · Chicago house DJ and producer')
    expect(rowOf(r, 'length')).toBe('37 of 70')
    expect(rowOf(r, 'in Tapir: title')).toMatch(/written on the Listing tab/i)
    expect(rowOf(r, 'same as your site')).toBe('yes')
    expectPlainWords(r)
  })

  // Exactly 70 characters passes: 70 is the limit, not over it.
  it('passes a title of exactly 70 characters', () => {
    const seventy = `Skeen · Chicago ${'x'.repeat(54)}`
    expect(seventy.length).toBe(70)
    expect(t(evidence({ home: homeHtml({ title: seventy }) })).status).toBe('pass')
  })

  // A name in a script written without spaces is still found: Japanese titles run words together. (verify-found T4)
  it('finds a name in a script without spaces', () => {
    const r = t(evidence({ home: homeHtml({ title: '米津玄師公式サイト · 東京' }), known: known({ artistName: '米津玄師' }, { genre: null, location: null }) }))
    expect(r.status).toBe('pass')
  })
})

describe('what Tapir holds for the title is shown as Tapir’s', () => {
  // A live title that differs from the published one is flagged, and Tapir's is labelled as Tapir's, not the site's.
  it('says when the live title is not the one published, quoting Tapir’s as Tapir’s', () => {
    const r = t(evidence({ known: known({}, { seoTitle: 'Skeen · Chicago DJ' }) }))
    expect(rowOf(r, 'same as your site')).toBe('no')
    expect(rowOf(r, 'in Tapir: title')).toBe('Skeen · Chicago DJ (written on the Listing tab)')
  })

  // With nothing written, Tapir's title is the one BUILT from the facts: it must never be called "written" by the manager. (verify-found T2)
  it('calls a title Tapir built from the facts "built", never "written"', () => {
    // known.ts fills seoTitle from resolveSeo, so with nothing written it holds the built title, never null.
    const built = 'Skeen · Chicago house musician'
    const r = t(evidence({ home: homeHtml({ title: built }), known: known({}, { seoTitle: built }) }))
    expect(r.status).toBe('pass')
    expect(rowOf(r, 'in Tapir: title')).toMatch(/built from your facts/i)
    expect(r.evidence.map((x) => x.value).join(' ')).not.toMatch(/written on/)
  })
})

describe('a title that doesn’t say who you are fails', () => {
  // The bare name, in any case: a hard fail (not "Almost"), pointing to the Listing tab.
  it('fails the bare name, in any case', () => {
    const r = t(evidence({ home: homeHtml({ title: 'SKEEN' }) }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
    expect(r.action).toEqual(expect.objectContaining({ kind: 'edit', target: 'listing' }))
    expectPlainWords(r)
  })

  // The name plus filler, or an error page's or a builder's placeholder title: each is a hard fail, never the soft "Almost" a missing city gets. (verify-found T1)
  it.each([
    'Skeen — Official Website',
    'Welcome to the official site of Skeen',
    'Skeen | Page not found',
    'Skeen | Coming soon',
    'Skeen - Just another WordPress site',
    'Skeen | 404',
  ])('fails "%s" outright', (title) => {
    const r = t(evidence({ home: homeHtml({ title }) }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
  })

  // Your name plus a word that is neither your city nor your sound: a soft fail, since Tapir has both to suggest. (verify-found T1)
  it('fails the name plus an unrelated word softly', () => {
    const r = t(evidence({ home: homeHtml({ title: 'Skeen | Tickets' }) }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
  })

  // No title at all: Google then makes one up.
  it('fails a page with no title', () => {
    const r = t(evidence({ home: homeHtml({ title: null }) }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('no title')
  })

  // The name must be there as a whole word: "Skeens" is not "Skeen".
  it('fails a title that doesn’t name the artist as a whole word', () => {
    expect(t(evidence({ home: homeHtml({ title: 'Chicago house DJ and producer' }) })).status).toBe('fail')
    expect(t(evidence({ home: homeHtml({ title: 'Skeens · Chicago house DJ' }) })).status).toBe('fail')
  })

  // Over 70 characters gets cut off in results: a soft fail that says the length.
  it('fails a title over 70 characters softly, saying its length', () => {
    const long = 'Skeen · Chicago house DJ, producer, filmmaker, radio host and label owner'
    expect(long.length).toBeGreaterThan(70)
    const r = t(evidence({ home: homeHtml({ title: long }) }))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
    expect(rowOf(r, 'length')).toBe(`${long.length} of 70`)
  })
})

describe('reading the title off the page', () => {
  // Only the page's own title counts: an icon's svg <title> before it is not the page title, and alone it means "no title".
  it('reads the page title, never an svg <title>', () => {
    const svg = '<svg><title>SKEEN</title><path d="M0 0"/></svg>'
    expect(t(evidence({ home: homeHtml().replace('<head>', `<head>${svg}`) })).status).toBe('pass')
    expect(t(evidence({ home: homeHtml({ title: null, body: svg }) })).value).toMatch(/no title/i)
  })

  // React can stream the title into the body: it is still the page's title.
  it('reads a title written in the body', () => {
    const html = homeHtml({ title: null, body: '<title>Skeen · Chicago house DJ</title>' })
    expect(t(evidence({ home: html })).status).toBe('pass')
  })

  // "&amp;" is judged and shown as "&": the manager reads the title as a visitor does.
  it('decodes entities before judging and showing', () => {
    const r = t(evidence({ home: homeHtml({ title: 'Skeen & Friends · Chicago' }) }))
    expect(rowOf(r, 'title')).toBe('Skeen & Friends · Chicago')
    expect(r.status).toBe('pass')
  })

  // A second title is noted in the details: browsers and Google may pick either.
  it('notes a second title', () => {
    const r = t(evidence({ home: homeHtml({ body: '<title>Other</title>' }) }))
    expect(rowOf(r, 'titles on the page')).toBe('2')
  })

  // Length is counted in characters, and no emoji is cut in half in what the manager sees. (verify-found T3)
  it('counts characters, not code units, and never cuts one in half', () => {
    const title = `Skeen · Chicago ${'🎧'.repeat(33)}`
    const r = t(evidence({ home: homeHtml({ title }) }))
    expect(rowOf(r, /^length$/)).toBe(`${Array.from(title).length} of 70`)
    expect(JSON.stringify(r)).not.toMatch(/\\ud83c(?!\\udfa7)/i)
  })

  // A 5 MB page is read in well under 3 seconds: a slow reader would stall the whole run.
  it('reads a 5 MB page quickly', () => {
    const huge = homeHtml({ body: `<div>${'<p>word word word</p>'.repeat(260_000)}</div>` })
    expect(huge.length).toBeGreaterThan(5_000_000)
    const start = Date.now()
    expect(t(evidence({ home: huge })).status).toBe('pass')
    expect(Date.now() - start).toBeLessThan(3000)
  })

  // Thousands of unclosed scripts and an unclosed quote: still answers, never hangs.
  it('survives an unclosed script and an unclosed quote', () => {
    const html = `<html><head><title>Skeen · Chicago</title></head><body><img alt="oops src=x>${'<script>'.repeat(20_000)}`
    expect(t(evidence({ home: html })).status).toBe('pass')
  })
})
