// @vitest-environment jsdom
// The timeline chart, and the ways it can lie.
/**
 *   TimelineChart draws up to five series. They must share ONE scale that starts
 *   at ZERO, or the comparison a reader makes by eye ("visitors are about a third
 *   of views") is one the chart invented. A series first counted mid-window starts
 *   there, not at a row of zeros; the hover line stops at the topmost line and the
 *   readout names the day and every value. Each line's drawn day points are on its
 *   group's `data-points` (the path between them is a smooth curve, lib/chart.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TimelineChart } from '@/components/ui/timeline-chart'

const points = [
  { day: '2026-09-10', views: 100, visitors: 25 },
  { day: '2026-09-11', views: 0, visitors: 0 },
  { day: '2026-09-12', views: 50, visitors: 50 },
]

/** The y a value is drawn at, read back off a series' day points. */
const ys = (pts: string) => pts.trim().split(/\s+/).map((p) => Number(p.split(',')[1]))

describe('TimelineChart', () => {
  const pointsOf = (c: HTMLElement, key: string) => c.querySelector(`[data-series="${key}"]`)!.getAttribute('data-points')!.trim().split(/\s+/)
  const ysOf = (c: HTMLElement, key: string) => ys(c.querySelector(`[data-series="${key}"]`)!.getAttribute('data-points')!)
  const S = (key: string, values: (number | null)[], color: 'accent' | 'accent-red' | 'ink' | 'chart-4' | 'chart-5' = 'accent', since?: string) =>
    ({ key, label: key[0].toUpperCase() + key.slice(1), values, color, since })

  it('CRITICAL: the scale starts at ZERO, not at the series minimum', () => {
    // Smallest value 20, deliberately: with a 0 in the series a min-normalised
    // scale and a zero-based one draw IDENTICALLY.
    const h = 100
    const { container } = render(<TimelineChart points={[
      { day: '2026-09-10', views: 100, visitors: 0 }, { day: '2026-09-11', views: 20, visitors: 0 },
    ]} height={h} />)
    const y = ysOf(container, 'views')
    expect(y[1]).toBeCloseTo(8 + (1 - 20 / 100) * (h - 8), 5)
    expect(y[1]).not.toBeCloseTo(h, 1)
  })

  const four = [
    { day: '2026-09-10', views: 100, visitors: 25 }, { day: '2026-09-11', views: 0, visitors: 0 },
    { day: '2026-09-12', views: 50, visitors: 50 }, { day: '2026-09-13', views: 10, visitors: 5 },
  ]

  it('CRITICAL: every series shares ONE scale — the same value lands at the same height', () => {
    const { container } = render(<TimelineChart points={four} height={100} series={[
      S('views', four.map((p) => p.views)), S('visitors', four.map((p) => p.visitors), 'accent-red'),
    ]} />)
    expect(ysOf(container, 'visitors')[2]).toBeCloseTo(ysOf(container, 'views')[2], 5)
    expect(ysOf(container, 'views')[0]).toBeLessThan(ysOf(container, 'views')[2])
  })

  it('a zero day sits on the floor, and a day of nothing at all still draws', () => {
    const { container } = render(<TimelineChart points={points} height={100} />)
    expect(ysOf(container, 'views')[1]).toBe(100)
    const flat = render(<TimelineChart points={[
      { day: '2026-09-11', views: 0, visitors: 0 }, { day: '2026-09-12', views: 0, visitors: 0 },
    ]} height={80} />)
    expect(ysOf(flat.container, 'views')).toEqual([80, 80])
  })

  it('draws only the first series with a fill; the rest are lines, and the legend names them all', () => {
    const { container } = render(<TimelineChart points={four} height={80} series={[
      S('views', [1, 2, 3, 4]), S('visitors', [1, 1, 1, 1], 'accent-red'), S('bots', [0, 1, 0, 1], 'ink'),
    ]} />)
    expect(container.querySelectorAll('[data-area]')).toHaveLength(1)
    expect(container.querySelector('[data-series="views"] [data-area]')).not.toBeNull()
    expect(container.querySelectorAll('[data-line]')).toHaveLength(3)
    const legend = screen.getByRole('list', { name: 'Series' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Views', 'Visitors', 'Bots'])
  })

  it('draws views alone by default, with no overlay', () => {
    const { container } = render(<TimelineChart points={points} height={80} />)
    expect(container.querySelectorAll('[data-line]')).toHaveLength(1)
    expect(screen.queryByText('Visitors')).toBeNull()
  })

  describe('a series first counted mid-window', () => {
    const across = [
      { day: '2026-09-10', views: 40, visitors: 0 }, { day: '2026-09-11', views: 50, visitors: 0 },
      { day: '2026-09-12', views: 60, visitors: 20 }, { day: '2026-09-13', views: 70, visitors: 30 },
    ]
    const two = [S('views', across.map((p) => p.views)), S('visitors', across.map((p) => p.visitors), 'accent-red', '2026-09-12')]

    it('CRITICAL: starts where the counting started — an uncounted day is not a zero', () => {
      const { container } = render(<TimelineChart points={across} height={100} series={two} />)
      expect(pointsOf(container, 'visitors')).toHaveLength(2)
      expect(pointsOf(container, 'views')).toHaveLength(4)
      // The legend names the series only — no "from Sep 12" note (Sam, 2026-09-13).
      expect(screen.queryByText(/from sep/i)).toBeNull()
      expect(container.querySelector('rect')).toBeNull() // no shaded span
    })

    it('CRITICAL: an overlay with fewer than four counted points is a line WITH a dot on each measured day', () => {
      const { container } = render(<TimelineChart points={across} height={100} series={two} />)
      const vis = container.querySelector('[data-series="visitors"]')!
      expect(vis.getAttribute('data-mark')).toBe('line+dots')
      expect(vis.querySelectorAll('circle')).toHaveLength(2)
      expect(pointsOf(container, 'visitors')).toHaveLength(2)
    })

    it('the lead series never gets dots, however short', () => {
      // The lead counted from the cut-over too: two points, and still no dots.
      const { container } = render(<TimelineChart points={across} height={100} series={[
        S('views', across.map((p) => p.views), 'accent', '2026-09-12'),
      ]} />)
      expect(pointsOf(container, 'views')).toHaveLength(2)
      expect(container.querySelectorAll('[data-series="views"] circle')).toHaveLength(0)
      expect(container.querySelector('[data-series="views"]')!.getAttribute('data-mark')).toBe('line')
    })

    it('drops the dots once four days have been counted', () => {
      const six = Array.from({ length: 6 }, (_, i) => ({ day: `2026-09-1${i}`, views: 10, visitors: i >= 2 ? 5 + i : 0 }))
      const { container } = render(<TimelineChart points={six} height={100} series={[
        S('views', six.map((p) => p.views)), S('visitors', six.map((p) => p.visitors), 'accent-red', '2026-09-12'),
      ]} />)
      expect(container.querySelector('[data-series="visitors"]')!.getAttribute('data-mark')).toBe('line')
      expect(container.querySelectorAll('[data-series="visitors"] circle')).toHaveLength(0)
    })

  })

  it('CRITICAL: every value is readable without hovering — the table is the twin, not a fallback', () => {
    render(<TimelineChart points={points} height={80} />)
    const table = screen.getByRole('table', { name: /views per day/i })
    for (const p of points) {
      const row = within(table).getByRole('row', { name: new RegExp(p.day) })
      expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual([p.day, String(p.views)])
    }
  })

  it('marks every day on the x axis with a small tick, weekly once the window is long', () => {
    const day = (i: number) => ({ day: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, views: 1, visitors: 0 })
    const thirty = render(<TimelineChart points={Array.from({ length: 30 }, (_, i) => day(i))} height={80} />)
    expect(thirty.container.querySelectorAll('[data-day-ticks] line')).toHaveLength(30)
    // Below the baseline, in their own strip — never inside the plot under the fill.
    expect(thirty.container.querySelector('svg:has([data-series]) [data-day-ticks]')).toBeNull()
    expect(thirty.container.querySelector('svg:has([data-day-ticks])')).not.toBeNull()
    const year = render(<TimelineChart points={Array.from({ length: 365 }, (_, i) => day(i % 336))} height={80} />)
    expect(year.container.querySelectorAll('[data-day-ticks] line')).toHaveLength(Math.ceil(365 / 7))
  })

  it('labels the window ends only, reads the day off the string, and never names the best day itself', () => {
    render(<TimelineChart points={points} height={80} />)
    expect(screen.getByText('Sep 10')).toBeTruthy()
    expect(screen.getByText('Sep 12')).toBeTruthy()
    expect(screen.queryByText('Sep 11')).toBeNull()
    expect(screen.queryByText(/best day/i)).toBeNull()
  })

  describe('the hover crosshair', () => {
    // jsdom lays nothing out, so the plot is given a width for the pointer maths.
    const orig = HTMLElement.prototype.getBoundingClientRect
    beforeEach(() => {
      HTMLElement.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect
      }
    })
    afterEach(() => { HTMLElement.prototype.getBoundingClientRect = orig })
    const three = [
      { day: '2026-09-10', views: 100, visitors: 25 }, { day: '2026-09-11', views: 60, visitors: 40 }, { day: '2026-09-12', views: 0, visitors: 0 },
    ]
    const plot = (c: HTMLElement) => c.querySelector('svg')!.parentElement!

    it('CRITICAL: hovering a day names the date and every drawn value — and nothing more (Sam: the old readout was too big)', () => {
      const { container } = render(<TimelineChart points={three} height={100} series={[
        S('views', [100, 60, 20]), S('visitors', [25, 40, 0], 'accent-red'),
      ]} />)
      fireEvent.pointerMove(plot(container), { clientX: 300 })
      const text = screen.getByRole('status').textContent!
      expect(text).toContain('Sep 11')
      expect(text).toMatch(/views\s*60/i)
      expect(text).toMatch(/visitors\s*40/i)
      expect(text).not.toMatch(/average|%/i)
      fireEvent.pointerMove(plot(container), { clientX: 0 })
      expect(screen.getByRole('status').textContent).toMatch(/views\s*100/i)
    })

    it('CRITICAL: the hover line rises from the floor and STOPS at the topmost line that day (Sam: "the vertical line should stop at the slope")', () => {
      const { container } = render(<TimelineChart points={three} height={100} series={[
        S('views', [100, 60, 20]), S('visitors', [25, 40, 0], 'accent-red'),
      ]} />)
      fireEvent.pointerMove(plot(container), { clientX: 300 })
      const line = container.querySelector('[data-crosshair] line')!
      // Day 2: views 60 is the top line there; the scale tops at 100, the plot starts at 8.
      expect(Number(line.getAttribute('y1'))).toBeCloseTo(8 + (1 - 60 / 100) * 92, 5)
      expect(Number(line.getAttribute('y2'))).toBe(100)
      // A ring on each line at that day.
      expect(container.querySelectorAll('[data-crosshair] circle')).toHaveLength(2)
    })

    it('CRITICAL: the readout sits just above the topmost value — a low day puts it low, not flush with the top rule', () => {
      const { container } = render(<TimelineChart points={[
        { day: '2026-09-10', views: 100, visitors: 0 }, { day: '2026-09-11', views: 5, visitors: 0 },
      ]} height={100} />)
      const plot = container.querySelector('svg')!.parentElement!
      fireEvent.pointerMove(plot, { clientX: 0 })
      const high = parseFloat((container.querySelector('[data-readout]') as HTMLElement).style.top)
      fireEvent.pointerMove(plot, { clientX: 600 })
      const low = parseFloat((container.querySelector('[data-readout]') as HTMLElement).style.top)
      expect(high).toBeCloseTo(8 - 12, 5)
      expect(low).toBeCloseTo(8 + (1 - 5 / 100) * 92 - 12, 5)
    })

    it('the readout is centred over the day, and pulled inward at either end of the window so it stays over the plot', () => {
      const five = Array.from({ length: 5 }, (_, i) => ({ day: `2026-09-1${i}`, views: 10, visitors: 0 }))
      const { container } = render(<TimelineChart points={five} height={100} />)
      const plot = container.querySelector('svg')!.parentElement!
      const shiftAt = (clientX: number) => { fireEvent.pointerMove(plot, { clientX }); return (container.querySelector('[data-readout]') as HTMLElement).style.transform }
      const early = shiftAt(0), mid = shiftAt(300), late = shiftAt(600)
      expect(mid).toContain('-50%')
      expect(early).not.toContain('-50%')
      expect(late).not.toContain('-50%')
      expect(early).not.toBe(late)
    })

    // Lines with a group read together under its name, each by its short word: on Metrics the
    // black and grey shades alone can't tell Google's seen from Bing's (Sam, 2026-10-06).
    it('grouped lines read by name: one row per group, each value with its word', () => {
      const { container } = render(<TimelineChart points={three} height={100} series={[
        { ...S('google-seen', [10, 23, 5]), group: 'Google', short: 'Seen' }, { ...S('bing-seen', [1, 2, 0], 'ink'), group: 'Bing', short: 'Seen' },
        { ...S('google-clicks', [1, 6, 0], 'ink'), group: 'Google', short: 'Clicks' }, { ...S('bing-clicks', [0, 0, 0], 'ink'), group: 'Bing', short: 'Clicks' },
      ]} />)
      fireEvent.pointerMove(plot(container), { clientX: 300 })
      expect([...container.querySelectorAll('[data-readout-group]')].map((g) => g.textContent)).toEqual(['GoogleSeen23Clicks6', 'BingSeen2Clicks0'])
    })

    it('an uncounted day reads as a dash, and leaving clears everything', () => {
      const across = [{ day: '2026-09-10', views: 4, visitors: 0 }, { day: '2026-09-11', views: 5, visitors: 9 }]
      const { container } = render(<TimelineChart points={across} height={100} series={[
        S('views', [4, 5]), S('visitors', [0, 9], 'accent-red', '2026-09-11'),
      ]} />)
      fireEvent.pointerMove(plot(container), { clientX: 0 })
      expect(screen.getByRole('status').textContent).toMatch(/visitors\s*—/i)
      fireEvent.pointerLeave(plot(container))
      expect(screen.queryByRole('status')).toBeNull()
    })
  })

  describe('today, still being counted', () => {
    const four = [
      { day: '2026-09-10', views: 10, visitors: 0 }, { day: '2026-09-11', views: 20, visitors: 0 },
      { day: '2026-09-12', views: 30, visitors: 0 }, { day: '2026-09-13', views: 5, visitors: 0 },
    ]
    it('CRITICAL: the last gap is drawn dotted, apart from the solid line, which stops a day short', () => {
      const { container } = render(<TimelineChart points={four} height={100} partialFrom={3} />)
      const solid = container.querySelector('[data-series="views"] [data-line]')!.getAttribute('d')!
      const tail = container.querySelector('[data-series="views"] [data-today]')!.getAttribute('d')!
      expect(solid.match(/C/g)).toHaveLength(2) // two of the three gaps
      expect(tail.match(/C/g)).toHaveLength(1)
      expect(tail.startsWith('M400.0,')).toBe(true) // from yesterday (x = 2/3 of 600)…
      expect(tail.endsWith('600.0,84.7')).toBe(true) // …to today: 5 on a scale topping at 30, 8 + (1 - 5/30) * 92
    })
    it('without it, every gap is solid and nothing is dotted', () => {
      const { container } = render(<TimelineChart points={four} height={100} />)
      expect(container.querySelector('[data-today]')).toBeNull()
      expect(container.querySelector('[data-series="views"] [data-line]')!.getAttribute('d')!.match(/C/g)).toHaveLength(3)
    })
  })

  describe('pins', () => {
    const four = [
      { day: '2026-09-10', views: 10, visitors: 0 }, { day: '2026-09-11', views: 40, visitors: 0 },
      { day: '2026-09-12', views: 20, visitors: 5 }, { day: '2026-09-13', views: 5, visitors: 4 },
    ]
    const pins = [
      { day: '2026-09-11', series: 'views', icon: <svg />, title: 'Busiest day: 40 views' },
      { day: '2026-09-12', series: 'visitors', icon: <svg />, title: 'Visitors counted from here', note: 'and bots filtered' },
    ]
    it('CRITICAL: a pin shows only while its line is drawn, and its card names it with its day on focus', () => {
      const views = render(<TimelineChart points={four} height={100} pins={pins} />)
      expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Busiest day: 40 views'])
      views.unmount()
      render(<TimelineChart points={four} height={100} pins={pins} series={[
        S('views', four.map((p) => p.views)), S('visitors', four.map((p) => p.visitors), 'accent-red', '2026-09-12'),
      ]} />)
      const marks = screen.getAllByRole('button')
      expect(marks.map((b) => b.getAttribute('aria-label'))).toEqual(['Busiest day: 40 views', 'Visitors counted from here'])
      fireEvent.focus(marks[1])
      expect(screen.getByRole('tooltip').textContent).toMatch(/visitors counted from here\s*sep 12 · and bots filtered/i)
      fireEvent.blur(marks[1])
      expect(screen.queryByRole('tooltip')).toBeNull()
    })
  })

  describe('for Search', () => {
    const days = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((day) => ({ day, views: 0, visitors: 0 }))
    it('CRITICAL: a spot axis puts #1 at the TOP — a better (smaller) spot is drawn higher — down to a floor of at least #3', () => {
      const { container } = render(<TimelineChart points={days} height={100} scale="rank" series={[S('spot', [2.6, 2.0, 1.4, 1.0], 'ink')]} />)
      const y = ysOf(container, 'spot')
      expect(y[3]).toBeCloseTo(8, 5) // #1: the top of the plot
      expect(y[0]).toBeCloseTo(8 + ((2.6 - 1) / (3 - 1)) * 92, 5) // floor #3 at the bottom
      expect(y[2]).toBeLessThan(y[1])
      expect(screen.getByText('#1')).toBeTruthy()
      expect(screen.getByText('#3')).toBeTruthy()
    })
    it('a day a line has nothing (null) is no point on it — not a zero', () => {
      const { container } = render(<TimelineChart points={days} height={100} series={[S('seen', [4, null, 6, 8])]} />)
      expect(pointsOf(container, 'seen')).toHaveLength(3)
    })
    it('every gap into a day still being counted is dotted, however many such days there are', () => {
      const { container } = render(<TimelineChart points={days} height={100} partialFrom={2} series={[S('seen', [4, 5, 6, 8])]} />)
      expect(container.querySelector('[data-series="seen"] [data-line]')!.getAttribute('d')!.match(/C/g)).toHaveLength(1)
      expect(container.querySelector('[data-series="seen"] [data-today]')!.getAttribute('d')!.match(/C/g)).toHaveLength(2)
    })
    it('the end mark rides the first line\'s last point', () => {
      const { container } = render(<TimelineChart points={days} height={100} scale="rank" endMark={<span>S</span>} series={[S('spot', [2.6, 2.0, 1.4, 1.0], 'ink')]} />)
      const mark = container.querySelector('[data-end-mark]') as HTMLElement
      expect(mark.textContent).toBe('S')
      expect(mark.style.left).toBe('100%')
      expect(parseFloat(mark.style.top)).toBeCloseTo(8, 5)
    })
  })
})
