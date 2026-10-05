/**
 * "Your words are in the page itself" passes only when the artist's published bio, releases and
 * upcoming shows are written on the pages as text a reader with scripts off can see.
 *
 * Code:     src/lib/seo-tests/found.ts (words, and the word matching it shares with the bot tests)
 * Feature:  words (Test tab group "Can be found")
 * Tier:     STRICT (AGENTS.md "Test depth"): it compares the live site to what the artist
 *           published and tells the manager what AI tools can't read.
 * Covers:   • the bio: missing, only in the hidden fact card or description, or only in part
 *           • releases and upcoming shows: missing, named by title, a venue without its date or city
 *           • how words are matched: entities, tags inside words, <noscript>, whole words only,
 *             never from a title, an attribute or a script
 *           • names too short to prove anything are left out, and said so
 *           • never saying words are missing when a page wasn't opened or couldn't be read
 * Not here: the rules shared by all ten tests (contract.test.ts); a bot's copy missing the
 *           artist's words (bots.test.ts).
 * Fixtures: ../_found-fixtures.ts: a healthy two-page site for the artist Skeen (a two-sentence bio,
 *           two releases, one upcoming and one past show); each case changes a page or what Tapir
 *           has published.
 */
import { describe, expect, it } from 'vitest'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import type { SeoKnown } from '@/lib/seo-tests/types'
import { ABOUT, BIO, HOME, KNOWN, O, SITEMAP_OK, details, doc, evidence, run, type Fixture } from '@tests/unit/seo-tests/_found-fixtures'

type Published = NonNullable<SeoKnown['published']>
/** What Tapir has published, with some fields changed. */
const known = (over: Partial<Published> = {}): SeoKnown => ({ ...KNOWN, published: { ...KNOWN.published!, ...over } })
/** A one-page site whose only page shows `body`; its menu links stay on the page, so none is left unopened. */
const onePage = (body: string, over: Partial<Published> = {}): Fixture => ({
  pages: { '/': doc('Skeen', `<nav><a href="/">Home</a> <a href="#live">Live</a></nav><main><h1>Skeen</h1>${body}</main>`) },
  sitemap: { ...SITEMAP_OK, urls: [`${O}/`], total: 1 },
  known: known(over),
})
const noBioAbout = ABOUT.replace(/<p>Skeen is a Chicago DJ[\s\S]*?<\/p>/, '')

describe('a healthy site', () => {
  // The exact words a manager reads when everything is on the page, with the counts in the details.
  it('passes, word for word, with each count in the details', () => {
    const r = run('words')
    expect(r).toMatchObject({ status: 'pass', value: 'bio, 2 releases, 1 show' })
    expect(r.sentence).toBe('Your bio, 2 releases and 1 show are right in the page, as words.')
    expect(details(r)).toContain('bio: 2 of 2 sentences in the text')
    expect(details(r)).toContain('releases: 2 of 2 in the text')
    expect(details(r)).toContain('shows: 1 of 1 upcoming in the text')
  })
})

describe('the bio', () => {
  // A bio only in the hidden fact card (JSON-LD) or the page description is not on the page as
  // words, and the sentence says where it is instead, in plain words (UI review, 2026-09-29).
  it.each<[string, Fixture]>([
    ['only in the fact card', { pages: { '/': HOME, '/about': ABOUT.replace(/<p>Skeen is a Chicago DJ[\s\S]*?<\/p>/, '<p>More soon.</p>') } }],
    ['only in the page description', { pages: { '/': HOME.replace('Skeen is a Chicago house DJ and producer.', BIO).replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, ''), '/about': noBioAbout } }],
  ])('%s: fail, saying it is where search engines look but not where people read', (_name, f) => {
    expect(run('words', f)).toMatchObject({ status: 'fail', value: 'bio missing', sentence: expect.stringMatching(/where search engines see it, but not where people read it/) })
  })
  // Part of the bio is counted by sentence.
  it('half the bio: fail with the count', () => {
    const about = ABOUT.replace(' He&rsquo;s played ZHU at Navy Pier and remixed Flume for the OutWest EP.', '')
    expect(run('words', { pages: { '/': HOME, '/about': about } })).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/only 1 of 2 sentences of your bio/) })
  })
  // A bio of short fragments ("DJ. NYC. Yes.") is still looked for, whole. (verify-found F28)
  it('a bio of short fragments is still looked for', () => {
    expect(run('words', onePage('<p>A song.</p>', { bio: 'DJ. NYC. Yes.', releases: [], tourDates: [] }))).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/your bio isn’t on your pages as words/) })
  })
  // A web address in the bio matches the page showing it without "https://". (verify-found F28)
  it('a web address in the bio matches the page showing it without https://', () => {
    const f = onePage('<p>Skeen is a Chicago DJ.</p><p>Read more at <a href="https://skeen.com/press">skeen.com/press</a>.</p>', { bio: 'Skeen is a Chicago DJ. Read more at https://skeen.com/press.', releases: [], tourDates: [] })
    expect(run('words', f).status).toBe('pass')
  })
})

describe('releases and shows', () => {
  // A missing release is named. The count is what the pages showed; the names are Tapir's, and
  // are labelled so (types.ts rule 3).
  it('a release missing: fail naming it, the names labelled as Digital Tapir’s', () => {
    const home = HOME.replace('<li>OutWest</li>', '').replace(/OutWest EP/g, 'EP')
    const r = run('words', { pages: { '/': home, '/about': ABOUT.replace(/OutWest EP/g, 'EP') }, known: known({ bio: 'Skeen is a Chicago DJ and producer.' }) })
    expect(r).toMatchObject({ status: 'fail', value: '1 item missing', sentence: expect.stringContaining('“OutWest”') })
    expect(r.evidence).toContainEqual({ label: 'releases', value: '1 of 2 in the text' })
    expect(r.evidence).toContainEqual({ label: 'in Digital Tapir: releases not in the text', value: 'OutWest' })
  })
  // An upcoming show missing is named; a past show is never looked for.
  it('an upcoming show missing: fail naming it; a past show is not looked for', () => {
    const r = run('words', { pages: { '/': HOME.replace('Oct 4 · Hideaway, Chicago', 'Oct 4 · TBA'), '/about': ABOUT } })
    expect(r).toMatchObject({ status: 'fail', sentence: expect.stringContaining('“Hideaway”') })
    expect(r.evidence).toContainEqual({ label: 'in Digital Tapir: shows not in the text', value: 'Hideaway' })
    // Navy Pier is past (and only in the bio): it is never listed as a show.
    expect(details(run('words'))).not.toMatch(/Navy Pier/)
  })
  // A show counts only when its venue is near its city or date (a venue name alone can be
  // anywhere). A venue on the page without either is said as exactly that; a show with no venue
  // is not looked for, and the details say so. (verify-found F27)
  it('a venue without its date or city: said as that; a show with no venue: not looked for', () => {
    const f = onePage('<p>Skeen is from Chicago. Hideaway is a bar he likes a lot and has written about many many times in his notes over the years since he was young.</p>', {
      bio: null, releases: [], tourDates: [{ date: '2026-10-04', venue: 'Hideaway', city: 'Milwaukee', isPast: false }, { date: '2026-11-02', venue: null, city: 'Chicago', isPast: false }],
    })
    const r = run('words', f)
    expect(r).toMatchObject({ status: 'fail', sentence: expect.stringMatching(/name “Hideaway” but not the show’s date or city/) })
    expect(details(r)).toContain('a show in Chicago (no venue name to look for)')
  })
  // One release is "is", not "are". (verify-found F28)
  it('one release: “is right in the page”', () => {
    expect(run('words', onePage('<p>OutWest is out now on every service.</p>', { bio: null, tourDates: [], releases: [{ title: 'OutWest', releasedOn: null }] }))).toMatchObject({ status: 'pass', sentence: expect.stringMatching(/Your 1 release is right in the page/) })
  })
})

describe('how words are matched', () => {
  // The same words written with entities, curly quotes, line breaks, a tag in the middle of a
  // word, or inside <noscript> (a reader with scripts off reads it) are found. (verify-found F28)
  it.each<[string, Fixture]>([
    ['entities, curly quotes, line breaks and tags around words', { pages: { '/': HOME, '/about': ABOUT.replace('He&rsquo;s played', 'He&#x27;s\n   <em>played</em>').replace('Navy Pier', 'Navy&nbsp;Pier') } }],
    ['a tag in the middle of a word (“Out<b>West</b>”)', { pages: { '/': HOME.replace('<li>OutWest</li>', '<li>Out<b>West</b></li>'), '/about': ABOUT.replace('OutWest EP', 'EP') }, known: known({ bio: 'Skeen is a Chicago DJ and producer.' }) }],
    ['text inside <noscript>', onePage('<noscript><p>OutWest is out now on every service.</p></noscript>', { bio: null, tourDates: [], releases: [{ title: 'OutWest', releasedOn: null }] })],
  ])('%s: found', (_name, f) => {
    expect(run('words', f).status).toBe('pass')
  })
  // Words only in the <title>, an attribute or a script are not on the page for a reader.
  it('text only in the title, an attribute or a script: not found', () => {
    const home = doc('You Were There · OutWest · Hideaway', '<main><h1 title="OutWest">Skeen</h1><img alt="Hideaway"><script>var t = "You Were There OutWest Hideaway"</script></main>')
    const r = run('words', { pages: { '/': home }, sitemap: { ...SITEMAP_OK, urls: [`${O}/`], total: 1 }, known: known({ bio: null }) })
    expect(r).toMatchObject({ status: 'fail', value: '3 items missing' })
  })
  // A name matches whole words only, and never from the menu: "Date" is not in "update",
  // "Therein" is not "there in", and "Home" / "Live" in the menu are not the release and venue.
  // (verify-found F27)
  it.each<[string, string, Partial<Published>]>([
    ['“Date” inside “update”', '<p>Tour update coming soon for everyone who asked.</p>', { tourDates: [], releases: [{ title: 'Date', releasedOn: null }] }],
    ['“Therein” across “there in”', '<p>We left it out there in the cold for a whole winter, and nobody came back.</p>', { tourDates: [], releases: [{ title: 'Therein', releasedOn: null }] }],
    ['“Home” and “Live” only in the menu', '<p>Chicago house DJ and producer, playing all over the city every weekend of the year.</p>', { releases: [{ title: 'Home', releasedOn: null }], tourDates: [{ date: '2026-11-02', venue: 'Live', city: 'Chicago', isPast: false }] }],
  ])('%s: not found', (_name, body, over) => {
    expect(run('words', onePage(body, { bio: null, ...over })).status).toBe('fail')
  })
})

describe('what can’t be looked for', () => {
  // A title under 3 letters or digits ("Up", "X", "22", "!!!") could match anything: it is left
  // out, the details say so, and with nothing left the test does not apply. (verify-found F27)
  it.each([
    ['“Up”', [{ title: 'Up', releasedOn: null }]],
    ['“X”, “22” and “!!!”', [{ title: 'X', releasedOn: null }, { title: '22', releasedOn: null }, { title: '!!!', releasedOn: null }]],
  ])('titles too short to prove anything (%s): left out, and said so', (_name, releases) => {
    const r = run('words', onePage('<p>Mixed in Dolby x Atmos. Nov 22 2026. Tour update coming soon.</p>', { bio: null, tourDates: [], releases }))
    expect(r.status).toBe('na')
    expect(details(r)).toMatch(/too short to look for/)
  })
  // With nothing published we can't look (couldn't check); with nothing to look for, the test
  // doesn't apply (types.ts rule 4), which is not the same.
  it('nothing published: couldn’t check; nothing to look for: doesn’t apply', () => {
    expect(run('words', { known: { ...KNOWN, published: null } }).status).toBe('unknown')
    expect(run('words', { known: known({ bio: null, releases: [], tourDates: [] }) })).toMatchObject({ status: 'na', value: 'nothing to look for' })
  })
})

describe('pages we didn’t open or couldn’t read', () => {
  // Words missing from the pages we read may be on a page we couldn't read or never opened:
  // "couldn't check", never "your bio isn't there", with the unread pages in the details.
  // (verify-found F26)
  it.each<[string, Fixture, string]>([
    ['a page could not be read', { pages: { '/': HOME, '/about': noBioAbout, '/music': '' }, plain: { '/music': { status: null, html: null, error: 'timeout' } } }, 'not read: /music'],
    ['the home page links to a page we didn’t open', { pages: { '/': HOME.replace('<a href="#music">Music</a>', '<a href="#music">Music</a> <a href="/bio">Bio</a>') }, sitemap: { status: 404, urls: [], lastmods: [] } }, 'not opened: 2 more pages on your site'],
    ['the list names more pages than we opened', { pages: { '/': HOME, '/about': noBioAbout }, sitemap: { ...SITEMAP_OK, total: 7 } }, 'not opened: 5 more pages on your site'],
  ])('%s: couldn’t check', (_name, f, unread) => {
    const r = run('words', f)
    expect(r).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/weren’t on the pages we opened/) })
    expect(details(r)).toContain(unread)
  })
  // …but with every page of the site opened and read, missing is missing: a fail. (verify-found F26)
  it('every page opened and still missing: fail', () => {
    const home = HOME.replace(/<nav>[\s\S]*?<\/nav>/, '<nav><a href="/">Home</a> <a href="/about">About</a></nav>')
    expect(run('words', { pages: { '/': home, '/about': noBioAbout.replace(/<nav>[\s\S]*?<\/nav>/, '') } }).status).toBe('fail')
  })
  // No page read, or none opened at all: couldn't check.
  it('no page could be read, or none was opened: couldn’t check', () => {
    expect(run('words', { plain: { '/': { status: 503, html: null }, '/about': { status: 503, html: null } } })).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/couldn’t read any of your pages/) })
    expect(FOUND_TESTS.words({ ...evidence(), paths: [] }).status).toBe('unknown')
  })
})
