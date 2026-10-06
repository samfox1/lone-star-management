/**
 * The Search tab's words: what the artist reads about their own search numbers, and how the two
 * engines sit side by side without being added together.
 *
 * Code:     src/lib/manager-tools/seo/search-model.ts, src/lib/manager-tools/seo/country-a3.ts
 * Feature:  SEO / GEO page · Search tab, "How fans find you" (Sam, 2026-10-02,
 *           prototypes/search_tab_20261002.html; "Both" side by side, Bing "usually" 2 weeks)
 * Tier:     STRICT (AGENTS.md "Test depth"): these words decide what the artist is told about
 *           their audience (a rounding must never say something false), and a page address from
 *           an engine ends up in a link.
 * Covers:   • click rate: never "0%" above zero, never "100%" below one, "—" with nothing seen;
 *             "1 in 4 clicked", "most clicked" above one in two, nothing at zero
 *           • the spot: one decimal, a whole number bare, "—" with none
 *           • the rare-searches line: each side only when above zero, "click" for one
 *           • side by side: one date axis from the first day either engine has to the last; an
 *             engine is null outside its own days (never a zero), a zero inside them; the chart's
 *             lines follow that axis and nothing is ever summed across engines
 *           • the lists side by side: each engine's own row, a search both list next to each
 *             other, busiest first
 *           • no numbers: a new site within the engine's usual wait (Bing 2 weeks) says "usually";
 *             older, or no date, says none in the period; every couldn't-ask state has words
 *           • a page row links only to http(s) without credentials; the country table matches
 *             i18n-iso-countries
 * Not here: the numbers' shape (search-stats.test.ts); the page's layout (tests/components/
 *           manager-tools/seo/search-tab.test.tsx).
 * Fixtures: small hand-made answers in search-stats.ts's own types; the country table is checked
 *           against the i18n-iso-countries package it was generated from.
 */
import iso from 'i18n-iso-countries'
import { describe, expect, it } from 'vitest'
import { A3_TO_A2_TABLE, countryFromA3 } from '@/lib/manager-tools/seo/country-a3'
import {
  ENGINE_VIEWS,
  alignDays,
  barOf,
  chartOf,
  engineNote,
  engineViewOf,
  oneInWords,
  pageWords,
  rareWords,
  rateWords,
  sideBySideRows,
  sinceWords,
  spotWords,
} from '@/lib/manager-tools/seo/search-model'
import { COULDNT_ASK, couldntAsk, type SearchDay, type SearchPeriod, type SearchRow, type SearchStats } from '@/lib/manager-tools/seo/search-stats'

const P28: SearchPeriod = { key: '28d', days: 28, start: '2026-09-05', end: '2026-10-02' }
const P3M: SearchPeriod = { key: '3m', days: 90, start: '2026-07-05', end: '2026-10-02' }
const day = (date: string, clicks: number, impressions: number, final = true): SearchDay => ({ date, clicks, impressions, final })
const row = (key: string, clicks: number, impressions: number): SearchRow => ({ key, clicks, impressions, ctr: impressions ? clicks / impressions : null, position: 2 })
const stats = (engine: 'google' | 'bing', series: SearchDay[]): SearchStats => ({
  engine,
  period: P28,
  totals: { clicks: 0, impressions: 0, ctr: null, position: null },
  series,
  queries: [],
  searchDays: [],
  pages: [],
  countries: null,
  devices: null,
  unlisted: { clicks: 0, impressions: 0 },
  coverage: series.length ? { from: series[0].date, to: series[series.length - 1].date } : null,
  preliminaryFrom: null,
})

describe('the click rate', () => {
  // Skeen's real 15 of 59 reads 25%, and a rounding never flips a rate to a false 0% or 100%.
  it('CRITICAL: a whole percent that never rounds to a false 0% or 100%', () => {
    expect(rateWords(15 / 59)).toBe('25%')
    expect(rateWords(0.2631578947368421)).toBe('26%')
    expect(rateWords(null)).toBe('—')
    expect(rateWords(0)).toBe('0%')
    expect(rateWords(0.004)).toBe('<1%')
    expect(rateWords(0.005)).toBe('1%')
    expect(rateWords(0.996)).toBe('>99%')
    expect(rateWords(1)).toBe('100%')
  })

  // The plain-words line under it: "1 in N" up to one in two; above that "most"; all is "all".
  it('CRITICAL: "1 in 4 clicked", "most clicked" above one in two, nothing at zero', () => {
    expect(oneInWords(0.2631578947368421)).toBe('1 in 4 clicked')
    expect(oneInWords(0.5)).toBe('1 in 2 clicked')
    expect(oneInWords(0.35)).toBe('1 in 3 clicked')
    expect(oneInWords(0.001)).toBe('1 in 1,000 clicked')
    expect(oneInWords(0.7)).toBe('most clicked')
    expect(oneInWords(0.51)).toBe('most clicked')
    expect(oneInWords(1)).toBe('all clicked')
    expect(oneInWords(0)).toBeNull()
    expect(oneInWords(null)).toBeNull()
  })
})

describe('the average spot', () => {
  // One decimal; a whole number without ".0"; no spot is a dash, never "0".
  it('CRITICAL: one decimal, a whole number bare, "—" with none', () => {
    expect(spotWords(2.456140350877193)).toBe('2.5')
    expect(spotWords(2.4)).toBe('2.4')
    expect(spotWords(1)).toBe('1')
    expect(spotWords(1.04)).toBe('1')
    expect(spotWords(11.96)).toBe('12')
    expect(spotWords(null)).toBe('—')
    expect(spotWords(Number.NaN)).toBe('—')
  })
})

describe('the rare-searches line', () => {
  // What the list leaves out, said out loud; a zero side is left out, and nothing says nothing.
  it('CRITICAL: each side only when above zero, "click" for one', () => {
    expect(rareWords({ clicks: 3, impressions: 15 })).toBe('+ 3 clicks · 15 seen from rare searches')
    expect(rareWords({ clicks: 1, impressions: 1 })).toBe('+ 1 click · 1 seen from rare searches')
    expect(rareWords({ clicks: 0, impressions: 15 })).toBe('+ 15 seen from rare searches')
    expect(rareWords({ clicks: 2, impressions: 0 })).toBe('+ 2 clicks from rare searches')
    expect(rareWords({ clicks: 1200, impressions: 34000 })).toBe('+ 1,200 clicks · 34,000 seen from rare searches')
    expect(rareWords({ clicks: 0, impressions: 0 })).toBeNull()
  })
})

describe('side by side: one date axis', () => {
  // Google Sep 29 – Oct 1, Bing Sep 30 – Oct 3: the axis runs Sep 29 – Oct 3, each engine only on
  // its own days (null outside them, never a zero), Google's still-counting day kept as such.
  it('CRITICAL: every day either engine has; an engine is null outside its own days', () => {
    const pairs = alignDays({
      google: [day('2026-09-29', 6, 23), day('2026-09-30', 5, 14), day('2026-10-01', 4, 19, false)],
      bing: [day('2026-09-30', 1, 2), day('2026-10-01', 0, 3), day('2026-10-02', 2, 2), day('2026-10-03', 1, 1)],
    })
    expect(pairs.map((p) => p.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])
    expect(pairs.map((p) => p.google?.clicks ?? null)).toEqual([6, 5, 4, null, null])
    expect(pairs.map((p) => p.bing?.impressions ?? null)).toEqual([null, 2, 3, 2, 1])
    expect(pairs[2].google).toEqual({ clicks: 4, impressions: 19, final: false })
  })

  // A gap between the engines' runs is on the axis with neither engine on it; a day missing
  // inside a run is a real zero day; one engine alone, or none, works.
  it('CRITICAL: a gap between runs is null for both; a missing day inside a run is a zero', () => {
    const pairs = alignDays({ google: [day('2026-09-01', 1, 2), day('2026-09-03', 3, 4)], bing: [day('2026-09-05', 1, 1)] })
    expect(pairs.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'])
    expect(pairs[1].google).toEqual({ clicks: 0, impressions: 0, final: true })
    expect(pairs[3]).toEqual({ date: '2026-09-04', google: null, bing: null })
    expect(alignDays({ google: [day('2026-09-01', 1, 2)], bing: null }).map((p) => [p.google?.clicks, p.bing])).toEqual([[1, null]])
    expect(alignDays({ google: null, bing: [] })).toEqual([])
  })

  // The chart beside both engines: one line per engine per number on that axis, each engine its
  // own colour, the values the engine's own (never a sum), Seen under Clicks.
  it('CRITICAL: the chart draws each engine’s own values on the shared axis, never summed', () => {
    const c = chartOf('both', { google: stats('google', [day('2026-09-29', 6, 23), day('2026-09-30', 5, 14, false)]), bing: stats('bing', [day('2026-09-30', 1, 2)]) })
    expect(c.days).toEqual(['2026-09-29', '2026-09-30'])
    const by = Object.fromEntries(c.series.map((s) => [s.key, s]))
    expect(c.series.map((s) => s.key)).toEqual(['google-impressions', 'bing-impressions', 'google-clicks', 'bing-clicks'])
    expect(by['google-clicks'].values).toEqual([6, 5])
    expect(by['bing-clicks'].values).toEqual([null, 1])
    expect(by['bing-impressions'].values).toEqual([null, 2])
    expect(by['google-clicks'].final).toEqual([true, false])
    expect([by['google-clicks'].tone, by['bing-clicks'].tone]).toEqual(['accent', 'ink'])
    expect(c.stillCounting).toBe(true)
  })

  // One engine: Clicks blue with its fill, Seen ink, the Analytics page's colours; an engine
  // without numbers adds no line.
  it('one engine: Clicks blue and filled, Seen ink; an engine with no numbers draws nothing', () => {
    const c = chartOf('google', { google: stats('google', [day('2026-09-29', 6, 23)]) })
    expect(c.series.map((s) => [s.key, s.tone, s.fill])).toEqual([
      ['google-impressions', 'ink', false],
      ['google-clicks', 'accent', true],
    ])
    expect(c.stillCounting).toBe(false)
    expect(chartOf('both', { google: stats('google', [day('2026-09-29', 6, 23)]) }).series.every((s) => s.engine === 'google')).toBe(true)
  })

  // "Since Sep 29" only when the numbers start after the period does.
  it('says "Since" only when the numbers start after the period', () => {
    expect(sinceWords({ from: '2026-09-29' }, P28)).toBe('Since Sep 29')
    expect(sinceWords({ from: '2026-09-05' }, P28)).toBeNull()
    expect(sinceWords(null, P28)).toBeNull()
  })
})

describe('the lists side by side', () => {
  // Each engine's own row, never merged; the same search from both sits together, Google first;
  // the pairs go busiest first by either engine's row.
  it('CRITICAL: each engine’s own row, pairs together, busiest first', () => {
    const rows = sideBySideRows({
      google: [row('skeen dj', 9, 35), row('skeen music', 2, 4)],
      bing: [row('skeen music', 5, 9), row('dj skeen', 1, 3)],
    })
    expect(rows.map((r) => `${r.engine}:${r.key}:${r.clicks}`)).toEqual(['google:skeen dj:9', 'google:skeen music:2', 'bing:skeen music:5', 'bing:dj skeen:1'])
    expect(sideBySideRows({ google: null, bing: [row('a', 1, 1)] }).map((r) => r.engine)).toEqual(['bing'])
  })

  // The bar: seen and clicks on the list's own scale; anything above zero shows a sliver.
  it('the bar is on the list’s scale, with a sliver for anything above zero', () => {
    expect(barOf({ clicks: 9, impressions: 35 }, 35)).toEqual({ seen: 100, clicks: (9 / 35) * 100 })
    expect(barOf({ clicks: 0, impressions: 1 }, 200)).toEqual({ seen: 2, clicks: 0 })
  })
})

describe('an engine with no numbers', () => {
  const noData = (engine: 'google' | 'bing', period = P28) => ({ engine, state: 'no_data' as const, period })

  // Bing for a site added Sep 30 (Skeen, 2026-10-02): new, so "usually within 2 weeks"; no date
  // is promised. Day 13 still is; day 14 is not.
  it('CRITICAL: a new site says "usually"; past the usual wait, or no date, it says none in the period', () => {
    expect(engineNote(noData('bing'), '2026-09-30T18:20:00.000Z')).toEqual({ kind: 'none', title: 'No numbers yet', bits: ['New site', 'added Sep 30', 'usually within 2 weeks'], retry: false })
    expect(engineNote(noData('bing'), '2026-09-19T20:00:00.000Z')?.title).toBe('No numbers yet')
    expect(engineNote(noData('bing'), '2026-09-18T20:00:00.000Z')).toEqual({ kind: 'none', title: 'No numbers', bits: ['None in these 28 days'], retry: false })
    expect(engineNote(noData('bing', P3M), null)?.bits).toEqual(['None in these 3 months'])
    expect(engineNote(noData('google'), '2026-09-29T20:00:00.000Z')?.bits).toEqual(['New site', 'added Sep 29', 'usually within a few days'])
    expect(engineNote(noData('bing'), 'not a date')?.title).toBe('No numbers')
  })

  // The day it was added is Search Console's (Pacific) day: 03:00 UTC on Oct 1 is still Sep 30.
  it('the added day is the Pacific day', () => {
    expect(engineNote(noData('bing'), '2026-10-01T03:00:00.000Z')?.bits[1]).toBe('added Sep 30')
  })

  // Every couldn't-ask state (derived from the list, not hand-listed) says which engine and why;
  // only a passing failure (error, timeout) offers Try again.
  it('CRITICAL: every couldn’t-ask state has words; only an error or a timeout offers Try again', () => {
    for (const state of COULDNT_ASK) {
      for (const engine of ['google', 'bing'] as const) {
        const n = engineNote(couldntAsk(engine, P28, state), null)!
        expect(n.kind, state).toBe('cant')
        expect(n.title).toBe(`Couldn't ask ${engine === 'google' ? 'Google' : 'Bing'}`)
        expect(n.bits.length, state).toBeGreaterThan(0)
        expect(n.retry, state).toBe(state === 'error' || state === 'timeout')
      }
    }
    expect(engineNote(couldntAsk('bing', P28, 'quota'), null)?.bits).toEqual(["Bing's daily limit", 'try tomorrow'])
    expect(engineNote({ engine: 'google', state: 'ok', stats: stats('google', []) }, null)).toBeNull()
  })
})

describe('page rows and the switches', () => {
  // A page links only to http(s) with no credentials, checked again where it is drawn.
  it('CRITICAL: a page row links only to http(s) without credentials', () => {
    expect(pageWords('https://www.skeenmusic.com/')).toEqual({ name: 'Home', sub: 'skeenmusic.com/', href: 'https://www.skeenmusic.com/' })
    expect(pageWords('https://www.skeenmusic.com/music/')).toEqual({ name: '/music', sub: 'skeenmusic.com/music/', href: 'https://www.skeenmusic.com/music/' })
    expect(pageWords('https://skeenmusic.com/caf%C3%A9').name).toBe('/café')
    expect(pageWords('javascript:alert(1)').href).toBeNull()
    expect(pageWords('https://a:b@skeenmusic.com/').href).toBeNull()
    expect(pageWords('not a url')).toEqual({ name: 'not a url', sub: '', href: null })
  })

  // The engine in the address: the three views, anything else (junk, a prototype key) is Both.
  it('reads ?e= as one of the three views, anything else as Both', () => {
    for (const v of ENGINE_VIEWS) expect(engineViewOf(v)).toBe(v)
    for (const junk of [null, undefined, '', 'yahoo', '__proto__', 'constructor']) expect(engineViewOf(junk)).toBe('both')
  })
})

describe('country names', () => {
  // The generated table is exactly i18n-iso-countries' alpha-3 → alpha-2 (a stale or hand-edited
  // copy fails here), and Google's codes read as the Analytics page names them.
  it('CRITICAL: the alpha-3 table matches i18n-iso-countries', () => {
    const table = Object.fromEntries(A3_TO_A2_TABLE.split(' ').map((p) => [p.slice(0, 3), p.slice(3)]))
    const expected = Object.fromEntries(Object.keys(iso.getAlpha2Codes()).map((a2) => [iso.alpha2ToAlpha3(a2), a2]))
    expect(table).toEqual(expected)
    expect(countryFromA3('USA')).toBe('United States')
    expect(countryFromA3('nld')).toBe('Netherlands')
    expect(countryFromA3('ZZZ')).toBe('ZZZ')
  })
})
