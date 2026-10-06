// @vitest-environment jsdom
// The Analytics page's full tables in a side panel: All days, All sources, All countries.
// Light (UI still settling): the main path of each — it opens, it shows the record, it steps in
// and back out, and it closes. The sort rule itself is pinned in tests/unit/analytics/detail-table.test.ts.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AllCountries, AllDays, AllSources } from '@/components/ui/analytics-sheets'
import { worldMap } from '@/lib/analytics-map'
import type { PlaceRow, SourceSummary } from '@/lib/analytics'

const bodyRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1)
const firstCells = (table: HTMLElement) => bodyRows(table).map((r) => within(r).getAllByRole('cell')[0].textContent)

describe('All days', () => {
  it('CRITICAL: every day, newest first, every line — a day before a line was counted is a dash, not a zero', () => {
    render(<AllDays days={['2026-09-10', '2026-09-11', '2026-09-12']} lines={[
      { key: 'views', label: 'Views', values: [4, 5, 6] },
      { key: 'visitors', label: 'Visitors', values: [0, 0, 3], since: '2026-09-12' },
    ]} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /all days/i }))
    const table = screen.getByRole('table', { name: 'All days' })
    expect(bodyRows(table).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['Sat, Sep 12', '6', '3'], ['Fri, Sep 11', '5', '—'], ['Thu, Sep 10', '4', '—'],
    ])
    // A column's name sorts by it: biggest first, then flipped.
    fireEvent.click(within(table).getByRole('button', { name: /views/i }))
    expect(firstCells(table)).toEqual(['Sat, Sep 12', 'Fri, Sep 11', 'Thu, Sep 10'])
    fireEvent.click(within(table).getByRole('button', { name: /views/i }))
    expect(firstCells(table)).toEqual(['Thu, Sep 10', 'Fri, Sep 11', 'Sat, Sep 12'])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('All countries', () => {
  const row = (country: string, region: string, city: string, visitors: number, views: number, lat: number, lon: number): PlaceRow =>
    ({ country, region, city, visitors, views, lat, lon })
  const map = worldMap([
    row('US', 'Illinois', 'Chicago', 186, 415, 41.88, -87.63),
    row('US', 'Nebraska', 'Broken Bow', 2, 3, 41.4, -99.64), // near no major city
    row('DE', 'Berlin', 'Berlin', 200, 210, 52.52, 13.405),
  ])

  it('CRITICAL: countries by visitors; a country steps into its cities (and its Other places), and back out', () => {
    render(<AllCountries map={map} />)
    fireEvent.click(screen.getByRole('button', { name: /all countries/i }))
    expect(firstCells(screen.getByRole('table', { name: 'All countries' }))).toEqual(['Germany›', 'United States›'])
    fireEvent.click(screen.getByRole('button', { name: /^United States/ }))
    expect(screen.getByRole('dialog', { name: 'United States' })).toBeTruthy()
    const cities = screen.getByRole('table', { name: 'Cities in United States' })
    expect(bodyRows(cities).map((r) => within(r).getAllByRole('cell').slice(0, 2).map((c) => c.textContent))).toEqual([
      ['ChicagoIllinois', '186'], ['Other places', '2'],
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('table', { name: 'All countries' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('All sources', () => {
  const src = (source: string, label: string, visitors: number, hosts: { host: string; visitors: number }[]): SourceSummary =>
    ({ source, label, views: visitors + 1, visitors, share: 0, hosts, trend: null, actions: {} as SourceSummary['actions'], story: '' })

  it('a source with sites behind it steps into them; one without (Direct) leads nowhere', () => {
    render(<AllSources sources={[
      src('direct', 'Direct', 50, []),
      src('instagram', 'Instagram', 150, [{ host: 'l.instagram.com', visitors: 120 }, { host: 'instagram.com', visitors: 30 }]),
    ]} />)
    fireEvent.click(screen.getByRole('button', { name: /all sources/i }))
    const table = screen.getByRole('table', { name: 'All sources' })
    expect(bodyRows(table).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['Instagram›', '150', '151', '75.0%'], ['Direct', '50', '51', '25.0%'],
    ])
    expect(within(bodyRows(table)[1]).queryByRole('button')).toBeNull()
    fireEvent.click(within(table).getByRole('button', { name: /^Instagram/ }))
    expect(firstCells(screen.getByRole('table', { name: 'Sites that sent Instagram' }))).toEqual(['l.instagram.com', 'instagram.com'])
  })
})
