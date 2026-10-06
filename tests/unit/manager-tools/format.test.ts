// The manager tools' shared formats (src/lib/manager-tools/format.ts).
/**
 * shortDay replaced five hand-written day labels that differed in locale, time zone and when the
 * year shows (2026-10-01 consolidation, "nothing looks different"). The first block pins that
 * each caller's options print EXACTLY what its old copy printed: the old expressions are kept
 * here as the oracle, over dates that sit on the edges (a year boundary, late in a UTC day, a
 * leap day, the same day a year apart).
 */
import { describe, expect, it } from 'vitest'
import { SAVE_FAILED, clockTime, listWords, minutesSeconds, plural, shortDay, shortLink } from '@/lib/manager-tools/format'

const DATES = [
  '2026-09-29T12:00:00Z',
  '2026-01-01T00:30:00Z',
  '2025-12-31T23:30:00Z',
  '2026-09-22T23:30:00-05:00',
  '2024-02-29T08:00:00Z',
  '2025-09-29T12:00:00Z',
].map((iso) => new Date(iso))
const NOWS = [new Date(2026, 8, 30, 10), new Date(2025, 11, 31, 23)]

describe('shortDay reproduces every copy it replaced', () => {
  it('subscribers (en-US, UTC, always the year)', () => {
    for (const d of DATES) expect(shortDay(d, { locale: 'en-US', timeZone: 'UTC' })).toBe(d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }))
  })

  it('crawl cards and enquiries (a given locale, the local zone, always the year)', () => {
    for (const locale of ['en-US', 'en-GB', undefined])
      for (const d of DATES) expect(shortDay(d, { locale })).toBe(d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }))
  })

  it('bio rows and test times (the year only when it is not the year of now)', () => {
    for (const now of NOWS)
      for (const locale of ['en-US', 'en-GB', undefined])
        for (const d of DATES) {
          const old = d.toLocaleDateString(locale, d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
          expect(shortDay(d, { locale, now }), `${d.toISOString()} now ${now.toISOString()}`).toBe(old)
          expect(shortDay(d, { locale, now: now.getTime() })).toBe(old)
        }
  })

  it('reads as Sam sees it', () => {
    const now = new Date(2026, 8, 30, 10)
    expect(shortDay(new Date(2026, 8, 29, 12), { locale: 'en-US', now })).toBe('Sep 29')
    expect(shortDay(new Date(2025, 8, 29, 12), { locale: 'en-US', now })).toBe('Sep 29, 2025')
    expect(shortDay(new Date('2026-09-22T23:30:00-05:00'), { locale: 'en-US', timeZone: 'UTC' })).toBe('Sep 23, 2026')
  })
})

describe('clockTime, plural, shortLink, SAVE_FAILED', () => {
  it('clockTime is the hour and minute, as the test history and enquiries wrote it', () => {
    for (const d of DATES) expect(clockTime(d, 'en-US')).toBe(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    expect(clockTime(new Date(2026, 8, 28, 21, 4), 'en-US')).toBe('9:04 PM')
  })

  it('plural: the count, then the word that agrees with it', () => {
    expect(plural(1, 'page', 'pages')).toBe('1 page')
    expect(plural(0, 'page', 'pages')).toBe('0 pages')
    expect(plural(3, 'page says', 'pages say')).toBe('3 pages say')
  })

  /**
   * ONE shortener for the three places that printed a web address three ways (profiles, the
   * crawl cards, the AI test's evidence; prototypes/batch2_compare_20261002.html item 5, Sam
   * said yes 2026-10-02). The first seven rows are that comparison's table, its "Proposed"
   * column verbatim. `www.` stays because the crawl's Address card prints "skeenmusic.com →
   * www.skeenmusic.com": dropping it would print the same address twice.
   */
  it.each([
    ['https://www.skeenmusic.com/', 'www.skeenmusic.com'],
    ['https://skeenmusic.com', 'skeenmusic.com'],
    ['https://www.skeenmusic.com/about', 'www.skeenmusic.com/about'],
    ['https://www.instagram.com/skeeeeeeen/', 'www.instagram.com/skeeeeeeen/'],
    ['https://open.spotify.com/artist/26KxuQ1gIw8VP8YX2IkMWR', 'open.spotify.com/artist/26KxuQ1gIw8VP8YX2IkMWR'],
    ['http://skeenmusic.com/', 'http://skeenmusic.com'],
    ['https://www.discogs.com/artist/1234-Skeen#images', 'www.discogs.com/artist/1234-Skeen'],
    // Beyond the table: a query is part of the address; only the home page's LONE slash goes.
    ['https://www.skeenmusic.com/robots.txt?x=1', 'www.skeenmusic.com/robots.txt?x=1'],
    ['https://skeenmusic.com/?x=1', 'skeenmusic.com/?x=1'],
    ['https://skeenmusic.com/#top', 'skeenmusic.com'],
    ['HTTPS://skeenmusic.com/', 'skeenmusic.com'],
    ['HTTP://skeenmusic.com/a', 'http://skeenmusic.com/a'],
    ['  https://skeenmusic.com/  ', 'skeenmusic.com'],
    // An address inside something else is not a web address.
    ['/go?to=https://skeenmusic.com/', '/go?to=https://skeenmusic.com/'],
    // Not a web address: as it came.
    ['mailto:booking@skeenmusic.com', 'mailto:booking@skeenmusic.com'],
    ['/images/a.jpg', '/images/a.jpg'],
    ['(no address)', '(no address)'],
  ])('shortLink(%s) is %s', (url, short) => {
    expect(shortLink(url)).toBe(short)
  })

  // The crawl cards pass a missing address (null) straight in; it must print nothing, not "null".
  it('shortLink of nothing is empty', () => {
    expect(shortLink(null)).toBe('')
    expect(shortLink(undefined)).toBe('')
    expect(shortLink('')).toBe('')
  })

  it('SAVE_FAILED is the sentence every tool showed', () => {
    expect(SAVE_FAILED).toBe('Couldn’t save that.')
  })
})

/**
 * listWords replaced the "a, b and c" join hand-written in nine modules (2026-10-05, "consolidate
 * shared code"): the Publish bars, the bio and kind sentences, the AI test's sentences, the merge
 * refusal, the analytics "no plays … or video clicks". The copies' own expression is kept here as
 * the oracle, so a change to the word order (an Oxford comma, a lone item) goes red.
 */
describe('listWords reproduces the join it replaced', () => {
  const old = (xs: string[], joiner: string) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${joiner} ${xs[xs.length - 1]}`)
  const LISTS = [[], ['bio'], ['city', 'genre'], ['name', 'bio', 'genre'], ['a', 'b', 'c', 'd'], ['', 'x']]

  it('matches the copies for every length, with "and" and "or"', () => {
    for (const xs of LISTS) {
      expect(listWords(xs), xs.join('|')).toBe(old(xs, 'and'))
      expect(listWords(xs, 'or'), xs.join('|')).toBe(old(xs, 'or'))
    }
  })

  it('reads as the sentences print it: no comma before the last word', () => {
    expect(listWords([])).toBe('')
    expect(listWords(['bio'])).toBe('bio')
    expect(listWords(['city', 'genre'])).toBe('city and genre')
    expect(listWords(['name', 'bio', 'genre'])).toBe('name, bio and genre')
    expect(listWords(['plays', 'link clicks', 'video clicks'], 'or')).toBe('plays, link clicks or video clicks')
  })
})

/**
 * minutesSeconds replaced the m:ss written three times (the code window's resend countdown, the AI
 * test's running clock, a song's play time). Each caller keeps its own edge rule (nothing at 0, never
 * below 0:00); this is only the shape.
 */
describe('minutesSeconds', () => {
  it('is whole minutes, then two-digit seconds', () => {
    expect(minutesSeconds(0)).toBe('0:00')
    expect(minutesSeconds(7)).toBe('0:07')
    expect(minutesSeconds(60)).toBe('1:00')
    expect(minutesSeconds(92)).toBe('1:32')
    expect(minutesSeconds(605)).toBe('10:05')
  })

  // A song's position arrives in fractional seconds; the old player floored both halves.
  it('floors a fraction, as the player did', () => {
    expect(minutesSeconds(59.9)).toBe('0:59')
    expect(minutesSeconds(61.5)).toBe('1:01')
  })
})
