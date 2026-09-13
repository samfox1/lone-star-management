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

function marks(container: HTMLElement) {
  const area = container.querySelector('polygon[data-series="views"]')!
  const line = container.querySelector('polyline[data-series="visitors"]')!
  return { area, line }
}
const visitorsLine = (c: HTMLElement) => c.querySelector('polyline[data-series="visitors"]')!

describe('TimelineChart', () => {
  it('CRITICAL: both series are drawn against ONE scale — the same value lands at the same height', () => {
    const { container } = render(<TimelineChart points={points} height={100} />)
    const { area, line } = marks(container)
    // The polygon carries the views path plus two closing corners.
    const viewY = ys(area.getAttribute('points')!).slice(0, points.length)
    const visitorY = ys(line.getAttribute('points')!)
    // Day 3: views 50 and visitors 50. One scale means one height.
    expect(visitorY[2]).toBeCloseTo(viewY[2], 5)
    // Day 1: views 100 is the max and sits higher than day 3's 50.
    expect(viewY[0]).toBeLessThan(viewY[2])
  })

  it('CRITICAL: the scale starts at ZERO, not at the series minimum', () => {
    // The fixture's smallest value is 20, deliberately. An earlier version of this
    // test used a series containing a 0 — which made a min-normalised scale and a
    // zero-based one draw IDENTICALLY, so it passed against the very bug it named.
    // Confirmed by breaking the component: the old assertion did not notice.
    const h = 100
    const PAD_TOP = 8
    const nonZero = [
      { day: '2026-09-10', views: 100, visitors: 20 },
      { day: '2026-09-11', views: 60, visitors: 40 },
    ]
    const { container } = render(<TimelineChart points={nonZero} height={h} />)
    const visitorY = ys(visitorsLine(container).getAttribute('points')!)
    // Against ZERO, with max 100: 20 sits a fifth of the way up the plot.
    expect(visitorY[0]).toBeCloseTo(PAD_TOP + (1 - 20 / 100) * (h - PAD_TOP), 5)
    expect(visitorY[1]).toBeCloseTo(PAD_TOP + (1 - 40 / 100) * (h - PAD_TOP), 5)
    // Against the series MINIMUM the smallest value would be pinned to the floor.
    expect(visitorY[0]).not.toBeCloseTo(h, 1)
  })

  it('a zero day sits on the floor', () => {
    const h = 100
    const { container } = render(<TimelineChart points={points} height={h} />)
    const visitorY = ys(visitorsLine(container).getAttribute('points')!)
    expect(visitorY[1]).toBe(h)
  })

  it('a day of nothing at all still draws, flat on the floor, rather than dividing by zero', () => {
    const flat = [
      { day: '2026-09-11', views: 0, visitors: 0 },
      { day: '2026-09-12', views: 0, visitors: 0 },
    ]
    const { container } = render(<TimelineChart points={flat} height={80} />)
    const visitorY = ys(visitorsLine(container).getAttribute('points')!)
    expect(visitorY).toEqual([80, 80])
    expect(visitorY.every((y) => Number.isFinite(y))).toBe(true)
  })

  it('names both series, because two marks are never identified by shape alone', () => {
    render(<TimelineChart points={points} height={80} />)
    // The legend, not the table header of the same name below it.
    const legend = screen.getByRole('list', { name: 'Series' })
    expect(within(legend).getByText('Views')).toBeTruthy()
    expect(within(legend).getByText('Visitors')).toBeTruthy()
  })

  it('CRITICAL: every value is readable without hovering — the table is the twin, not a fallback', () => {
    render(<TimelineChart points={points} height={80} />)
    const table = screen.getByRole('table', { name: /views and visitors per day/i })
    for (const p of points) {
      const row = within(table).getByRole('row', { name: new RegExp(p.day) })
      // By POSITION, not by text: on a quiet day views and visitors are both "0",
      // and a by-text lookup cannot tell which cell it found.
      const cells = within(row).getAllByRole('cell').map((c) => c.textContent)
      expect(cells, p.day).toEqual([p.day, String(p.views), String(p.visitors)])
    }
  })

  it('labels the window ends only — an axis, not a number on every point', () => {
    render(<TimelineChart points={points} height={80} />)
    expect(screen.getByText('Sep 10')).toBeTruthy()
    expect(screen.getByText('Sep 12')).toBeTruthy()
    // The middle day is in the table, never on the axis.
    expect(screen.queryByText('Sep 11')).toBeNull()
  })

  describe('the hover crosshair', () => {
    // jsdom lays nothing out, so the plot box reports zero width and the pointer
    // maths bails. Give it a width so a pointer x maps to a day.
    const withWidth = () => {
      const orig = HTMLElement.prototype.getBoundingClientRect
      HTMLElement.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect
      }
      return () => { HTMLElement.prototype.getBoundingClientRect = orig }
    }
    const three = [
      { day: '2026-09-10', views: 100, visitors: 25 },
      { day: '2026-09-11', views: 60, visitors: 40 },
      { day: '2026-09-12', views: 0, visitors: 0 },
    ]

    it('CRITICAL: hovering a day says its views, visitors, and the change on the day before', () => {
      const restore = withWidth()
      const { container } = render(<TimelineChart points={three} height={100} />)
      const plot = container.querySelector('svg')!.parentElement!
      fireEvent.pointerMove(plot, { clientX: 300 }) // the middle of three days
      const status = screen.getByRole('status')
      expect(status.textContent).toContain('Sep 11')
      expect(status.textContent).toContain('60')
      expect(status.textContent).toContain('40')
      // (60 - 100) / 100 — a signed percent against yesterday, never against the window.
      expect(status.textContent).toContain('-40.0%')
      expect(container.querySelector('[data-crosshair] line')).not.toBeNull()
      restore()
    })

    it('CRITICAL: refuses a percentage when yesterday was zero — says so instead', () => {
      const restore = withWidth()
      const zeroThenSpike = [
        { day: '2026-09-10', views: 0, visitors: 0 },
        { day: '2026-09-11', views: 30, visitors: 10 },
      ]
      const { container } = render(<TimelineChart points={zeroThenSpike} height={100} />)
      fireEvent.pointerMove(container.querySelector('svg')!.parentElement!, { clientX: 600 })
      const text = screen.getByRole('status').textContent!
      expect(text).toMatch(/no views on sep 10/i)
      expect(text).not.toMatch(/%/)
      restore()
    })

    it('has nothing to compare on the first day, and says that too', () => {
      const restore = withWidth()
      const { container } = render(<TimelineChart points={three} height={100} />)
      fireEvent.pointerMove(container.querySelector('svg')!.parentElement!, { clientX: 0 })
      expect(screen.getByRole('status').textContent).toMatch(/first day/i)
      restore()
    })

    it('leaves nothing behind when the pointer leaves', () => {
      const restore = withWidth()
      const { container } = render(<TimelineChart points={three} height={100} />)
      const plot = container.querySelector('svg')!.parentElement!
      fireEvent.pointerMove(plot, { clientX: 300 })
      expect(screen.queryByRole('status')).not.toBeNull()
      fireEvent.pointerLeave(plot)
      expect(screen.queryByRole('status')).toBeNull()
      expect(container.querySelector('[data-crosshair]')).toBeNull()
      restore()
    })
  })

  describe('the days before visitors were counted', () => {
    const across = [
      { day: '2026-09-10', views: 40, visitors: 0 },
      { day: '2026-09-11', views: 50, visitors: 0 },
      { day: '2026-09-12', views: 60, visitors: 20 },
      { day: '2026-09-13', views: 70, visitors: 30 },
    ]
    const pts = (c: HTMLElement) => visitorsLine(c).getAttribute('points')!.trim().split(/\s+/)

    it('CRITICAL: draws the visitors line only from the cut-over — an unmeasured day is not a zero', () => {
      const { container } = render(<TimelineChart points={across} visitorsSince="2026-09-12" height={100} />)
      expect(pts(container)).toHaveLength(2)
      expect(container.querySelector('[data-unmeasured="visitors"]')).not.toBeNull()
      expect(screen.getByText(/visitors counted from sep 12/i)).toBeTruthy()
    })

    it('draws every day and no shading when nothing is unmeasured', () => {
      const { container } = render(<TimelineChart points={across} height={100} />)
      expect(pts(container)).toHaveLength(4)
      expect(container.querySelector('[data-unmeasured]')).toBeNull()
    })

    it('a window wholly after the cut-over has no shaded span either', () => {
      const { container } = render(<TimelineChart points={across.slice(2)} visitorsSince="2026-09-12" height={100} />)
      expect(container.querySelector('[data-unmeasured]')).toBeNull()
    })

    it('CRITICAL: the readout says "not yet counted" rather than 0 on an unmeasured day', () => {
      const orig = HTMLElement.prototype.getBoundingClientRect
      HTMLElement.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect
      }
      const { container } = render(<TimelineChart points={across} visitorsSince="2026-09-12" height={100} />)
      fireEvent.pointerMove(container.querySelector('svg')!.parentElement!, { clientX: 0 })
      expect(screen.getByRole('status').textContent).toMatch(/not yet counted/i)
      HTMLElement.prototype.getBoundingClientRect = orig
    })
  })

  it('CRITICAL: charts a supplied series instead of views when asked, on the same zero-based scale', () => {
    const { container } = render(
      <TimelineChart points={points} primary={{ label: 'Plays', values: [20, 100, 0] }} height={100} />,
    )
    const y = ys(container.querySelector('polyline[data-series="views"]')!.getAttribute('points')!)
    expect(y[1]).toBeCloseTo(8, 5) // the 100 sits at the top of the plot
    expect(y[2]).toBe(100)         // the 0 on the floor
    // Plays alone: no visitors line, and the legend names the series that is drawn.
    expect(container.querySelector('polyline[data-series="visitors"]')).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Series' })).getByText('Plays')).toBeTruthy()
    expect(screen.queryByText('Visitors')).toBeNull()
  })

  it('does not name the best day itself — that is the panel beside it, and saying it twice was the complaint', () => {
    render(<TimelineChart points={points} height={80} />)
    expect(screen.queryByText(/best day/i)).toBeNull()
  })

  it('reads the day off the string, so a date never slips west of Greenwich', () => {
    // `new Date('2026-09-12')` is UTC midnight, which formats as Sep 11 in any
    // negative-offset zone — every US user, which is all of them.
    render(<TimelineChart points={[{ day: '2026-01-01', views: 1, visitors: 1 }]} height={40} />)
    expect(screen.getAllByText('Jan 1').length).toBeGreaterThan(0)
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
