// @vitest-environment jsdom
// The two marks the Analytics tab is made of, and the ways each one can lie.
/**
 *   TimelineChart draws up to three series. They must share ONE scale that starts
 *   at ZERO, or the comparison a reader makes by eye ("visitors are about a third
 *   of views") is one the chart invented. A series first counted mid-window starts
 *   there, not at a row of zeros; the hover readout says what a day is and how far
 *   it sits from the average.
 *
 *   BarList draws its label ON the row rather than inside the bar. A label inside a
 *   short bar is the commonest way these lists break, and it breaks worst for the
 *   smallest row, which is the one a person is squinting at.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TimelineChart } from '@/components/ui/timeline-chart'
import { BarList } from '@/components/ui/bar-list'

const points = [
  { day: '2026-09-10', views: 100, visitors: 25 },
  { day: '2026-09-11', views: 0, visitors: 0 },
  { day: '2026-09-12', views: 50, visitors: 50 },
]

/** The y a value is drawn at, read back off a polyline's points. */
const ys = (pts: string) => pts.trim().split(/\s+/).map((p) => Number(p.split(',')[1]))

describe('TimelineChart', () => {
  const lineOf = (c: HTMLElement, key: string) => c.querySelector(`[data-series="${key}"] polyline`)!
  const ysOf = (c: HTMLElement, key: string) => ys(lineOf(c, key).getAttribute('points')!)
  const S = (key: string, values: number[], color: 'accent' | 'accent-red' | 'ink' = 'accent', since?: string) =>
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
    expect(container.querySelectorAll('polygon')).toHaveLength(1)
    expect(container.querySelector('[data-series="views"] polygon')).not.toBeNull()
    expect(container.querySelectorAll('polyline')).toHaveLength(3)
    const legend = screen.getByRole('list', { name: 'Series' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Views', 'Visitors', 'Bots'])
  })

  it('each series is drawn in its own colour — the blue accent, the red accent, ink', () => {
    const { container } = render(<TimelineChart points={four} height={80} series={[
      S('views', [1, 2, 3, 4]), S('visitors', [1, 1, 1, 1], 'accent-red'), S('bots', [0, 1, 0, 1], 'ink'),
    ]} />)
    const cls = (k: string) => container.querySelector(`[data-series="${k}"]`)!.getAttribute('class') ?? ''
    expect(cls('views').split(' ')).toContain('text-accent')
    expect(cls('visitors').split(' ')).toContain('text-accent-red')
    expect(cls('bots').split(' ')).toContain('text-ink')
  })

  it('draws views alone by default, with no overlay', () => {
    const { container } = render(<TimelineChart points={points} height={80} />)
    expect(container.querySelectorAll('polyline')).toHaveLength(1)
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
      expect(lineOf(container, 'visitors').getAttribute('points')!.trim().split(/\s+/)).toHaveLength(2)
      expect(lineOf(container, 'views').getAttribute('points')!.trim().split(/\s+/)).toHaveLength(4)
      // The legend names the series only — no "from Sep 12" note (Sam, 2026-09-13).
      expect(screen.queryByText(/from sep/i)).toBeNull()
      expect(container.querySelector('rect')).toBeNull() // no shaded span
    })

    it('CRITICAL: an overlay with fewer than four counted points is a line WITH a dot on each measured day', () => {
      const { container } = render(<TimelineChart points={across} height={100} series={two} />)
      const vis = container.querySelector('[data-series="visitors"]')!
      expect(vis.getAttribute('data-mark')).toBe('line+dots')
      expect(vis.querySelectorAll('ellipse')).toHaveLength(2)
      expect(vis.querySelector('polyline')!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(2)
    })

    it('the lead series never gets dots, however short', () => {
      // The lead counted from the cut-over too: two points, and still no dots.
      const { container } = render(<TimelineChart points={across} height={100} series={[
        S('views', across.map((p) => p.views), 'accent', '2026-09-12'),
      ]} />)
      expect(container.querySelector('[data-series="views"] polyline')!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(2)
      expect(container.querySelectorAll('[data-series="views"] ellipse')).toHaveLength(0)
      expect(container.querySelector('[data-series="views"]')!.getAttribute('data-mark')).toBe('line')
    })

    it('drops the dots once four days have been counted', () => {
      const six = Array.from({ length: 6 }, (_, i) => ({ day: `2026-09-1${i}`, views: 10, visitors: i >= 2 ? 5 + i : 0 }))
      const { container } = render(<TimelineChart points={six} height={100} series={[
        S('views', six.map((p) => p.views)), S('visitors', six.map((p) => p.visitors), 'accent-red', '2026-09-12'),
      ]} />)
      expect(container.querySelector('[data-series="visitors"]')!.getAttribute('data-mark')).toBe('line')
      expect(container.querySelectorAll('[data-series="visitors"] polyline')).toHaveLength(1)
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

    it('CRITICAL: hovering a day names the date, lists every drawn series, and says how far the lead sits from the window average', () => {
      const { container } = render(<TimelineChart points={three} height={100} series={[
        S('views', [100, 60, 20]), S('visitors', [25, 40, 0], 'accent-red'),
      ]} />)
      fireEvent.pointerMove(plot(container), { clientX: 300 })
      const text = screen.getByRole('status').textContent!
      expect(text).toContain('Sep 11')
      expect(text).toMatch(/views60/i)
      expect(text).toMatch(/visitors40/i)
      // Average of 100, 60, 20 is 60: the middle day sits exactly on it.
      expect(text).toMatch(/0\.0% vs average/i)
      fireEvent.pointerMove(plot(container), { clientX: 0 })
      expect(screen.getByRole('status').textContent).toMatch(/\+66\.7% vs average/i)
    })

    it('CRITICAL: withholds the deviation when the window average is zero — nothing to deviate from', () => {
      const { container } = render(<TimelineChart points={[
        { day: '2026-09-10', views: 0, visitors: 0 }, { day: '2026-09-11', views: 0, visitors: 0 },
      ]} height={100} />)
      fireEvent.pointerMove(plot(container), { clientX: 600 })
      expect(screen.getByRole('status').textContent).not.toMatch(/%/)
    })

    it('CRITICAL: the readout follows the hovered value — a low day puts it low, not flush with the top rule', () => {
      const { container } = render(<TimelineChart points={[
        { day: '2026-09-10', views: 100, visitors: 0 }, { day: '2026-09-11', views: 5, visitors: 0 },
      ]} height={100} />)
      const plot = container.querySelector('svg')!.parentElement!
      fireEvent.pointerMove(plot, { clientX: 0 })
      const high = parseFloat((container.querySelector('[data-readout]') as HTMLElement).style.top)
      fireEvent.pointerMove(plot, { clientX: 600 })
      const low = parseFloat((container.querySelector('[data-readout]') as HTMLElement).style.top)
      expect(low).toBeGreaterThan(high)
      expect(high).toBeGreaterThanOrEqual(4)
      expect(low).toBeLessThanOrEqual(64)
    })

    it('the readout sits to the right of the dot, and flips to the left near the window end', () => {
      const { container } = render(<TimelineChart points={three} height={100} />)
      const plot = container.querySelector('svg')!.parentElement!
      fireEvent.pointerMove(plot, { clientX: 0 })
      const early = (container.querySelector('[data-readout]') as HTMLElement).style
      expect(early.left).not.toBe('')
      expect(early.right).toBe('')
      fireEvent.pointerMove(plot, { clientX: 600 })
      const late = (container.querySelector('[data-readout]') as HTMLElement).style
      expect(late.right).not.toBe('')
      expect(late.left).toBe('')
    })

    it('an uncounted day reads as a dash, and leaving clears everything', () => {
      const across = [{ day: '2026-09-10', views: 4, visitors: 0 }, { day: '2026-09-11', views: 5, visitors: 9 }]
      const { container } = render(<TimelineChart points={across} height={100} series={[
        S('views', [4, 5]), S('visitors', [0, 9], 'accent-red', '2026-09-11'),
      ]} />)
      fireEvent.pointerMove(plot(container), { clientX: 0 })
      expect(screen.getByRole('status').textContent).toMatch(/visitors—/i)
      fireEvent.pointerLeave(plot(container))
      expect(screen.queryByRole('status')).toBeNull()
    })
  })
})

describe('BarList', () => {
  const bars = [
    { key: 'instagram', label: 'Instagram', value: 80, sub: 'l.instagram.com' },
    { key: 'direct', label: 'Direct', value: 20 },
    { key: 'tiny', label: 'A very long source name indeed', value: 1 },
  ]

  it('CRITICAL: the smallest row is as readable as the largest — the label is never inside the bar', () => {
    const { container } = render(<BarList bars={bars} />)
    const rows = container.querySelectorAll('li')
    // Every label is in the row's own text, whatever its bar measures.
    expect(within(rows[2] as HTMLElement).getByText('A very long source name indeed')).toBeTruthy()
    // And the smallest bar still has a visible width rather than collapsing to nothing.
    const width = (rows[2].querySelector('span[aria-hidden]') as HTMLElement).style.width
    expect(parseFloat(width)).toBeGreaterThan(0)
  })

  it('scales the bars against the largest value, not the total', () => {
    const { container } = render(<BarList bars={bars} />)
    const widths = [...container.querySelectorAll('li span[aria-hidden]')].map(
      (el) => parseFloat((el as HTMLElement).style.width),
    )
    expect(widths[0]).toBe(100) // the largest fills the row
    expect(widths[1]).toBeCloseTo(25, 5) // 20 of 80
  })

  it('every bar carries the same weight — length says the size, shading would say it twice', () => {
    const { container } = render(<BarList bars={bars} />)
    const classes = [...container.querySelectorAll('li span[aria-hidden]')].map((el) => el.className)
    expect(new Set(classes).size).toBe(1)
  })

  it('prints the value beside the label, so the list is its own table', () => {
    render(<BarList bars={bars} />)
    expect(screen.getByText('80')).toBeTruthy()
    expect(screen.getByText('20')).toBeTruthy()
  })

  it('says what is missing rather than drawing an empty frame', () => {
    render(<BarList bars={[]} empty="Location needs an ipinfo key." />)
    expect(screen.getByText('Location needs an ipinfo key.')).toBeTruthy()
  })
})
