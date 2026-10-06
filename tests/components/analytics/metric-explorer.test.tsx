// @vitest-environment jsdom
// The views chart with every other counted line as a toggle, and numbers that never disagree with what is drawn.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MetricExplorer } from '@/app/artists/[id]/(dashboard)/metric-explorer'
import { METRICS, OVERLAYS, WINDOW_OPTIONS, type Metric, type MetricKey } from '@/lib/analytics'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/artists/x' }))

const days = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']
const series: Record<MetricKey, number[]> = {
  views: [40, 20, 60, 80], visitors: [0, 0, 20, 30], plays: [0, 3, 1, 8], link_clicks: [2, 2, 2, 2],
  ticket_clicks: [0, 0, 0, 0], buy_clicks: [0, 0, 0, 1], bots: [0, 0, 3, 1],
}
const timeline = days.map((day, i) => ({ day, views: series.views[i], visitors: series.visitors[i], bots: series.bots[i] }))
const metrics: Metric[] = METRICS.map((m) => ({ key: m.key, label: m.label, series: series[m.key], total: series[m.key].reduce((a, b) => a + b, 0) }))
const prevTotals: Record<MetricKey, number> = { views: 100, visitors: 0, plays: 6, link_clicks: 8, ticket_clicks: 0, buy_clicks: 0, bots: 0 }
const setup = (windowKey = '7', daysN = 4, prev = prevTotals, countedSince = '2026-09-12') => render(
  <MetricExplorer metrics={metrics} timeline={timeline} prevTotals={prev} windowKey={windowKey} days={daysN} countedSince={countedSince} />,
)
const pointsOf = (c: HTMLElement, key: string) => c.querySelector(`[data-series="${key}"]`)!.getAttribute('data-points')!.trim().split(/\s+/)
const toggles = () => screen.getByRole('group', { name: 'Series' })
const numbers = () => screen.getByRole('region', { name: 'Numbers' })
const factOf = (key: string) => numbers().querySelector(`[data-fact="${key}"]`) as HTMLElement | null
const drawnKeys = (c: HTMLElement) => [...c.querySelectorAll('[data-series]')].map((g) => g.getAttribute('data-series'))

describe('MetricExplorer', () => {
  const check = (name: string) => within(toggles()).getByRole('checkbox', { name })

  it('CRITICAL: views is always drawn with no switch; every other chart line is a square check — visitors and bots on, the rest off', () => {
    const { container } = setup()
    const boxes = within(toggles()).getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(OVERLAYS.map((k) => METRICS.find((m) => m.key === k)!.label))
    expect(within(toggles()).queryByText('Views')).toBeNull()
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(OVERLAYS.map((k) => String(k === 'visitors' || k === 'bots')))
    expect(drawnKeys(container)).toEqual(['views', 'visitors', 'bots'])
  })

  it('CRITICAL: a check adds its line to the SAME chart and its numbers to the column; unchecking takes both away', () => {
    const { container } = setup()
    fireEvent.click(check('Song plays'))
    expect(drawnKeys(container)).toEqual(['views', 'visitors', 'bots', 'plays'])
    expect(factOf('plays')!.textContent).toMatch(/plays12per day\s*3\.0/i)
    fireEvent.click(check('Unique visitors'))
    expect(drawnKeys(container)).toEqual(['views', 'bots', 'plays'])
    expect(factOf('visitors')).toBeNull()
    // The column lists exactly what is drawn, in the same order.
    expect([...numbers().querySelectorAll('[data-fact]')].map((f) => f.getAttribute('data-fact'))).toEqual(drawnKeys(container))
  })

  it('CRITICAL: clicking the NAME toggles once, exactly as the square does — not twice, which is not at all', () => {
    const { container } = setup()
    fireEvent.click(within(toggles()).getByText('Unique visitors'))
    expect(container.querySelectorAll('[data-series]')).toHaveLength(2)
    expect(check('Unique visitors')).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(within(toggles()).getByText('Unique visitors'))
    expect(container.querySelectorAll('[data-series]')).toHaveLength(3)
  })

  it('CRITICAL: a cut-over line starts at the cut-over on the chart; views and the events run the whole window', () => {
    const { container } = setup()
    fireEvent.click(check('Link clicks'))
    // Four days, counted from the third: two points, not four zeros-then-values.
    expect(pointsOf(container, 'visitors')).toHaveLength(2)
    expect(pointsOf(container, 'bots')).toHaveLength(2)
    expect(pointsOf(container, 'views')).toHaveLength(4)
    expect(pointsOf(container, 'link_clicks')).toHaveLength(4)
  })

  it('CRITICAL: each line\'s numbers are its total and per day over the days it was counted — and no best day', () => {
    setup()
    expect(factOf('views')!.textContent).toMatch(/views200per day\s*50/i)
    // 50 visitors over 2 counted days → 25 a day, not 12.5 over four.
    expect(factOf('visitors')!.textContent).toMatch(/visitors50per day\s*25/i)
    expect(numbers().textContent).not.toMatch(/best day/i)
  })

  it('CRITICAL: the change on the prior window sits under per day; a cut-over line compares only once that window was wholly counted', () => {
    // Window 2026-09-10..13, so the prior one is 09-06..09-09. Counted from 09-12:
    // the prior window has no counted days at all, and "+400%" against it would be
    // 2 counted days against 0. Nothing is printed.
    const partial = setup('7', 4, { ...prevTotals, visitors: 10 })
    expect(factOf('views')!.textContent).toMatch(/per day\s*50▲ 100\.0% vs prior 4d/i)
    expect(factOf('visitors')!.querySelector('[data-growth]')).toBeNull()
    partial.unmount()
    // Counted from before the prior window started: both are whole, and 50 vs 10 prints.
    setup('7', 4, { ...prevTotals, visitors: 10 }, '2026-09-01')
    expect(factOf('visitors')!.textContent).toMatch(/▲ 400\.0%/)
  })

  it('prints no change when the prior window had nothing, and none at all for all time', () => {
    const noPrior = render(
      <MetricExplorer metrics={metrics} timeline={timeline} prevTotals={{ ...prevTotals, views: 0 }} windowKey="7" days={4} />,
    )
    expect(noPrior.container.querySelector('[data-fact="views"] [data-growth]')).toBeNull()
    expect(within(noPrior.getByRole('region', { name: 'Numbers' })).queryByText(/no prior/i)).toBeNull()
    noPrior.unmount()
    setup('all', 74)
    expect(numbers().querySelector('[data-growth]')).toBeNull()
    expect(numbers().textContent).not.toMatch(/prior|%/i)
  })

  it('CRITICAL: the window switch sits on the same row and navigates by URL, where the server reads it', () => {
    setup()
    const win = screen.getByRole('group', { name: 'Window' })
    expect(within(win).getAllByRole('button').map((b) => b.textContent)).toEqual(WINDOW_OPTIONS.map((o) => o.label))
    fireEvent.click(within(win).getByRole('button', { name: 'All' }))
    expect(push).toHaveBeenCalledWith('/artists/x?days=all')
  })
})
