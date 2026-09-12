import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { type SectionDiff } from '@/lib/content'
import { compactNumber, formatTrend, seriesTrend, trendTextClass } from '@/lib/format'
import { cx } from '@/lib/cx'
import { TimelineChart } from '@/components/ui/timeline-chart'
import { BarList } from '@/components/ui/bar-list'
import { KLabel, StatusDot } from '@/components/ui/ui'
import { sourceLabel } from '@/lib/analytics-sources'
import { reachesBeforeContext, topBars, trafficWindow, windowDays, WINDOWS, type Bar } from '@/lib/analytics'
import { DIFF_SECTIONS } from './sections'
import { dashboardDiff, requireArtist } from './_data'

function summarize(d: SectionDiff): string {
  if (!d.dirty) return 'Published'
  const parts: string[] = []
  if (d.added) parts.push(`${d.added} new`)
  if (d.edited) parts.push(`${d.edited} edited`)
  if (d.deleted) parts.push(`${d.deleted} removed`)
  return parts.join(', ')
}

const KPIS = [
  { type: 'play', label: 'Plays' },
  { type: 'link_click', label: 'Link clicks' },
  { type: 'ticket_click', label: 'Ticket clicks' },
  { type: 'buy_click', label: 'Buy clicks' },
] as const

/** Sum rows to one bar per key, carrying the biggest contributor as the sub-label. */
function rollBars<T>(
  rows: T[],
  key: (r: T) => string,
  label: (r: T) => string,
  value: (r: T) => number,
  sub: (r: T) => string,
): Bar[] {
  const by = new Map<string, Bar & { subValue: number }>()
  for (const r of rows) {
    const k = key(r)
    if (!k) continue
    const got = by.get(k) ?? { key: k, label: label(r), value: 0, subValue: 0 }
    got.value += value(r)
    // The sub-label names the largest single contributor, not the last one seen.
    if (value(r) > got.subValue && sub(r)) {
      got.subValue = value(r)
      got.sub = sub(r)
    }
    by.set(k, got)
  }
  return topBars([...by.values()])
}

const DEVICE_LABEL: Record<string, string> = { mobile: 'Phone', tablet: 'Tablet', desktop: 'Desktop' }

// Lifted out of the component body so reading the clock isn't an impure call during
// render (react-hooks/purity) — the same reason `thirtyDaysAgoIso` used to sit here.
function windowSince(days: number): string {
  return new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
}

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const { id } = await params
  const days = windowDays((await searchParams).days)
  const supabase = await createClient()
  // Independent round-trips — the ownership gate, the dirty-nav diff, the per-type
  // counts and the whole traffic window — as ONE parallel wave, not a waterfall. The
  // counts group-by is exact SQL (RLS-scoped), so it never undercounts past
  // PostgREST's 1000-row cap.
  const since = windowSince(days)
  const [, diff, { data: rows }, traffic] = await Promise.all([
    requireArtist(id),
    dashboardDiff(id),
    supabase.rpc('analytics_summary', { p_artist_id: id, p_since: since }),
    trafficWindow(supabase, id, days),
  ])
  const counts: Record<string, number> = {}
  for (const r of (rows ?? []) as { type: string; count: number }[]) counts[r.type] = Number(r.count)
  const series = traffic.timeline.map((d) => d.views)
  const trend = formatTrend(seriesTrend(series))
  const partial = reachesBeforeContext(traffic.window)

  const sources = rollBars(traffic.sources, (r) => r.source, (r) => sourceLabel(r.source), (r) => r.views, (r) => r.referrer_host)
  const places = rollBars(traffic.places, (r) => r.country, (r) => r.country, (r) => r.views, (r) => r.city)
  const devices = rollBars(traffic.devices, (r) => r.device, (r) => DEVICE_LABEL[r.device] ?? r.device, (r) => r.views, (r) => r.browser)

  return (
    <div className="space-y-10">
      {/* ONE filter row, above everything it scopes — never a control per block. */}
      <div className="flex items-center gap-1">
        {WINDOWS.map((n) => (
          <Link
            key={n}
            href={`/artists/${id}?days=${n}`}
            aria-current={n === days ? 'page' : undefined}
            className={cx(
              'rounded-full px-3 py-1 font-space text-[11px] uppercase tracking-[0.1em] transition-colors',
              n === days ? 'bg-ink text-paper' : 'text-ink-faint hover:bg-surface-hover',
            )}
          >
            {n} days
          </Link>
        ))}
      </div>

      <section>
        {/* The headline is VIEWS, not visitors, because views are the one figure that
            runs unbroken across the 2026-09-12 cut-over — every row before it was
            written without a visitor hash and counts as none. */}
        <div className="flex items-baseline gap-3 font-space text-[44px] font-bold leading-none tracking-[-0.015em]">
          {compactNumber(traffic.totals.views)}
          <span className={cx('text-sm font-bold', trendTextClass(trend.dir))}>{trend.label}</span>
        </div>
        <div className="mt-2 font-space text-xs uppercase tracking-[0.1em] text-ink-faint">
          Site views · last {days} days
        </div>

        <TimelineChart points={traffic.timeline} className="mt-4" height={150} />

        {/* KPI divider row */}
        <div className="mt-6 flex flex-wrap gap-y-6 border-y border-hairline py-5">
          {[
            // Visitors first: one address is one visitor however many times it loads
            // the page, so it is the figure a flood cannot inflate.
            { type: 'visitors', label: 'Visitors', value: traffic.totals.visitors },
            { type: 'bots', label: 'Bots filtered', value: traffic.totals.bots },
            ...KPIS.map((k) => ({ type: k.type, label: k.label, value: counts[k.type] ?? 0 })),
          ].map((k) => (
            <div
              key={k.type}
              className="min-w-[110px] flex-1 border-hairline pr-9 [&:not(:last-child)]:mr-9 [&:not(:last-child)]:border-r"
            >
              <div className="font-space text-[25px] font-bold tabular-nums tracking-[-0.02em]">
                {compactNumber(k.value)}
              </div>
              <div className="mt-1.5 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {k.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* WHERE FROM, WHERE, AND ON WHAT. Three ranked lists rather than three charts:
          the categories are named things of unequal length, and a reader comparing
          "Instagram" to "AI assistants" is comparing magnitudes, which a bar does
          plainly and a pie does not. */}
      <div className="grid gap-10 md:grid-cols-3">
        <section>
          <KLabel>Where they came from</KLabel>
          <BarList className="mt-3" bars={sources} empty="No visits yet." />
        </section>

        <section>
          <KLabel>Where they are</KLabel>
          <BarList
            className="mt-3"
            bars={places}
            empty="Location needs an ipinfo key on the event door."
          />
        </section>

        <section>
          <KLabel>What they used</KLabel>
          <BarList className="mt-3" bars={devices} empty="No visits yet." />
        </section>
      </div>

      {/* The numbers above do not all reach as far back as the window does, and the
          page has to say which. */}
      {partial && (
        <p className="font-space text-xs leading-relaxed text-ink-faint">
          Source, location and visitor figures start 12 Sep, when the sites moved to the new
          ingest. Views before that date are counted but include bot traffic, which is
          filtered from everything after.
        </p>
      )}

      <div className="grid gap-10 md:grid-cols-2">
        <section>
          <KLabel>Unpublished changes</KLabel>
          <div className="mt-3 overflow-hidden rounded-xl border border-hairline">
            {DIFF_SECTIONS.map((s, i) => {
              const d = diff[s.key]
              return (
                <Link
                  key={s.key}
                  href={`/artists/${id}/${s.seg}`}
                  className={`flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-surface-hover ${
                    i > 0 ? 'border-t border-hairline' : ''
                  }`}
                >
                  <span className="font-medium">{s.label}</span>
                  <span
                    className={`inline-flex items-center gap-2 font-space text-xs ${
                      d.dirty ? 'text-ink' : 'text-ink-faint'
                    }`}
                  >
                    {d.dirty && <StatusDot tone="pending" />}
                    {summarize(d)}
                  </span>
                </Link>
              )
            })}
          </div>
          <p className="mt-2.5 font-space text-xs text-ink-faint">
            Use a section&apos;s Publish button, or Publish all above.
          </p>
        </section>

        <section>
          <KLabel>Audience</KLabel>
          <div className="mt-3 rounded-xl border border-dashed border-hairline p-5 font-space text-xs leading-relaxed text-ink-muted">
            Streaming audience, top tracks, and cities appear here once this artist connects a
            streaming source (Spotify / Apple Music) on the Settings tab. Today we report exact
            last-30-day site events above.
          </div>
        </section>
      </div>
    </div>
  )
}
