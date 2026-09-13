// @vitest-environment jsdom
// The overview block, and the ways a sparkline can flatter the number beside it.
/**
 * A sparkline is the easiest chart to draw dishonestly, because it has no axis to
 * contradict it. Two rules keep these ones straight, and both are pinned below:
 *
 *   Against ZERO, not the series minimum. A min-normalised sparkline turns a flat
 *   week into a mountain range — 98, 99, 100 becomes a cliff. The `TimelineChart`
 *   tests next door were once green against exactly this bug because the fixture
 *   happened to contain a 0, which makes the two scales identical. The fixture
 *   here has a floor of 20 on purpose.
 *
 *   Against its OWN maximum, not a shared one. Plays and views have no common
 *   scale; forcing them onto one would draw every small metric as a flat line and
 *   the reader would conclude nothing was happening.
 */
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MetricPills } from '@/components/ui/metric-pills'
import type { Metric } from '@/lib/analytics'

const PLOT_H = 28

const m = (key: string, label: string, series: number[]): Metric =>
  ({ key, label, series, total: series.reduce((n, v) => n + v, 0) }) as Metric

const FIXTURE: Metric[] = [
  m('views', 'Views', [40, 100, 60]),
  m('visitors', 'Visitors', [20, 50, 30]),
  m('plays', 'Plays', [1, 2, 0]),
  m('link_clicks', 'Link clicks', [0, 1, 1]),
  m('ticket_clicks', 'Ticket clicks', [0, 0, 0]),
  m('buy_clicks', 'Buy clicks', [0, 0, 1]),
  m('bots', 'Bots filtered', [3, 4, 1]),
]

/** The y each point was drawn at, read back off a polyline. */
const ys = (el: Element) =>
  el.getAttribute('points')!.trim().split(/\s+/).map((p) => Number(p.split(',')[1]))

const lines = (c: HTMLElement) => [...c.querySelectorAll('polyline')]

describe('MetricPills', () => {
  it('CRITICAL: a sparkline is drawn against ZERO, not against the series minimum', () => {
    // Floor of 20 deliberately: with a 0 in the series both scales agree and the
    // test would pass against the very bug it names.
    const { container } = render(<MetricPills metrics={[m('views', 'Views', [20, 100])]} />)
    const y = ys(lines(container)[0])
    // Against zero, with max 100: 20 sits a fifth of the way up the plot.
    expect(y[0]).toBeCloseTo(PLOT_H - (20 / 100) * PLOT_H, 5)
    expect(y[1]).toBeCloseTo(0, 5)
    // Against the minimum, 20 would be pinned to the floor.
    expect(y[0]).not.toBeCloseTo(PLOT_H, 1)
  })

  it('CRITICAL: each metric is scaled to its OWN maximum, so a small one is not a flat line', () => {
    const { container } = render(
      <MetricPills metrics={[m('views', 'Views', [0, 1000]), m('plays', 'Plays', [0, 2])]} />,
    )
    const [views, plays] = lines(container).map(ys)
    // Two wildly different units, both reaching the top of their own box.
    expect(views[1]).toBeCloseTo(0, 5)
    expect(plays[1]).toBeCloseTo(0, 5)
  })

  it('a series of nothing at all draws flat on the floor rather than dividing by zero', () => {
    const { container } = render(<MetricPills metrics={[m('ticket_clicks', 'Ticket clicks', [0, 0, 0])]} />)
    const y = ys(lines(container)[0])
    expect(y).toEqual([PLOT_H, PLOT_H, PLOT_H])
    expect(y.every(Number.isFinite)).toBe(true)
  })

  it('shows every metric it is given — nothing is hand-listed in the component', () => {
    render(<MetricPills metrics={FIXTURE} />)
    for (const metric of FIXTURE) {
      expect(screen.getAllByText(metric.label).length, metric.key).toBeGreaterThan(0)
    }
  })

  it('CRITICAL: bots are shown, because they are how a reader tells a real spike from a crawl', () => {
    render(<MetricPills metrics={FIXTURE} />)
    const table = screen.getByRole('table', { name: /totals for the window/i })
    const row = within(table).getByRole('row', { name: /bots filtered/i })
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Bots filtered', '8'])
  })

  it('CRITICAL: every value is readable without a chart — the table is the twin, not a fallback', () => {
    render(<MetricPills metrics={FIXTURE} />)
    const table = screen.getByRole('table', { name: /totals for the window/i })
    for (const metric of FIXTURE) {
      const row = within(table).getByRole('row', { name: new RegExp(metric.label, 'i') })
      // By POSITION, not by text: several totals are the same number.
      expect(within(row).getAllByRole('cell').map((c) => c.textContent), metric.key)
        .toEqual([metric.label, String(metric.total)])
    }
  })

  it('groups thousands, because a bare 1111 is read wrong at a glance', () => {
    render(<MetricPills metrics={[m('views', 'Views', [1000, 111])]} />)
    expect(screen.getByText('1,111')).toBeTruthy()
  })

  it('survives a metric the registry has but the window has no rows for', () => {
    const { container } = render(<MetricPills metrics={[m('buy_clicks', 'Buy clicks', [])]} />)
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    // An empty series must not draw a polyline with NaN coordinates.
    for (const line of lines(container)) {
      expect(ys(line).every(Number.isFinite)).toBe(true)
    }
  })
})
