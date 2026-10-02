/**
 * Proves the "Your link preview says who you are" test passes only when a shared link of the
 * home page carries a title with the artist's name, a real summary, the site's own address and
 * a card size X knows.
 *
 * Code:     src/lib/seo-tests/shared.ts (`preview`)
 * Feature:  SEO test `preview` · Test tab "Looks right when shared"
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and
 *           tells the artist a claim about it.
 * Covers:   • title + summary + address + X card that agree passes
 *           • no title, a title without the name or only the name, no summary or only the
 *             name, an address that is missing or on another site or page: a hard fail,
 *             every problem named at once
 *           • X's own title and summary are judged too; no X card, or one X doesn't know: soft
 *           • the address passes with or without www, a trailing slash, or relative
 * Not here: the preview picture (preview-picture.test.ts); the page title
 *           (../says-who-you-are/title.test.ts); an unreachable home page (../honesty.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy site); `withOg` changes the share tags. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { SHARED_TESTS } from '@/lib/seo-tests/shared'
import { evidence, expectPlainWords, homeHtml, rowOf } from '@tests/helpers/seo/page-fixture'

const p = SHARED_TESTS.preview
const withOg = (og: Record<string, string | null>) => p(evidence({ home: homeHtml({ og }) }))

describe('a preview that says who you are passes', () => {
  // The one exact-wording check: the pass sentence claims only what was checked (no "one line" promise). (verify-found PV3)
  it('passes a title, summary, address and card size that agree', () => {
    const r = p(evidence())
    expect(r.status).toBe('pass')
    expect(r.sentence).toBe('Shared links show your name and a description.')
    expect(rowOf(r, 'shared title')).toBe('Skeen · Chicago house DJ and producer')
    expectPlainWords(r)
  })

  // The site's own home address, however it is spelled (www or not, a trailing slash, relative), is the right address.
  it('passes the address with or without www, a trailing slash, or relative', () => {
    expect(withOg({ 'og:url': 'https://example-artist.com/' }).status).toBe('pass')
    expect(withOg({ 'og:url': 'https://www.example-artist.com/' }).status).toBe('pass')
    expect(withOg({ 'og:url': '/' }).status).toBe('pass')
  })

  // "&amp;" in the summary is shown as "&".
  it('decodes entities', () => {
    const r = withOg({ 'og:description': 'Skeen & friends: Chicago house, every weekend.' })
    expect(rowOf(r, 'shared description')).toBe('Skeen & friends: Chicago house, every weekend.')
  })
})

describe('a preview missing who you are fails', () => {
  // No shared title, one without the name, or only the name (as the title test judges it) fails. (verify-found PV4)
  it('fails with no shared title, one without the name, or only the name', () => {
    expect(withOg({ 'og:title': null }).status).toBe('fail')
    expect(withOg({ 'og:title': 'Chicago house DJ' }).status).toBe('fail')
    expect(withOg({ 'og:title': 'Skeen' }).status).toBe('fail')
  })

  // No shared summary, or one that is only the name, fails.
  it('fails with no shared summary, or only the name', () => {
    expect(withOg({ 'og:description': null }).status).toBe('fail')
    expect(withOg({ 'og:description': 'Skeen — official site' }).status).toBe('fail')
  })

  // X's own title and summary are what X shows, so they are judged too. (verify-found PV1)
  it('judges X’s own title and summary', () => {
    expect(withOg({ 'twitter:title': 'Untitled' }).status).toBe('fail')
    expect(withOg({ 'twitter:description': 'Skeen' }).status).toBe('fail')
  })

  // The address must be the home page on this site: missing, another site (named in the sentence) or another page fails.
  it('fails an address that is missing, on another site, or another page', () => {
    expect(withOg({ 'og:url': null }).status).toBe('fail')
    const r = withOg({ 'og:url': 'https://skeen-website.vercel.app/' })
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/skeen-website\.vercel\.app/)
    expect(withOg({ 'og:url': 'https://www.example-artist.com/about' }).status).toBe('fail')
  })

  // Two problems are both named in one sentence, and it is a hard fail.
  it('names every problem at once', () => {
    const r = withOg({ 'og:title': null, 'og:description': null })
    expect(r.value).toBe('2 problems')
    expect(r.sentence).toMatch(/title/)
    expect(r.sentence).toMatch(/description/)
    expect(r.lead).toBeUndefined()
  })
})

describe('X’s card size', () => {
  // No X card: X shows the preview small. A soft fail.
  it('fails softly with no card size for X', () => {
    const r = withOg({ 'twitter:card': null })
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
  })

  // An X card kind that doesn't exist is ignored by X, so it fails like none. (verify-found PV2)
  it('fails an X card kind that doesn’t exist', () => {
    expect(withOg({ 'twitter:card': 'banana' }).status).toBe('fail')
  })
})
