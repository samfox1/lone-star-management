// @vitest-environment jsdom
// One chart, one metric at a time, its facts beside it — and the facts never disagree with the chart.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MetricExplorer } from '@/app/artists/[id]/(dashboard)/metric-explorer'
import { CHART_METRICS, METRICS, WINDOW_OPTIONS, type Metric, type MetricKey } from '@/lib/analytics'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/artists/x' }))

const days = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']
const timeline = days.map((day, i) => ({ day, views: [40, 20, 60, 80][i], visitors: [0, 0, 20, 30][i], bots: [1, 0, 0, 1][i] }))
const series: Record<MetricKey, number[]> = {
  views: [40, 20, 60, 80], visitors: [0, 0, 20, 30], plays: [0, 3, 1, 8], link_clicks: [2, 2, 2, 2],
  ticket_clicks: [0, 0, 0, 0], buy_clicks: [0, 0, 0, 1], bots: [1, 0, 0, 1],
}
const metrics: Metric[] = METRICS.map((m) => ({ key: m.key, label: m.label, series: series[m.key], total: series[m.key].reduce((a, b) => a + b, 0) }))
const prevTotals: Record<MetricKey, number> = { views: 100, visitors: 0, plays: 6, link_clicks: 8, ticket_clicks: 0, buy_clicks: 0, bots: 0 }
const setup = (windowKey = '7', days = 4) => render(
  <MetricExplorer metrics={metrics} timeline={timeline} prevTotals={prevTotals} windowKey={windowKey} days={days} visitorsSince="2026-09-12"
    extras={{ plays: [{ label: 'Named a song', value: '5 of 12' }] }} />,
)

describe('MetricExplorer', () => {
  const metricBtn = (name: RegExp) => within(screen.getByRole('group', { name: 'Metric' })).getByRole('button', { name })
  const panel = () => screen.getByRole('region', { name: /facts$/i })

  it('CRITICAL: offers only the chart metrics, labels only — the click metrics are counted elsewhere', () => {
    setup()
    const btns = within(screen.getByRole('group', { name: 'Metric' })).getAllByRole('button')
    expect(btns.map((b) => b.textContent)).toEqual(metrics.filter((m) => CHART_METRICS.includes(m.key)).map((m) => m.label))
    expect(btns.map((b) => b.textContent)).not.toContain('Ticket clicks')
    for (const b of btns) expect(b.textContent).not.toMatch(/\d/)
  })

  it('CRITICAL: the window switch sits on the same row and navigates by URL, where the server reads it', () => {
    setup()
    const win = screen.getByRole('group', { name: 'Window' })
    expect(within(win).getAllByRole('button').map((b) => b.textContent)).toEqual(WINDOW_OPTIONS.map((o) => o.label))
    fireEvent.click(within(win).getByRole('button', { name: '90d' }))
    expect(push).toHaveBeenCalledWith('/artists/x?days=90')
    fireEvent.click(within(win).getByRole('button', { name: 'All' }))
    expect(push).toHaveBeenCalledWith('/artists/x?days=all')
  })

  it('opens on views, one series, no overlay', () => {
    const { container } = setup()
    expect(metricBtn(/^views$/i)).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelectorAll('polyline')).toHaveLength(1)
    expect(within(panel()).getByText('200')).toBeTruthy()
  })

  it('CRITICAL: visitor facts run over the counted days only, and "counted from" is said once', () => {
    const { container } = setup()
    fireEvent.click(metricBtn(/^visitors$/i))
    // 50 visitors over the 2 counted days, not over all 4.
    expect(panel().textContent).toMatch(/per day25/i)
    expect(container.textContent!.match(/counted from/gi)).toHaveLength(1)
  })

  it('CRITICAL: visitors start where they were counted, with no shaded span', () => {
    const { container } = setup()
    fireEvent.click(metricBtn(/^visitors$/i))
    const pts = container.querySelector('polyline[data-series="primary"]')!.getAttribute('points')!.trim().split(/\s+/)
    expect(pts).toHaveLength(2) // Sep 12 and 13 only
    expect(screen.getByText(/counted from sep 12/i)).toBeTruthy()
    expect(container.querySelector('rect')).toBeNull()
  })

  it('CRITICAL: choosing a metric charts THAT series and swaps the facts to match', () => {
    const { container } = setup()
    fireEvent.click(metricBtn(/^plays$/i))
    // The chart now draws plays: the peak is the 8 on Sep 13, and no visitors line.
    const pts = container.querySelector('polyline[data-series="primary"]')!.getAttribute('points')!.split(' ')
    const ys = pts.map((p) => Number(p.split(',')[1]))
    expect(Math.min(...ys)).toBe(ys[3])
    const p = panel()
    expect(p.textContent).toContain('12')
    expect(p.textContent).toMatch(/best day[\s\S]*sep 13 · 8/i)
    expect(p.textContent).toContain('5 of 12')
    // +100% against the 6 plays in the window before.
    expect(p.textContent).toContain('+100.0%')
  })

  it('CRITICAL: withholds the change when the window before had nothing', () => {
    setup()
    fireEvent.click(metricBtn(/^visitors$/i))
    expect(panel().textContent).toMatch(/no prior 4d/i)
    expect(panel().textContent).not.toMatch(/%/)
  })

  it('CRITICAL: all time has no prior window to compare against, so the line is absent — not "no prior all time"', () => {
    setup('all', 74)
    expect(panel().textContent).toMatch(/all time/i)
    expect(panel().textContent).not.toMatch(/prior/i)
    expect(panel().textContent).not.toMatch(/%/)
  })

  it('does not say the best day twice — the chart header lost it, the panel keeps it', () => {
    const { container } = setup()
    expect(container.textContent!.match(/best day/gi)).toHaveLength(1)
  })

  it('a metric with nothing in the window has no best day', () => {
    const zeroed = metrics.map((m) => (m.key === 'bots' ? { ...m, series: m.series.map(() => 0), total: 0 } : m))
    render(<MetricExplorer metrics={zeroed} timeline={timeline} prevTotals={prevTotals} windowKey="7" days={4} />)
    fireEvent.click(metricBtn(/^bots$/i))
    expect(panel().textContent).toMatch(/best day—/i)
  })
})
