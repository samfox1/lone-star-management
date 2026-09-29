/**
 * "Your site offers Google a list of your pages" passes only when the site's list of pages (its
 * sitemap) is a real list, of full addresses on this site, with honest dates, and the pages we
 * opened from it open.
 *
 * Code:     src/lib/seo-tests/found.ts (list, isW3cDate)
 * Feature:  list (Test tab group "Can be found")
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads a file the site hands us (a parser's
 *           verdict) and tells the manager whether Google can find new pages.
 * Covers:   • no list, a web page or another form where the list should be, an empty list
 *           • entries that aren't full addresses, or are on other sites
 *           • a listed page that doesn't open, or says "page not found"
 *           • dates: in the future, not real dates, W3C short dates, time zones, none at all
 *           • whether the settings file (robots.txt) points to the list, and never blaming it
 *             when we couldn't read it
 *           • what we couldn't open is "couldn't check", never a fail or a pass
 *           • the sentence and details say how much was opened and read
 * Not here: how the list is found, downloaded and parsed (evidence.test.ts); the rules shared by
 *           all ten tests (contract.test.ts).
 * Fixtures: ../found-fixtures.ts: a healthy two-page site whose list (SITEMAP_OK) names both pages,
 *           dated, and is named in robots.txt; each case changes the list or one visit.
 */
import { describe, expect, it } from 'vitest'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import type { SeoEvidence } from '@/lib/seo-tests/types'
import { ABOUT, HOME, O, SITEMAP_OK, SOFT_404, details, evidence, run, type Fixture } from '@tests/unit/seo-tests/found-fixtures'

type Sitemap = NonNullable<SeoEvidence['sitemap']>
const list = (over: Partial<Sitemap>): Fixture => ({ sitemap: { ...SITEMAP_OK, ...over } })

describe('a healthy list', () => {
  // The exact words a manager reads, with where the list was and how many pages we opened.
  it('passes, word for word, naming the list and how many pages were opened', () => {
    const r = run('list')
    expect(r).toMatchObject({ status: 'pass', value: '2 pages' })
    expect(r.sentence).toBe('Your site gives search engines a list of 2 pages, and all 2 open.')
    expect(details(r)).toContain('sitemap: /sitemap.xml · answered 200')
    // The limit counts what was really opened. (verify-found F25)
    expect(r.limits).toMatch(/We opened 2 pages from the list/)
  })
})

describe('a list that is missing or broken', () => {
  // Each way the list itself is wrong is a fail that says what is wrong in plain words.
  // (verify-found F20 for the forms, F25 for addresses)
  it.each<[string, Fixture, string, RegExp]>([
    ['no list at all', { sitemap: { status: 404, urls: [], lastmods: [], url: `${O}/sitemap.xml`, parsed: false, namedInRobots: false, total: 0 } }, 'no list', /has no list of its pages/],
    ['a web page where the list should be', list({ parsed: false, urls: [], lastmods: [], total: 0 }), 'not a real list', /isn’t a real list \(it’s a web page\)/],
    ['a file in a form search engines can’t read', list({ parsed: false, format: 'other', urls: [], lastmods: [], total: 0 }), 'not a real list', /isn’t in a form they can read/],
    ['an empty list', list({ urls: [], lastmods: [], total: 0 }), '0 pages', /is empty/],
    ['entries that aren’t full addresses ("/about")', list({ urls: [], lastmods: [], total: 0, badLocs: { count: 2, examples: ['/', '/about'] } }), '0 pages', /2 entries that aren’t full web addresses/],
    ['pages on other sites', list({ total: 4, offSite: { count: 2, examples: ['https://evil.test/x', 'http://10.0.0.1/'] } }), '4 pages', /names 2 pages on other sites/],
    ['a list inside an index that doesn’t open', list({ children: [{ url: `${O}/a.xml`, status: 200 }, { url: `${O}/b.xml`, status: 404 }] }), '2 pages', /part of your list of pages doesn’t open/],
  ])('%s: fail', (_name, f, value, said) => {
    const r = run('list', f)
    expect(r).toMatchObject({ status: 'fail', value, sentence: expect.stringMatching(said) })
    // Entries that aren't addresses are never called "other sites". (verify-found F25)
    if (f.sitemap?.badLocs) expect(r.sentence).not.toMatch(/other sites/)
  })
})

describe('a listed page that doesn’t open', () => {
  // A page on the list that is missing, or says "page not found", is a fail naming it: a list
  // should hold only pages that open.
  it.each<[string, Fixture, string]>([
    ['missing (404)', { plain: { '/about': { status: 404, html: null } } }, '/about (not found)'],
    ['“page not found” served as 200', { pages: { '/': HOME, '/about': SOFT_404 } }, '/about (says “page not found”)'],
  ])('%s: fail, naming it', (_name, f, named) => {
    expect(run('list', f)).toMatchObject({ status: 'fail', sentence: expect.stringContaining(named) })
  })
})

describe('the dates on the list', () => {
  // A date in the future, or one that isn't a real date, makes search engines stop trusting the
  // list's dates: a fail quoting it. The day must exist in its month. (verify-found F24)
  it.each([
    ['a date in the future', '2027-01-01', /dates 1 page in the future \(2027-01-01\)/],
    ['words instead of a date', 'last tuesday', /1 date that isn’t a real date \(last tuesday\)/],
    ['a day the month doesn’t have', '2026-02-31', /1 date that isn’t a real date \(2026-02-31\)/],
  ])('%s: fail, quoting it', (_name, date, said) => {
    expect(run('list', list({ lastmods: ['2026-09-20', date] }))).toMatchObject({ status: 'fail', sentence: expect.stringMatching(said) })
  })
  // Real dates in any W3C form pass: a month or a year alone, or today in a time zone ahead of
  // ours. A text list can't hold dates, so it is never asked for them. (verify-found F24)
  it.each<[string, Partial<Sitemap>]>([
    ['today, in a time zone ahead of ours', { lastmods: ['2026-09-28T23:30:00-05:00', '2026-09-28'] }],
    ['a month or a year alone', { lastmods: ['2026-09', '2026'] }],
    ['a text list with no dates', { format: 'text', lastmods: [null, null] }],
  ])('%s: pass', (_name, over) => {
    expect(run('list', list(over)).status).toBe('pass')
  })
  // No dates at all is a near miss: search engines can't tell what's new.
  it('no dates at all: “Almost”', () => {
    expect(run('list', list({ lastmods: [null, null] }))).toMatchObject({ status: 'fail', lead: 'Almost', sentence: expect.stringMatching(/doesn’t say when each page last changed/) })
  })
  // Every page on one date is often the build time, but can be honest: noted, never judged.
  it('every page on the same date: noted, not judged', () => {
    const r = run('list', list({ urls: [`${O}/`, `${O}/about`, `${O}/x`], lastmods: ['2026-09-28', '2026-09-28', '2026-09-28'], total: 3 }))
    expect(r.status).toBe('pass')
    expect(details(r)).toContain('every page has the same date')
  })
})

describe('the settings file points to the list', () => {
  // A list the settings file doesn't point to is a near miss, said two ways: the file doesn't
  // name it, or there is no file at all. (verify-found F13)
  it.each<[string, Fixture, RegExp]>([
    ['the settings file doesn’t name it', list({ namedInRobots: false }), /settings for search engines don’t point to it/],
    ['there is no settings file (404)', { robots: { status: 404, body: null }, ...list({ namedInRobots: false }) }, /has no settings file for search engines to point to it/],
  ])('%s: “Almost”', (_name, f, said) => {
    expect(run('list', f)).toMatchObject({ status: 'fail', lead: 'Almost', sentence: expect.stringMatching(said) })
  })
  // A settings file we couldn't read is never blamed for not pointing to the list. (verify-found F13)
  it.each<[string, { status: number | null; body: null }]>([
    ['a server error', { status: 500, body: null }],
    ['no answer', { status: null, body: null }],
  ])('a settings file we couldn’t read (%s) is not blamed', (_name, robots) => {
    const r = run('list', { robots, ...list({ namedInRobots: false }) })
    expect(r.status).toBe('pass')
    expect(r.sentence).not.toMatch(/point/)
  })
  // The settings file naming a list on another site while /sitemap.xml works is a note, not a
  // miss. (verify-found F25)
  it('the settings file names a list on another site, and ours works: a note, not a miss', () => {
    const r = run('list', list({ namedInRobots: false, namedElsewhere: ['https://cdn.sitemaps-host.net/s.xml'] }))
    expect(r.status).toBe('pass')
    expect(details(r)).toContain('robots.txt names a list on another site (cdn.sitemaps-host.net)')
  })
})

describe('what we couldn’t open', () => {
  // What we could not open or read may be fine: "couldn't check", never "no list" and never a
  // pass. A person's visit refused on a listed page is our visit being turned away, not a broken
  // page. (verify-found F12, F22, F25)
  it.each<[string, Fixture, RegExp]>([
    ['the list got no answer', { sitemap: { status: null, urls: [], lastmods: [], error: 'timeout' } }, /couldn’t open your list of pages \(no answer in 10 seconds\)/],
    ['the list was refused to us (403)', { sitemap: { status: 403, urls: [], lastmods: [] } }, /wouldn’t show us its list/],
    ['the list gave a server error (500)', { sitemap: { status: 500, urls: [], lastmods: [], url: `${O}/sitemap.xml` } }, /gave an error when we opened it/],
    ['the list gave a server error (502)', { sitemap: { status: 502, urls: [], lastmods: [], url: `${O}/sitemap.xml` } }, /gave an error when we opened it/],
    ['the only list named is on another site', { sitemap: { status: 404, urls: [], lastmods: [], url: `${O}/sitemap.xml`, namedElsewhere: ['https://cdn.sitemaps-host.net/sitemap.xml'] } }, /on another site \(cdn\.sitemaps-host\.net\)/],
    ['the list is too big to read', list({ parsed: false, truncated: true, urls: [], lastmods: [], total: 0 }), /too big for us to read/],
    ['a list inside an index gave a server error', list({ children: [{ url: `${O}/a.xml`, status: 200 }, { url: `${O}/b.xml`, status: 500 }] }), /couldn’t open part of your list/],
    ['a listed page got no answer', { plain: { '/about': { status: null, html: null, error: 'timeout' } } }, /couldn’t open your page \/about from your list/],
    ['the run ran out of time before a listed page', { plain: { '/about': { status: null, html: null, error: 'out-of-time' } } }, /ran out of time before we reached your page \/about/],
    ['a person’s visit to a listed page was refused (403)', { plain: { '/': { status: 403, html: null } } }, /couldn’t open your home page from your list/],
    ['we never read the list', { sitemap: null }, /didn’t open your list of pages/],
  ])('%s: couldn’t check', (_name, f, said) => {
    expect(run('list', f)).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(said) })
  })
  // With no pages opened at all, the list test can't speak for the site.
  it('no pages opened at all: couldn’t check', () => {
    expect(FOUND_TESTS.list({ ...evidence(), paths: [] }).status).toBe('unknown')
  })
})

describe('what the sentence and details say', () => {
  // A long list is counted whole (not the part we kept), only the pages we opened are judged, and
  // the sentence says how few that is. (verify-found F23)
  it('a list of 10,000 pages: counted whole, and the sentence says we opened 2', () => {
    const r = run('list', list({ total: 10_000, truncated: true }))
    expect(r).toMatchObject({ status: 'pass', value: '10,000 pages', sentence: expect.stringMatching(/We opened 2 of the 10,000, and they work/) })
    expect(details(r)).toContain('too long to read whole; we read only the start')
  })
  // An index whose lists we read only some of says so. (verify-found F23)
  it('an index read in part: the sentence says how many of its lists we read', () => {
    const r = run('list', list({ children: [{ url: `${O}/a.xml`, status: 200 }, { url: `${O}/b.xml`, status: 200 }, { url: `${O}/c.xml`, status: 200 }], childTotal: 5 }))
    expect(r.sentence).toMatch(/we read 3 of its 5 lists/)
  })
  // A listed page that asks not to be listed, and addresses spelled another way than the site
  // answers on, are noted (the allowed test judges the first). (verify-found F25)
  it('a listed page that asks not to be listed, and other spellings of the site, are noted', () => {
    const noindexed = run('list', { pages: { '/': HOME, '/about': ABOUT.replace('<head>', '<head><meta name="robots" content="noindex">') } })
    expect(details(noindexed)).toContain('/about on the list asks not to be listed')
    expect(details(run('list', list({ otherSpelling: 2 })))).toContain('2 addresses spelled with http:// or another form of your domain')
  })
})
