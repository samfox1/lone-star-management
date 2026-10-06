/**
 * The Search tab's words: what the artist reads about their own search numbers, and how the two
 * engines sit side by side without being added together.
 *
 * Code:     src/lib/manager-tools/seo/search-model.ts
 * Feature:  SEO / GEO page · Search tab (Sam, 2026-10-02; rebuilt from mock r12 2026-10-06:
 *           "Both" side by side, Bing "usually" 2 weeks). The lines: search-board.test.ts,
 *           search-spot.test.ts.
 * Tier:     STRICT (AGENTS.md "Test depth"): these words decide what the artist is told about
 *           their audience (a rounding must never say something false).
 * Covers:   • the spot: one decimal, a whole number bare, "—" with none
 *           • side by side: one date axis from the first day either engine has to the last; an
 *             engine is null outside its own days (never a zero), a zero inside them
 *           • the lists side by side: each engine's own row, a search both list next to each
 *             other, busiest first
 *           • no numbers: a new site within the engine's usual wait (Bing 2 weeks) says "usually";
 *             older, or no date, says none in the period; every couldn't-ask state has words
 *           • the engine switch reads ?e=
 *           • the private-searches line under the seen / clicked chart: each side only above zero
 * Not here: the numbers' shape (search-stats.test.ts); the page's layout (tests/components/
 *           manager-tools/seo/search-tab.test.tsx).
 * Fixtures: small hand-made answers in search-stats.ts's own types.
 */
import { describe, expect, it } from 'vitest'
import {
  ENGINE_VIEWS,
  alignDays,
  engineNote,
  engineViewOf,
  privateWords,
  sideBySideRows,
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
  unlisted: { clicks: 0, impressions: 0 },
  coverage: series.length ? { from: series[0].date, to: series[series.length - 1].date } : null,
  preliminaryFrom: null,
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

describe('the switches', () => {
  // The engine in the address: the three views, anything else (junk, a prototype key) is Both.
  it('reads ?e= as one of the three views, anything else as Both', () => {
    for (const v of ENGINE_VIEWS) expect(engineViewOf(v)).toBe(v)
    for (const junk of [null, undefined, '', 'yahoo', '__proto__', 'constructor']) expect(engineViewOf(junk)).toBe('both')
  })
})

describe('the private-searches line', () => {
  // Under the seen / clicked chart the named searches never add up to the totals: Google keeps
  // rare searches private. The line says how much, so the parts add up (Sam: "be more transparent").
  it('CRITICAL: names the engine and both sides, each only when above zero; nothing private says nothing', () => {
    expect(privateWords('google', { clicks: 7, impressions: 54 })).toBe('Searches Google keeps private: 54 seen · 7 clicks')
    expect(privateWords('bing', { clicks: 1, impressions: 0 })).toBe('Searches Bing keeps private: 1 click')
    expect(privateWords('google', { clicks: 0, impressions: 1200 })).toBe('Searches Google keeps private: 1,200 seen')
    expect(privateWords('google', { clicks: 0, impressions: 0 })).toBeNull()
  })
})
