// @vitest-environment jsdom
// The two marks the Analytics tab is made of, and the ways each one can lie.
/**
 * The dashboard is monochrome, so neither of these can lean on colour to carry
 * meaning — which removes the usual way charts go wrong and leaves two others:
 *
 *   TimelineChart draws two series. They must share ONE scale that starts at ZERO,
 *   or the comparison a reader makes by eye ("visitors are about a third of views")
 *   is one the chart invented. The older Sparkline normalises to the series minimum,
 *   which is right for a shape and wrong for a comparison — these tests pin the
 *   difference, because the two components sit in the same folder.
 *
 *   BarList draws its label ON the row rather than inside the bar. A label inside a
 *   short bar is the commonest way these lists break, and it breaks worst for the
 *   smallest row, which is the one a person is squinting at.
 */
import { describe, expect, it } from 'vitest'
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
  const line = (c: HTMLElement) => c.querySelector('polyline[data-series="primary"]')!
  const lineYs = (c: HTMLElement) => ys(line(c).getAttribute('points')!)

  it('CRITICAL: the scale starts at ZERO, not at the series minimum', () => {
    // The fixture's smallest value is 20, deliberately. With a 0 in the series a
    // min-normalised scale and a zero-based one draw IDENTICALLY, and the test
    // would pass against the very bug it names.
    const h = 100
    const { container } = render(<TimelineChart points={[
      { day: '2026-09-10', views: 100, visitors: 0 }, { day: '2026-09-11', views: 20, visitors: 0 },
    ]} height={h} />)
    const y = lineYs(container)
    expect(y[1]).toBeCloseTo(8 + (1 - 20 / 100) * (h - 8), 5)
    expect(y[1]).not.toBeCloseTo(h, 1)
  })

  it('a zero day sits on the floor, and a day of nothing at all still draws', () => {
    const { container } = render(<TimelineChart points={points} height={100} />)
    expect(lineYs(container)[1]).toBe(100)
    const flat = render(<TimelineChart points={[
      { day: '2026-09-11', views: 0, visitors: 0 }, { day: '2026-09-12', views: 0, visitors: 0 },
    ]} height={80} />)
    expect(lineYs(flat.container)).toEqual([80, 80])
  })

  it('CRITICAL: charts a supplied series instead of views when asked, on the same zero-based scale', () => {
    const { container } = render(<TimelineChart points={points} primary={{ label: 'Plays', values: [20, 100, 0] }} height={100} />)
    const y = lineYs(container)
    expect(y[1]).toBeCloseTo(8, 5)
    expect(y[2]).toBe(100)
    expect(within(screen.getByRole('list', { name: 'Series' })).getByText('Plays')).toBeTruthy()
  })

  it('draws exactly one series — the visitors overlay that streaked up the right edge is gone', () => {
    const { container } = render(<TimelineChart points={points} height={80} />)
    expect(container.querySelectorAll('polyline')).toHaveLength(1)
    expect(container.querySelector('[data-series="visitors"]')).toBeNull()
    expect(screen.queryByText('Visitors')).toBeNull()
  })

  describe('a series that was first counted mid-window', () => {
    const across = [
      { day: '2026-09-10', views: 40, visitors: 0 }, { day: '2026-09-11', views: 50, visitors: 0 },
      { day: '2026-09-12', views: 60, visitors: 20 }, { day: '2026-09-13', views: 70, visitors: 30 },
    ]
    const vis = { label: 'Visitors', values: across.map((p) => p.visitors) }

    it('CRITICAL: starts the line where the counting started — an uncounted day is not a zero', () => {
      const { container } = render(<TimelineChart points={across} primary={vis} since="2026-09-12" height={100} />)
      expect(line(container).getAttribute('points')!.trim().split(/\s+/)).toHaveLength(2)
      expect(screen.getByText(/counted from sep 12/i)).toBeTruthy()
      // No shaded span: the grey hue was the complaint.
      expect(container.querySelector('rect')).toBeNull()
    })

    it('scales to the counted days only, so two real points fill the box', () => {
      const { container } = render(<TimelineChart points={across} primary={vis} since="2026-09-12" height={100} />)
      expect(Math.min(...lineYs(container))).toBeCloseTo(8, 5) // the 30 reaches the top
    })

    it('says nothing about "counted from" when the whole window was counted', () => {
      render(<TimelineChart points={across.slice(2)} primary={vis} since="2026-09-12" height={100} />)
      expect(screen.queryByText(/counted from/i)).toBeNull()
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

  it('labels the window ends only, and reads the day off the string so it never slips west of Greenwich', () => {
    render(<TimelineChart points={points} height={80} />)
    expect(screen.getByText('Sep 10')).toBeTruthy()
    expect(screen.getByText('Sep 12')).toBeTruthy()
    expect(screen.queryByText('Sep 11')).toBeNull()
  })

  it('marks every day on the x axis with a small tick, weekly once the window is long', () => {
    const day = (i: number) => ({ day: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, views: 1, visitors: 0 })
    const thirty = render(<TimelineChart points={Array.from({ length: 30 }, (_, i) => day(i))} height={80} />)
    expect(thirty.container.querySelectorAll('[data-day-ticks] line')).toHaveLength(30)
    const year = render(<TimelineChart points={Array.from({ length: 365 }, (_, i) => day(i % 336))} height={80} />)
    expect(year.container.querySelectorAll('[data-day-ticks] line')).toHaveLength(Math.ceil(365 / 7))
  })

  it('does not name the best day itself — that is the panel beside it', () => {
    render(<TimelineChart points={points} height={80} />)
    expect(screen.queryByText(/best day/i)).toBeNull()
  })

  describe('the hover crosshair', () => {
    const withWidth = () => {
      const orig = HTMLElement.prototype.getBoundingClientRect
      HTMLElement.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect
      }
      return () => { HTMLElement.prototype.getBoundingClientRect = orig }
    }
    const three = [
      { day: '2026-09-10', views: 100, visitors: 25 }, { day: '2026-09-11', views: 60, visitors: 40 }, { day: '2026-09-12', views: 0, visitors: 0 },
    ]
    const plot = (c: HTMLElement) => c.querySelector('svg')!.parentElement!

    it('CRITICAL: hovering a day says its value and the change on the day before', () => {
      const restore = withWidth()
      const { container } = render(<TimelineChart points={three} height={100} />)
      fireEvent.pointerMove(plot(container), { clientX: 300 })
      const text = screen.getByRole('status').textContent!
      expect(text).toContain('Sep 11')
      expect(text).toContain('60')
      expect(text).toContain('-40.0%')
      expect(container.querySelector('[data-crosshair] line')).not.toBeNull()
      restore()
    })

    it('CRITICAL: refuses a percentage when yesterday was zero, and says so', () => {
      const restore = withWidth()
      const { container } = render(<TimelineChart points={[
        { day: '2026-09-10', views: 0, visitors: 0 }, { day: '2026-09-11', views: 30, visitors: 10 },
      ]} height={100} />)
      fireEvent.pointerMove(plot(container), { clientX: 600 })
      const text = screen.getByRole('status').textContent!
      expect(text).toMatch(/none on sep 10/i)
      expect(text).not.toMatch(/%/)
      restore()
    })

    it('the first counted day has nothing to compare against, and leaving clears everything', () => {
      const restore = withWidth()
      const { container } = render(<TimelineChart points={three} height={100} />)
      fireEvent.pointerMove(plot(container), { clientX: 0 })
      expect(screen.getByRole('status').textContent).toMatch(/first day counted/i)
      fireEvent.pointerLeave(plot(container))
      expect(screen.queryByRole('status')).toBeNull()
      expect(container.querySelector('[data-crosshair]')).toBeNull()
      restore()
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
