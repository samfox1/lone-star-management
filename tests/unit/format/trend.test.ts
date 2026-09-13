// The numbers beside every headline figure: the roster's sparklines, the analytics band,
//   and the dashboard's views tile all read their percentage out of these four functions.
/**
 * `src/lib/format.ts` had no tests at all until 2026-09-12, and a real defect was sitting
 * in it: `seriesTrend` split an odd-length series down the middle with `slice(0, h)` /
 * `slice(h)`, which puts the leftover day in the RECENT half. A 7-day series therefore
 * compared 3 days against 4, and a perfectly flat week reported +33.3% — up-arrow, blue,
 * right next to the headline.
 *
 * It stayed invisible because every caller passed a 30-day series until the analytics
 * window filter shipped a 7-day option. That is the shape worth pinning: the bug is not
 * in the arithmetic, it is in what happens when the INPUT LENGTH changes, so the odd
 * lengths are tested explicitly rather than incidentally.
 *
 * TWO SURVIVING MUTANTS ARE LEFT ON PURPOSE, both equivalent — no test can kill them
 * because the mutated code produces identical output:
 *   - `compactNumber`'s `n < 1000` fast path. Intl's compact notation already renders
 *     every integer below 1000 as itself, so the branch is an optimisation, not a rule.
 *   - `formatTrend`'s `t === null` guard. `null * 100` is 0, which formats as the same
 *     '0.0%' / flat the guard returns, so removing it changes nothing observable.
 * Said here so the next reader of the report doesn't spend the afternoon on them.
 */
import { describe, expect, it } from 'vitest'
import { compactNumber, formatTrend, seriesTrend, trendLineClass, trendTextClass, type Trend } from '@/lib/format'

describe('seriesTrend', () => {
  it('CRITICAL: a flat week is flat, not +33% (the halves must be equal length)', () => {
    // Delete the `-h` in `slice(-h)` and this returns 0.333…: the regression, exactly.
    expect(seriesTrend([10, 10, 10, 10, 10, 10, 10])).toBe(0)
  })

  it('reports a flat series as flat at every window length the UI offers', () => {
    // WINDOWS in src/lib/analytics.ts. Read as a list so a new window joins this test
    // by existing, rather than by someone remembering to add a case.
    for (const days of [7, 30, 90]) {
      expect(seriesTrend(Array(days).fill(4)), `${days}-day window`).toBe(0)
    }
  })

  it('ignores the middle day of an odd series — it belongs to neither half', () => {
    // The spike sits exactly in the middle: dropping it is what makes the week flat.
    expect(seriesTrend([10, 10, 10, 9999, 10, 10, 10])).toBe(0)
  })

  it('measures the real move: second half against first half', () => {
    expect(seriesTrend([10, 10, 20, 20])).toBe(1) // doubled
    expect(seriesTrend([20, 20, 10, 10])).toBe(-0.5) // halved
  })

  it('has no opinion without a baseline', () => {
    expect(seriesTrend([])).toBeNull()
    expect(seriesTrend([5])).toBeNull()
    expect(seriesTrend([0, 0])).toBeNull() // nothing then nothing is not a trend
    expect(seriesTrend([0, 7])).toBe(1) // nothing then something is all upside
  })
})

describe('formatTrend', () => {
  it('calls a hair either side of zero flat, so noise does not read as a move', () => {
    expect(formatTrend(0.0004).dir).toBe('flat')
    expect(formatTrend(-0.0004).dir).toBe('flat')
    expect(formatTrend(0.002).dir).toBe('up')
    expect(formatTrend(-0.002).dir).toBe('down')
  })

  it('signs the number and keeps one decimal', () => {
    expect(formatTrend(0.0421)).toEqual({ label: '+4.2%', dir: 'up' })
    expect(formatTrend(-0.0421)).toEqual({ label: '-4.2%', dir: 'down' })
  })

  it('no data reads as a neutral zero, never as a fall', () => {
    expect(formatTrend(null)).toEqual({ label: '0.0%', dir: 'flat' })
  })

  it('holds the exact edges of the flat band and of the plus sign', () => {
    // The three boundaries are asserted rather than approached, because > and >= read
    // the same to a person and differently to the page. Stryker survived all three
    // until these landed: 0.05 is the last flat value in each direction, and a dead-flat
    // 0 wears no sign.
    expect(formatTrend(0.0005).dir).toBe('flat') // pct === 0.05 exactly, still flat
    expect(formatTrend(-0.0005).dir).toBe('flat')
    expect(formatTrend(0.000501).dir).toBe('up') // a hair past it is a move
    expect(formatTrend(-0.000501).dir).toBe('down')
    expect(formatTrend(0).label).toBe('0.0%') // no '+' on nothing
  })
})

describe('compactNumber', () => {
  it('keeps exact counts below a thousand and compacts above', () => {
    expect(compactNumber(0)).toBe('0')
    expect(compactNumber(999)).toBe('999')
    expect(compactNumber(1000)).toBe('1K')
    expect(compactNumber(1240)).toBe('1.2K')
    expect(compactNumber(3_400_000)).toBe('3.4M')
  })
})

describe('the trend colours', () => {
  // Derived from the union, not hand-listed: a fourth direction stops compiling here
  // before it can reach a page and render as whatever the ternary falls through to.
  const DIRS: Record<Trend['dir'], true> = { up: true, down: true, flat: true }

  it('gives every direction a text colour, and only down is red', () => {
    const seen = Object.keys(DIRS).map((d) => trendTextClass(d as Trend['dir']))
    expect(new Set(seen).size).toBe(3) // three directions, three distinct colours
    expect(trendTextClass('up')).toBe('text-accent')
    expect(trendTextClass('down')).toBe('text-accent-red')
    expect(trendTextClass('flat')).toBe('text-ink-faint')
  })

  it('colours a sparkline red ONLY when it is clearly down', () => {
    // Flat shares the line colour with up on purpose: a quiet week is not bad news.
    expect(trendLineClass('down')).toBe('text-accent-red')
    expect(trendLineClass('up')).toBe('text-ink')
    expect(trendLineClass('flat')).toBe('text-ink')
  })
})
