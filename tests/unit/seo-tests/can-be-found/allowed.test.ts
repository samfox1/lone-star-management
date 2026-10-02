/**
 * "Search engines are allowed to list you" passes only when nothing on the pages we opened tells
 * Google or Bing to skip a page or to list another address instead.
 *
 * Code:     src/lib/seo-tests/found.ts (allowed)
 * Feature:  allowed (Test tab group "Can be found")
 * Tier:     STRICT (AGENTS.md "Test depth"): one wrong setting can hide a whole site, and this
 *           result is what the manager is told about it.
 * Covers:   • a "don't list me" in the page or its header, for everyone or for Google or Bing
 *           • the settings file (robots.txt) keeping Google or Bing off a page, or erroring
 *           • the main address a page names (its canonical): another site, another page, or an
 *             address that doesn't work is a fail; the same page spelled another way is fine
 *           • a page that sends everyone to another site
 *           • a page we couldn't read, or have no Google or Bing copy of, is "couldn't check"
 * Not here: the plain-words and never-throws rules shared by all ten tests (contract.test.ts);
 *           each bot's own "don't list me" and settings rules (bots.test.ts).
 * Fixtures: ../_found-fixtures.ts: a healthy two-page site whose pages name themselves as their
 *           main address; each case swaps one page, header or settings file. No network.
 */
import { describe, expect, it } from 'vitest'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import type { SeoPageFetch } from '@/lib/seo-tests/types'
import { ABOUT, HOME, O, ROBOTS_OK, details, evidence, run, type Fixture } from '@tests/unit/seo-tests/_found-fixtures'

const html = { 'content-type': 'text/html' }
const withMeta = (page: string, name: string, content: string) => page.replace('<head>', `<head><meta name="${name}" content="${content}">`)
/** /about naming `href` as its main address instead of itself (`before` goes in front of it). */
const aboutNaming = (href: string, before = '') => ABOUT.replace(`<link rel="canonical" href="${O}/about">`, `${before}<link rel="canonical" href="${href}">`)

describe('a healthy site', () => {
  // The exact words a manager reads when nothing hides the site, with what was read in the details.
  it('passes, word for word, and shows what it read', () => {
    const r = run('allowed')
    expect(r).toMatchObject({ status: 'pass', value: '2 pages can be listed' })
    expect(r.sentence).toBe('Nothing on your 2 pages tells search engines to skip them.')
    expect(details(r)).toContain(`canonical: / (a person) → ${O}/`)
    expect(details(r)).toContain('robots.txt: read, nothing blocks Google or Bing')
  })
})

describe('a page that asks not to be listed', () => {
  // A "don't list me" on any copy of a page (a person's, Google's or Bing's), in the page or in
  // its header, for everyone or for Bing by name, fails and names the page. (verify-found F15
  // comma date, F16 spaces)
  it.each<[string, Fixture, string]>([
    ['a robots meta tag with noindex on /about', { pages: { '/': HOME, '/about': withMeta(ABOUT, 'robots', 'noindex') } }, 'your page /about'],
    ['noindex in the header of a person’s visit', { plain: { '/': { headers: { ...html, 'x-robots-tag': 'noindex' } } } }, 'your home page'],
    ['a meta tag for Bing only (Bing is a search engine too)', { pages: { '/': withMeta(HOME, 'bingbot', 'noindex'), '/about': ABOUT } }, 'your home page'],
    ['a past unavailable_after in a meta tag, its date holding a comma', { pages: { '/': withMeta(HOME, 'robots', 'unavailable_after: Wed, 01 Jan 2025 00:00:00 GMT'), '/about': ABOUT } }, 'your home page'],
    ['“noindex nofollow” split by a space', { pages: { '/': withMeta(HOME, 'robots', 'noindex nofollow'), '/about': ABOUT } }, 'your home page'],
  ])('%s: fail, naming the page', (_name, f, page) => {
    const r = run('allowed', f)
    expect(r).toMatchObject({ status: 'fail', value: '1 of 2 pages', sentence: expect.stringContaining(page) })
    expect(r.sentence).toMatch(/not to list it/)
  })
})

describe('the settings file (robots.txt)', () => {
  // A settings rule that keeps Google or Bing off a page fails, naming who and which page; a
  // server error on the file keeps them off the whole site.
  it.each<[string, { status: number; body: string | null }, string, RegExp]>([
    ['a rule keeping everyone off /about', { status: 200, body: 'User-agent: *\nDisallow: /about\n' }, '1 of 2 pages', /tell Google to skip your page \/about/],
    ['a rule keeping Bing off every page', { status: 200, body: `${ROBOTS_OK}\nUser-agent: bingbot\nDisallow: /\n` }, '0 of 2 pages', /tell Bing to skip your home page/],
    ['a server error', { status: 500, body: null }, '0 of 2 pages', /gives an error when search engines ask for its settings, so they stay away from your whole site/],
  ])('%s: fail', (_name, robots, value, said) => {
    expect(run('allowed', { robots })).toMatchObject({ status: 'fail', value, sentence: expect.stringMatching(said) })
  })
  // A settings file refused to us may hold rules we didn't see: couldn't check.
  it('a settings file refused to us: couldn’t check', () => {
    expect(run('allowed', { robots: { status: 403, body: null } })).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/wouldn’t show us its settings/) })
  })
})

describe('the main address a page names (its canonical)', () => {
  // A page naming another site, another page, or an address that doesn't work as its main
  // address tells search engines to list that instead: a fail naming it. Read from the head,
  // the Link header and every copy (Google's alone counts), relative to <base href>. (verify-found F19)
  it.each<[string, Fixture, RegExp]>([
    ['another site', { pages: { '/': HOME.replace(`<link rel="canonical" href="${O}/">`, '<link rel="canonical" href="https://someone-else.com/">'), '/about': ABOUT } }, /your home page tells search engines to list another site \(someone-else\.com\) instead/],
    ['another page of the site', { pages: { '/': HOME, '/about': aboutNaming(`${O}/`) } }, /your page \/about tells search engines to list your home page instead/],
    ['another site, in the Link header', { plain: { '/about': { headers: { ...html, link: '<https://other.example.org/x>; rel="canonical"' } } } }, /list another site \(other\.example\.org\)/],
    ['another site, in Google’s copy only', { bots: { googlebot: { '/about': { html: aboutNaming('https://other.example/about') } } } }, /list another site \(other\.example\)/],
    ['a relative address, read against <base href>', { pages: { '/': HOME, '/about': ABOUT.replace(`<link rel="canonical" href="${O}/about">`, '<base href="/en/"><link rel="canonical" href="about">') } }, /list your page \/en\/about instead/],
    ['an address that doesn’t work', { pages: { '/': HOME, '/about': aboutNaming('javascript:alert(1)') } }, /points search engines to an address that doesn’t work/],
  ])('%s: fail, naming it', (_name, f, said) => {
    expect(run('allowed', f)).toMatchObject({ status: 'fail', sentence: expect.stringMatching(said) })
  })
  // The same page spelled another way (bare domain, http, a trailing slash, relative), no main
  // address at all, or one written in the body (Google ignores it) is fine.
  it.each<[string, string]>([
    ['the bare domain', aboutNaming('https://example.com/about')],
    ['http and a trailing slash', aboutNaming('http://www.example.com/about/')],
    ['a path', aboutNaming('/about')],
    ['a relative address', aboutNaming('about')],
    ['no main address at all', ABOUT.replace(`<link rel="canonical" href="${O}/about">`, '')],
    ['one written in the body, which Google ignores', ABOUT.replace(`<link rel="canonical" href="${O}/about">`, '').replace('<main>', '<main><link rel="canonical" href="https://other.example/">')],
  ])('%s: pass', (_name, about) => {
    expect(run('allowed', { pages: { '/': HOME, '/about': about } }).status).toBe('pass')
  })
  // A home page that sends everyone on to a language or regional page is judged where it
  // landed: naming itself (/en), or naming the "/" we asked for (theguardian.com's "/us"), is
  // the usual pattern, not "list another page". (verify-found F11)
  it.each([
    ['/en, naming /en', `${O}/en`, HOME.replace(`<link rel="canonical" href="${O}/">`, `<link rel="canonical" href="${O}/en">`)],
    ['/us, naming /', `${O}/us`, HOME],
  ])('home sent on to %s: pass', (_name, landed, home) => {
    const moved = { finalUrl: landed }
    expect(run('allowed', { pages: { '/': home, '/about': ABOUT }, plain: { '/': moved }, allBots: { '/': moved } }).status).toBe('pass')
  })
  // Two main addresses that disagree (Google may ignore both), or an http:// one on an https
  // page, are noted in the details. (verify-found F19)
  it('two main addresses that disagree, or an http:// one, are noted', () => {
    expect(details(run('allowed', { pages: { '/': HOME, '/about': aboutNaming('https://other.example/about', `<link rel="canonical" href="${O}/about">`) } }))).toContain('/about names two different main addresses; Google may ignore both or pick either')
    expect(details(run('allowed', { pages: { '/': HOME, '/about': aboutNaming('http://www.example.com/about') } }))).toContain('/about names its http:// address as the main one')
  })
})

describe('a page sent somewhere else', () => {
  // A page that sends everyone away is listed as the other site, not the artist's: a fail naming
  // it, but never naming a private address.
  it.each<[string, Fixture, RegExp]>([
    ['home sends everyone to another site', { plain: { '/': { status: null, html: null, finalUrl: null, error: 'not-allowed: https://linktr.ee/skeen' } }, allBots: { '/': { status: null, html: null, finalUrl: null, error: 'not-allowed: https://linktr.ee/skeen' } } }, /another site \(linktr\.ee\)/],
    ['/about sends visitors to a private address', { plain: { '/about': { status: null, html: null, finalUrl: null, error: 'not-public: http://10.0.0.1/' } } }, /your page \/about sends visitors to a private address/],
  ])('%s: fail, saying where', (_name, f, said) => {
    const r = run('allowed', f)
    expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(said) })
    expect(r.sentence).not.toContain('10.0.0.1')
  })
})

describe('what we couldn’t read', () => {
  // A page we could not read, or read only in part, may hold a "don't list me": couldn't check.
  // (verify-found F17 for the cut page)
  it.each<[string, Partial<SeoPageFetch>, RegExp]>([
    ['no answer', { status: null, html: null, error: 'timeout' }, /couldn’t read your page \/about/],
    ['the run ran out of time', { status: null, html: null, error: 'out-of-time' }, /ran out of time before we reached your page \/about/],
    ['a page read only in part (over 1 MB)', { truncated: true }, /your page \/about is over 1 MB/],
  ])('%s: couldn’t check', (_name, visit, said) => {
    expect(run('allowed', { plain: { '/about': visit }, allBots: { '/about': visit } })).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(said) })
  })
  // A menu link missing for everyone (404) is a broken link, not a page hiding itself: a note,
  // and it leaves the count.
  it('a page missing for everyone: noted, left out of the count', () => {
    const r = run('allowed', { plain: { '/about': { status: 404, html: null } }, allBots: { '/about': { status: 404, html: null } } })
    expect(r).toMatchObject({ status: 'pass', value: '1 page can be listed' })
    expect(details(r)).toContain('/about doesn’t open for anyone (404)')
  })
  // Without Google's copy of a page, or without any Google and Bing visits, we can't say what
  // they are told.
  it('no Google copy of a page, or no Google and Bing visits at all: couldn’t check', () => {
    const e = evidence()
    e.byBot.googlebot = e.byBot.googlebot.filter((p) => p.path !== '/about')
    expect(FOUND_TESTS.allowed(e)).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/didn’t visit your page \/about as Google/) })
    expect(FOUND_TESTS.allowed({ ...evidence(), byBot: {} })).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/didn’t visit as Google and Bing/) })
  })
})
