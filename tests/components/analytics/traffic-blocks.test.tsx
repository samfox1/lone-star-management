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
import { render, screen, within } from '@testing-library/react'
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
  const area = container.querySelector('polygon')!
  const line = container.querySelector('polyline')!
  return { area, line }
}

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
    const visitorY = ys(container.querySelector('polyline')!.getAttribute('points')!)
    // Against ZERO, with max 100: 20 sits a fifth of the way up the plot.
    expect(visitorY[0]).toBeCloseTo(PAD_TOP + (1 - 20 / 100) * (h - PAD_TOP), 5)
    expect(visitorY[1]).toBeCloseTo(PAD_TOP + (1 - 40 / 100) * (h - PAD_TOP), 5)
    // Against the series MINIMUM the smallest value would be pinned to the floor.
    expect(visitorY[0]).not.toBeCloseTo(h, 1)
  })

  it('a zero day sits on the floor', () => {
    const h = 100
    const { container } = render(<TimelineChart points={points} height={h} />)
    const visitorY = ys(container.querySelector('polyline')!.getAttribute('points')!)
    expect(visitorY[1]).toBe(h)
  })

  it('a day of nothing at all still draws, flat on the floor, rather than dividing by zero', () => {
    const flat = [
      { day: '2026-09-11', views: 0, visitors: 0 },
      { day: '2026-09-12', views: 0, visitors: 0 },
    ]
    const { container } = render(<TimelineChart points={flat} height={80} />)
    const visitorY = ys(container.querySelector('polyline')!.getAttribute('points')!)
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
