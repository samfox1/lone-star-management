import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { type SectionDiff } from '@/lib/content'
import { formatTrend, seriesTrend, trendTextClass } from '@/lib/format'
import { cx } from '@/lib/cx'
import { TimelineChart } from '@/components/ui/timeline-chart'
import { BarList } from '@/components/ui/bar-list'
import { MetricPills } from '@/components/ui/metric-pills'
import { SourceRings } from '@/components/ui/source-rings'
import { DeviceSplit } from '@/components/ui/device-split'
import { TopContent } from '@/components/ui/top-content'
import { KLabel, StatusDot } from '@/components/ui/ui'
import { CONTEXT_SINCE, analyticsWindow, metrics, reachesBeforeContext, summarizeDevices, summarizeSources, topBars, topContent, trafficWindow, windowDays, CONTENT_KINDS, WINDOWS, type Bar, type ContentRef, type EntityRow } from '@/lib/analytics'
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
  // Independent round-trips — the ownership gate, the dirty-nav diff and the whole
  // traffic window — as ONE parallel wave, not a waterfall.
  //
  // The separate `analytics_summary` call that used to sit here is gone: every
  // per-type total now comes off `metrics(traffic)`, which reads the SAME window as
  // the chart. The old call took a timestamp `p_since` while the rest of the page
  // counted whole UTC days, so on most days the KPI row and the chart beside it were
  // describing slightly different slices and nothing on screen said so.
  const window = analyticsWindow(days)
  const [, diff, traffic, byEntity] = await Promise.all([
    requireArtist(id),
    dashboardDiff(id),
    trafficWindow(supabase, id, days),
    supabase.rpc('analytics_by_entity', { p_artist_id: id, p_since: `${window.since}T00:00:00Z` }),
  ])
  // The content lists. The ids come from the entity reader, the titles from the
  // tables: a second, dependent wave, one query per kind, in parallel.
  const entityRows = (byEntity.data ?? []) as EntityRow[]
  const idsFor = (entity: string, type: string) =>
    [...new Set(entityRows.filter((r) => r.entity_type === entity && r.type === type).map((r) => r.entity_id))]
  const [trackRows, tourRows, merchRows] = await Promise.all([
    (async () => { const ids = idsFor('track', 'play'); return ids.length ? (await supabase.from('tracks').select('id,title,cover_url,album_name').in('id', ids)).data ?? [] : [] })(),
    (async () => { const ids = idsFor('tour_date', 'ticket_click'); return ids.length ? (await supabase.from('tour_dates').select('id,venue,city,date,image_url').in('id', ids)).data ?? [] : [] })(),
    (async () => { const ids = idsFor('merch', 'buy_click'); return ids.length ? (await supabase.from('merch').select('id,title,image_url,price').in('id', ids)).data ?? [] : [] })(),
  ])
  const allMetrics = metrics(traffic)
  const trend = formatTrend(seriesTrend(traffic.timeline.map((d) => d.views)))
  const totalOf = (key: string) => allMetrics.find((m) => m.key === key)?.total ?? 0
  const refs: Record<string, ContentRef[]> = {
    songs: (trackRows as { id: string; title: string; cover_url: string | null; album_name: string | null }[])
      .map((t) => ({ id: t.id, title: t.title, image: t.cover_url, sub: t.album_name })),
    tour: (tourRows as { id: string; venue: string | null; city: string | null; date: string | null; image_url: string | null }[])
      .map((d) => ({ id: d.id, title: d.venue ?? d.city ?? 'Show', image: d.image_url, sub: [d.city, d.date].filter(Boolean).join(' · ') || null })),
    merch: (merchRows as { id: string; title: string; image_url: string | null; price: string | number | null }[])
      .map((m) => ({ id: m.id, title: m.title, image: m.image_url, sub: m.price != null ? String(m.price) : null })),
  }
  const lists = Object.fromEntries(
    CONTENT_KINDS.map((k) => [k.key, topContent(entityRows, { entity: k.entity, type: k.type }, refs[k.key], totalOf(k.metric))]),
  ) as Record<(typeof CONTENT_KINDS)[number]['key'], ReturnType<typeof topContent>>
  const partial = reachesBeforeContext(traffic.window)

  const places = rollBars(traffic.places, (r) => r.country, (r) => r.country, (r) => r.views, (r) => r.city)

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
        {/* The overview. Every metric carries its own 30-day shape, because "how big"
            and "which way" are two different questions and the row of equal tiles
            this replaces only answered the first.

            Views leads, not visitors, because views are the one figure that runs
            unbroken across the 2026-09-12 cut-over — every row before it was written
            without a visitor hash and counts as no one. */}
        <div className="flex items-baseline gap-3">
          <span className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
            Last {days} days
          </span>
          <span className={cx('font-space text-xs font-bold', trendTextClass(trend.dir))}>{trend.label}</span>
        </div>

        <MetricPills metrics={allMetrics} className="mt-3" />

        <TimelineChart points={traffic.timeline} visitorsSince={CONTEXT_SINCE} className="mt-6" />
      </section>

      {/* WHERE FROM. One ring per source, its share of everyone as the arc. */}
      <section>
        <KLabel>Where they came from</KLabel>
        <SourceRings className="mt-3" sources={summarizeSources(traffic.sources, traffic.prevSources)} />
      </section>

      {/* WHERE, AND ON WHAT. Ranked lists rather than charts: the categories are
          named things of unequal length, and a reader comparing them is comparing
          magnitudes, which a bar does plainly and a pie does not. */}
      <div className="grid gap-10 md:grid-cols-2">

        <section>
          <KLabel>Where they are</KLabel>
          <BarList
            className="mt-3"
            bars={places}
            empty="Location needs an ipinfo key on the event door."
          />
        </section>

      </div>

      {/* ON WHAT. Mobile against web, one scale across both. */}
      <section>
        <KLabel>What they used</KLabel>
        <DeviceSplit className="mt-3" split={summarizeDevices(traffic.devices)} />
      </section>

      {/* WHAT THEY ACTED ON. Songs by plays, dates by ticket clicks, merch by buy
          clicks — the three events the site attaches an entity to. No videos: the
          site never sends a video event. */}
      <section>
        <KLabel>What they acted on</KLabel>
        <TopContent className="mt-3" lists={lists} />
      </section>

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
