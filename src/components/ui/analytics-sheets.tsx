'use client'

import { useState } from 'react'
import { weekdayLabel } from '@/lib/chart'
import { shareLabel } from '@/lib/detail-table'
import { countryName } from '@/lib/analytics-places'
import type { SourceSummary } from '@/lib/analytics'
import type { WorldMapData } from '@/lib/analytics-map'
import { DetailTable, type Column } from './detail-table'
import { SheetButton, SideSheet } from './side-sheet'
import { SourceGlyph } from './source-glyphs'

/**
 * The Analytics page's three full tables, each behind a button that opens it in a side
 * panel (the r12 mock): ALL DAYS on the chart's legend row, ALL SOURCES beside SOURCE, ALL
 * COUNTRIES above the list by the map — every one at the page's right edge (Sam, 2026-10-06:
 * "say all sources/days/etc … they should all be right aligned"). A country steps into its cities, a source into
 * the sites that sent it; the back arrow steps out. Every number is one the page already
 * shows, in full.
 */

/** One line of the chart, for the day table: its short name, its days, and when it was first counted. */
export type DayColumn = { key: string; label: string; values: number[]; since?: string }

export function AllDays({ days, lines }: { days: string[]; lines: DayColumn[] }) {
  const [open, setOpen] = useState(false)
  const rows = days.map((day, i) => ({ day, i }))
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'day', label: 'Day', value: (r) => r.day, show: (r) => weekdayLabel(r.day) },
    ...lines.map((l, n): Column<(typeof rows)[number]> => ({
      key: l.key, label: l.label, tone: n === 0 ? 'strong' : 'faint',
      // A day before a line was counted is a dash, not a zero.
      value: (r) => (l.since && r.day < l.since ? null : l.values[r.i] ?? 0),
    })),
  ]
  return (
    <>
      <SheetButton label="All days" onClick={() => setOpen(true)} />
      {open && (
        <SideSheet title="All days" onClose={() => setOpen(false)}>
          <DetailTable label="All days" columns={columns} rows={rows} rowKey={(r) => r.day} sort={{ key: 'day', dir: 'desc' }} />
        </SideSheet>
      )}
    </>
  )
}

type Host = { host: string; visitors: number }

export function AllSources({ sources }: { sources: SourceSummary[] }) {
  const [open, setOpen] = useState(false)
  const [into, setInto] = useState<SourceSummary | null>(null)
  const total = sources.reduce((n, s) => n + s.visitors, 0)
  const columns: Column<SourceSummary>[] = [
    {
      key: 'source', label: 'Source', value: (s) => s.label,
      show: (s) => <span className="inline-flex items-center gap-2.5"><SourceGlyph source={s.source} size={18} className="text-ink" />{s.label}</span>,
    },
    { key: 'visitors', label: 'Visitors', tone: 'strong', value: (s) => s.visitors },
    { key: 'views', label: 'Views', tone: 'faint', value: (s) => s.views },
    { key: 'share', label: 'Share', value: (s) => s.visitors, show: (s) => shareLabel(s.visitors, total) },
  ]
  const hostTotal = into ? into.hosts.reduce((n, h) => n + h.visitors, 0) : 0
  const hostColumns: Column<Host>[] = [
    { key: 'host', label: 'Site', value: (h) => h.host },
    { key: 'visitors', label: 'Visitors', tone: 'strong', value: (h) => h.visitors },
    { key: 'share', label: 'Share', value: (h) => h.visitors, show: (h) => shareLabel(h.visitors, hostTotal) },
  ]
  const close = () => { setOpen(false); setInto(null) }
  return (
    <>
      <SheetButton label="All sources" onClick={() => setOpen(true)} />
      {open && (
        <SideSheet title={into ? into.label : 'All sources'} onClose={close} onBack={into ? () => setInto(null) : undefined}>
          {into
            ? <DetailTable key={into.source} label={`Sites that sent ${into.label}`} columns={hostColumns} rows={into.hosts} rowKey={(h) => h.host} sort={{ key: 'visitors', dir: 'desc' }} />
            : <DetailTable
                label="All sources" columns={columns} rows={sources} rowKey={(s) => s.source} sort={{ key: 'visitors', dir: 'desc' }}
                // A source steps into the sites that sent it, when there are any (Direct has none).
                onRow={setInto} leads={(s) => s.hosts.length > 0}
              />}
        </SideSheet>
      )}
    </>
  )
}

type Country = WorldMapData['countries'][number]
type City = { key: string; name: string; region: string; visitors: number; views: number }

export function AllCountries({ map }: { map: Pick<WorldMapData, 'countries' | 'majorCities' | 'other'> }) {
  const [open, setOpen] = useState(false)
  const [into, setInto] = useState<string | null>(null)
  const total = map.countries.reduce((n, c) => n + c.visitors, 0)
  const columns: Column<Country>[] = [
    { key: 'country', label: 'Country', value: (c) => c.name },
    { key: 'cities', label: 'Cities', tone: 'faint', value: (c) => c.majorCities },
    { key: 'visitors', label: 'Visitors', tone: 'strong', value: (c) => c.visitors },
    { key: 'views', label: 'Views', tone: 'faint', value: (c) => c.views },
    { key: 'share', label: 'Share', value: (c) => c.visitors, show: (c) => shareLabel(c.visitors, total) },
  ]
  // Inside a country: its major cities, then the visitors no major city reaches as one row.
  const cities: City[] = into === null ? [] : [
    ...map.majorCities.filter((m) => m.country === into).map((m) => ({ key: m.key, name: m.name, region: m.region, visitors: m.visitors, views: m.views })),
    ...(map.other[into] ? [{ key: 'other', name: 'Other places', region: '', visitors: map.other[into].visitors, views: map.other[into].views }] : []),
  ]
  const cityTotal = cities.reduce((n, c) => n + c.visitors, 0)
  const cityColumns: Column<City>[] = [
    {
      key: 'city', label: 'City', value: (c) => c.name,
      show: (c) => <>{c.name}{c.region && <span className="ml-2 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{c.region}</span>}</>,
    },
    { key: 'visitors', label: 'Visitors', tone: 'strong', value: (c) => c.visitors },
    { key: 'views', label: 'Views', tone: 'faint', value: (c) => c.views },
    { key: 'share', label: 'Share', value: (c) => c.visitors, show: (c) => shareLabel(c.visitors, cityTotal) },
  ]
  const close = () => { setOpen(false); setInto(null) }
  return (
    <>
      <SheetButton label="All countries" onClick={() => setOpen(true)} />
      {open && (
        <SideSheet title={into ? countryName(into) : 'All countries'} onClose={close} onBack={into ? () => setInto(null) : undefined}>
          {into
            ? <DetailTable key={into} label={`Cities in ${countryName(into)}`} columns={cityColumns} rows={cities} rowKey={(c) => c.key} sort={{ key: 'visitors', dir: 'desc' }} />
            : <DetailTable label="All countries" columns={columns} rows={map.countries} rowKey={(c) => c.code} sort={{ key: 'visitors', dir: 'desc' }} onRow={(c) => setInto(c.code)} />}
        </SideSheet>
      )}
    </>
  )
}
