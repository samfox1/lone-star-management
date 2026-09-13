// @vitest-environment jsdom
// One chart, one metric at a time, its facts beside it — and the facts never disagree with the chart.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MetricExplorer } from '@/app/artists/[id]/(dashboard)/metric-explorer'
import { METRICS, WINDOWS, type Metric, type MetricKey } from '@/lib/analytics'

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
const setup = () => render(
  <MetricExplorer metrics={metrics} timeline={timeline} prevTotals={prevTotals} days={4} windows={WINDOWS} visitorsSince="2026-09-12"
    extras={{ plays: [{ label: 'Named a song', value: '5 of 12' }] }} />,
)

describe('MetricExplorer', () => {
  const metricBtn = (name: RegExp) => within(screen.getByRole('group', { name: 'Metric' })).getByRole('button', { name })
  const panel = () => screen.getByRole('region', { name: /facts$/i })

  it('offers every metric in the registry, labels only — the numbers live in the panel', () => {
    setup()
    const btns = within(screen.getByRole('group', { name: 'Metric' })).getAllByRole('button')
    expect(btns.map((b) => b.textContent)).toEqual(metrics.map((m) => m.label))
    for (const b of btns) expect(b.textContent).not.toMatch(/\d/)
  })

  it('CRITICAL: the window switch sits on the same row and navigates by URL, where the server reads it', () => {
    setup()
    const win = screen.getByRole('group', { name: 'Window' })
    expect(within(win).getAllByRole('button').map((b) => b.textContent)).toEqual(WINDOWS.map((n) => `${n} days`))
    fireEvent.click(within(win).getByRole('button', { name: '90 days' }))
    expect(push).toHaveBeenCalledWith('/artists/x?days=90')
  })

  it('opens on views, with the visitors line still on the chart', () => {
    const { container } = setup()
    expect(metricBtn(/^views$/i)).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('polyline[data-series="visitors"]')).not.toBeNull()
    expect(within(panel()).getByText('200')).toBeTruthy()
  })

  it('CRITICAL: choosing a metric charts THAT series and swaps the facts to match', () => {
    const { container } = setup()
    fireEvent.click(metricBtn(/^plays$/i))
    // The chart now draws plays: the peak is the 8 on Sep 13, and no visitors line.
    const pts = container.querySelector('polyline[data-series="views"]')!.getAttribute('points')!.split(' ')
    const ys = pts.map((p) => Number(p.split(',')[1]))
    expect(Math.min(...ys)).toBe(ys[3])
    expect(container.querySelector('polyline[data-series="visitors"]')).toBeNull()
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
    expect(panel().textContent).toMatch(/nothing in the 4 days before/i)
    expect(panel().textContent).not.toMatch(/%/)
  })

  it('a metric with nothing in the window has no best day', () => {
    setup()
    fireEvent.click(metricBtn(/^ticket clicks$/i))
    expect(panel().textContent).toMatch(/best day—/i)
  })
})
