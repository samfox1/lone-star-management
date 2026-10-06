// "Your spot on Google": where the artist's site sits when someone searches their NAME, day by
// day — the line the Search page climbs. Worked out from every search's spot per day (the
// [query, date] rows), so a site seen for more and more searches is not read as falling.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nameSpot, namesArtist, searchTrend, spotFacts } from '@/lib/manager-tools/seo/search-spot'
import type { SearchDayRow } from '@/lib/manager-tools/seo/search-stats'

// Skeen's REAL searches by day (tests/fixtures/search-stats.json, google_query_date_all).
const FX = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/search-stats.json'), 'utf8')) as { google_query_date_all: { rows: { keys: string[]; impressions: number; position: number }[] } }
const SKEEN: SearchDayRow[] = FX.google_query_date_all.rows.map((r) => ({ key: r.keys[0], date: r.keys[1], impressions: r.impressions, position: r.position }))

describe('namesArtist', () => {
  it('CRITICAL: the name\'s words, whole and together, anywhere in the search', () => {
    expect(namesArtist('skeen dj', 'Skeen')).toBe(true)
    expect(namesArtist('dj skeen', 'Skeen')).toBe(true)
    expect(namesArtist('SKEEN', 'Skeen')).toBe(true)
    expect(namesArtist('skeena river', 'Skeen')).toBe(false) // part of another word
    expect(namesArtist('chicago house dj', 'Skeen')).toBe(false)
  })

  it('a name of several words matches only with all of them in order; accents and punctuation do not count', () => {
    expect(namesArtist('lone pine live', 'Lone Pine')).toBe(true)
    expect(namesArtist('pine lone', 'Lone Pine')).toBe(false)
    expect(namesArtist('lone wolf pine', 'Lone Pine')).toBe(false)
    expect(namesArtist('beyonce tour', 'Beyoncé')).toBe(true)
    expect(namesArtist('a$ap rocky', 'A$AP Rocky')).toBe(true)
    expect(namesArtist('skeen-dj', 'Skeen')).toBe(true)
    // An accent inside a word is dropped, not turned into a gap ("ros", never "ro s").
    expect(namesArtist('sigur ros live', 'Sigur Rós')).toBe(true)
    // Punctuation at a name's ends, or several marks in a row, are one gap or none.
    expect(namesArtist('skeen dj', 'Skeen!')).toBe(true)
    expect(namesArtist('skeen -- dj', 'Skeen DJ')).toBe(true)
  })

  it('a name with no words in it names nothing', () => {
    expect(namesArtist('anything', '  ')).toBe(false)
    expect(namesArtist('anything', '!!!')).toBe(false)
  })
})

describe('nameSpot', () => {
  it('CRITICAL: Skeen\'s real days — every search naming Skeen, weighted by how often each was seen', () => {
    expect(nameSpot(SKEEN, 'Skeen')).toEqual([
      { date: '2026-09-29', spot: 39 / 17, seen: 17 }, // skeen dj 13 at 2.15, dj skeen 2 at 2.5, skeen music 2 at 3
      { date: '2026-09-30', spot: 29 / 12, seen: 12 },
      { date: '2026-10-01', spot: 47 / 17, seen: 17 },
      { date: '2026-10-02', spot: 47 / 18, seen: 18 },
    ].map((p) => ({ ...p, spot: expect.closeTo(p.spot, 10) })))
  })

  it('CRITICAL: a search that does not name the artist is left out — it is reach, not their spot', () => {
    const rows: SearchDayRow[] = [
      { key: 'skeen', date: '2026-10-01', impressions: 10, position: 1 },
      { key: 'chicago house dj', date: '2026-10-01', impressions: 90, position: 30 },
      { key: 'house music', date: '2026-10-02', impressions: 5, position: 12 },
    ]
    expect(nameSpot(rows, 'Skeen')).toEqual([{ date: '2026-10-01', spot: 1, seen: 10 }])
  })

  it('oldest day first, whatever order the rows come in', () => {
    const rows: SearchDayRow[] = [
      { key: 'skeen', date: '2026-10-03', impressions: 1, position: 2 },
      { key: 'skeen', date: '2026-10-01', impressions: 1, position: 3 },
    ]
    expect(nameSpot(rows, 'Skeen').map((p) => p.date)).toEqual(['2026-10-01', '2026-10-03'])
  })
})

describe('spotFacts', () => {
  const pt = (i: number, spot: number, seen = 10) => ({ date: `2026-09-${String(10 + i).padStart(2, '0')}`, spot, seen })
  it('CRITICAL: now is the last week of readings, weighted by how often each day was seen — a half-counted day seen once does not swing it', () => {
    // Skeen, 2026-10-06: six days near #2.4, then today at #4 from a single impression.
    const days = [pt(0, 2.4, 17), pt(1, 2.5, 12), pt(2, 2.4, 17), pt(3, 2.6, 18), pt(4, 2.3, 10), pt(5, 2.5, 9), pt(6, 4, 1)]
    const f = spotFacts(days)!
    const week = days.slice(-7)
    expect(f.now).toBeCloseTo(week.reduce((n, p) => n + p.spot * p.seen, 0) / week.reduce((n, p) => n + p.seen, 0), 10)
    expect(f.now).toBeLessThan(2.6)
  })
  it('CRITICAL: the average is over every day, weighted; the climb is the first week against the last, places gained (a smaller spot is higher)', () => {
    const days = [...Array.from({ length: 7 }, (_, i) => pt(i, 2.6)), ...Array.from({ length: 7 }, (_, i) => pt(7 + i, 1.4, 30))]
    expect(spotFacts(days)).toEqual({
      now: expect.closeTo(1.4, 10),
      average: expect.closeTo((2.6 * 70 + 1.4 * 210) / 280, 10),
      climbed: expect.closeTo(1.2, 10),
      since: '2026-09-10',
    })
  })
  it('CRITICAL: no climb until there are two whole weeks to compare; a fall is a negative climb; no days, no facts', () => {
    expect(spotFacts(Array.from({ length: 13 }, (_, i) => pt(i, 3 - i * 0.1)))!.climbed).toBeNull()
    const falling = [...Array.from({ length: 7 }, (_, i) => pt(i, 1.5)), ...Array.from({ length: 7 }, (_, i) => pt(7 + i, 2))]
    expect(spotFacts(falling)!.climbed).toBeCloseTo(-0.5, 10)
    expect(spotFacts([])).toBeNull()
  })
})

describe('searchTrend', () => {
  it('one search\'s spot, day by day, oldest first', () => {
    expect(searchTrend(SKEEN, 'skeen dj')).toEqual([2.1538461538461537, 2.3636363636363633, 2.9333333333333336, 2.6470588235294117])
    expect(searchTrend(SKEEN, 'nobody searched this')).toEqual([])
  })
})
