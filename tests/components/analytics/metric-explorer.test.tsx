// @vitest-environment jsdom
// The views chart with visitors and bots as toggles, and facts that never disagree with what is drawn.
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
const setup = (windowKey = '7', daysN = 4) => render(
  <MetricExplorer metrics={metrics} timeline={timeline} prevTotals={prevTotals} windowKey={windowKey} days={daysN} countedSince="2026-09-12"
    extras={{ bots: [{ label: 'Share of hits', value: '2.0%' }] }} />,
)
const toggles = () => screen.getByRole('group', { name: 'Series' })
const facts = () => screen.getByRole('region', { name: 'Facts' })

describe('MetricExplorer', () => {
  const check = (name: string) => within(toggles()).getByRole('checkbox', { name })

  it('CRITICAL: views is always drawn with no switch; the two overlays are square checks, ON by default; nothing is Plays', () => {
    const { container } = setup()
    const boxes = within(toggles()).getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(OVERLAYS.map((k) => metrics.find((m) => m.key === k)!.label))
    expect(within(toggles()).queryByText('Views')).toBeNull()
    expect(within(toggles()).queryByText('Plays')).toBeNull()
    for (const b of boxes) expect(b).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelectorAll('[data-series]')).toHaveLength(3)
  })

  it('CRITICAL: unchecking removes that line from the SAME chart, checking adds it back', () => {
    const { container } = setup()
    fireEvent.click(check('Unique visitors'))
    expect(container.querySelectorAll('[data-series]')).toHaveLength(2)
    expect(container.querySelector('[data-series="visitors"]')).toBeNull()
    fireEvent.click(check('Bots filtered'))
    expect(container.querySelectorAll('[data-series]')).toHaveLength(1)
    fireEvent.click(check('Unique visitors'))
    expect(container.querySelectorAll('[data-series]')).toHaveLength(2)
    expect(within(screen.getByRole('list', { name: 'Series' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Views', 'Unique visitors',
    ])
  })

  it('the facts tabs are always there — Views, Visitors, Bots — drawn or not', () => {
    setup()
    const tabs = screen.getByRole('tablist', { name: 'Facts for' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Views', 'Visitors', 'Bots'])
    fireEvent.click(check('Bots filtered')) // off the chart…
    expect(within(tabs).getByRole('tab', { name: 'Bots' })).toBeTruthy() // …still a tab
  })

  it('facts lead with views: total, change on the prior window, best day, per day', () => {
    setup()
    const f = facts().textContent!
    expect(f).toContain('200')
    expect(f).toContain('+100.0%')
    expect(f).toMatch(/^.*total/i)
    expect(f).not.toMatch(/views · /i)
    expect(f).toMatch(/best daysep 13per day/i)
    expect(f).toMatch(/per day50/i)
  })

  it('CRITICAL: picking a tab shows THAT series over the counted days only', () => {
    setup()
    const tabs = screen.getByRole('tablist', { name: 'Facts for' })
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Visitors' }))
    // 50 visitors over 2 counted days → 25, not 12.5 over four.
    expect(facts().textContent).toMatch(/total50/i)
    expect(facts().textContent).toMatch(/per day25/i)
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Bots' }))
    expect(facts().textContent).toContain('2.0%')
  })

  it('withholds the views change when the prior window had nothing, and drops it entirely for all time', () => {
    const noPrior = render(
      <MetricExplorer metrics={metrics} timeline={timeline} prevTotals={{ ...prevTotals, views: 0 }} windowKey="7" days={4} />,
    )
    expect(within(noPrior.getByRole('region', { name: 'Facts' })).getByText(/no prior 4d/i)).toBeTruthy()
    noPrior.unmount()
    setup('all', 74)
    expect(facts().textContent).toMatch(/all time/i)
    expect(facts().textContent).not.toMatch(/prior|%/i)
  })

  it('CRITICAL: the window switch sits on the same row and navigates by URL, where the server reads it', () => {
    setup()
    const win = screen.getByRole('group', { name: 'Window' })
    expect(within(win).getAllByRole('button').map((b) => b.textContent)).toEqual(WINDOW_OPTIONS.map((o) => o.label))
    fireEvent.click(within(win).getByRole('button', { name: 'All' }))
    expect(push).toHaveBeenCalledWith('/artists/x?days=all')
  })
})
