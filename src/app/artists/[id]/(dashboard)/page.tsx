import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { type SectionDiff } from '@/lib/content'
import { BarList } from '@/components/ui/bar-list'
import { MetricExplorer } from './metric-explorer'
import { SourceRings } from '@/components/ui/source-rings'
import { DeviceSplit } from '@/components/ui/device-split'
import { TopContent } from '@/components/ui/top-content'
import { KLabel, StatusDot } from '@/components/ui/ui'
import { CONTEXT_SINCE, metrics, reachesBeforeContext, summarizeDevices, summarizeSources, topBars, topContent, trafficWindow, entityRows, CONTENT_KINDS, type Bar, type ContentKind, type ContentList, type ContentRef, type EntityRow } from '@/lib/analytics'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DIFF_SECTIONS } from './sections'
import { analyticsScope, dashboardDiff, requireArtist } from './_data'

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

/**
 * How each content kind's rows become something drawable — a title, a picture,
 * a second line. Keyed by `ContentKind['key']`, so a kind added to the registry
 * without a loader here is a compile error, not an empty list.
 */
const REFS: Record<ContentKind['key'], (supabase: SupabaseClient, ids: string[]) => Promise<ContentRef[]>> = {
  songs: async (supabase, ids) => {
    const rows = (await supabase.from('tracks').select('id,title,cover_url,album_name').in('id', ids)).data ?? []
    return (rows as { id: string; title: string; cover_url: string | null; album_name: string | null }[])
      .map((t) => ({ id: t.id, title: t.title, image: t.cover_url, sub: t.album_name }))
  },
  tour: async (supabase, ids) => {
    const rows = (await supabase.from('tour_dates').select('id,venue,city,date,image_url').in('id', ids)).data ?? []
    return (rows as { id: string; venue: string | null; city: string | null; date: string | null; image_url: string | null }[])
      .map((d) => ({ id: d.id, title: d.venue ?? d.city ?? 'Show', image: d.image_url, sub: [d.city, d.date].filter(Boolean).join(' · ') || null }))
  },
  merch: async (supabase, ids) => {
    const rows = (await supabase.from('merch').select('id,title,image_url,price').in('id', ids)).data ?? []
    return (rows as { id: string; title: string; image_url: string | null; price: string | number | null }[])
      .map((m) => ({ id: m.id, title: m.title, image: m.image_url, sub: m.price != null ? String(m.price) : null }))
  },
}

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const { id } = await params
  const rawDays = (await searchParams).days
  const supabase = await createClient()
  // One read of the clock for the whole page (see analyticsScope).
  const { now, days, windowKey, window } = await analyticsScope(id, rawDays)
  // Independent round-trips — the ownership gate, the dirty-nav diff and the whole
  // traffic window — as ONE parallel wave, not a waterfall.
  //
  // The separate `analytics_summary` call that used to sit here is gone: every
  // per-type total now comes off `metrics(traffic)`, which reads the SAME window as
  // the chart. The old call took a timestamp `p_since` while the rest of the page
  // counted whole UTC days, so on most days the KPI row and the chart beside it were
  // describing slightly different slices and nothing on screen said so.
  const [, diff, traffic, byEntity] = await Promise.all([
    requireArtist(id),
    dashboardDiff(id),
    trafficWindow(supabase, id, days, now),
    entityRows(supabase, id, window.since),
  ])
  // The content lists. The ids come from the entity reader, the titles from the
  // tables: a second, dependent wave, one query per kind, in parallel. The kinds
  // come from the registry; REFS knows how to load each.
  const idsFor = (entity: string, type: string) =>
    [...new Set(byEntity.filter((r: EntityRow) => r.entity_type === entity && r.type === type).map((r) => r.entity_id))]
  const refs = await Promise.all(CONTENT_KINDS.map(async (k) => {
    const ids = idsFor(k.entity, k.type)
    return [k.key, ids.length ? await REFS[k.key](supabase, ids) : []] as const
  }))
  const allMetrics = metrics(traffic)
  const totalOf = (key: string) => allMetrics.find((m) => m.key === key)?.total ?? 0
  const lists = Object.fromEntries(
    CONTENT_KINDS.map((k, i) => [k.key, topContent(byEntity, { entity: k.entity, type: k.type }, refs[i][1], totalOf(k.metric))]),
  ) as Record<ContentKind['key'], ContentList>
  const partial = reachesBeforeContext(traffic.window)
  const counted = traffic.timeline.filter((d) => d.day >= CONTEXT_SINCE)
  const countedViews = counted.reduce((n, d) => n + d.views, 0)
  const countedVisitors = counted.reduce((n, d) => n + d.visitors, 0)
  const viewsPerVisitor = countedVisitors ? (countedViews / countedVisitors).toFixed(2) : '—'

  const places = rollBars(traffic.places, (r) => r.country, (r) => r.country, (r) => r.views, (r) => r.city)

  return (
    <div className="space-y-10">
      <section>
        {/* The overview: one chart, one metric at a time, its facts beside it.
            Views is the default because it is the one figure that runs unbroken
            across the 2026-09-12 cut-over — every row before it was written without
            a visitor hash and counts as no one. */}
        <MetricExplorer
          metrics={allMetrics}
          timeline={traffic.timeline}
          prevTotals={traffic.prevTotals}
          countedSince={CONTEXT_SINCE}
          windowKey={windowKey}
          days={days}
          extras={{
            // Over the days both were counted (see viewsPerVisitor); the page note explains the cut-over.
            views: [{ label: 'Per visitor', value: viewsPerVisitor }],
            bots: [{ label: 'Share of hits', value: totalOf('views') + totalOf('bots') ? `${((totalOf('bots') / (totalOf('views') + totalOf('bots'))) * 100).toFixed(1)}%` : '—' }],
          }}
        />
      </section>

      {/* WHERE FROM and ON WHAT share a row (Sam, 2026-09-13): the rings, one per
          source with its share of everyone as the arc, beside the device waffle —
          mobile, tablet, computer, which view of the site to build out. */}
      <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_auto]">
        <section>
          <KLabel>Source</KLabel>
          <SourceRings className="mt-3" sources={summarizeSources(traffic.sources, traffic.prevSources, traffic.sourceActions)} />
        </section>
        <section>
          <KLabel>Device</KLabel>
          <DeviceSplit className="mt-3" shares={summarizeDevices(traffic.devices)} />
        </section>
      </div>

      {/* WHERE. A ranked list on its own row — countries are named things of
          unequal length, and a bar compares magnitudes plainly where a pie does
          not. Empty until the event door has an ipinfo key. */}
      <section>
        <KLabel>Where they are</KLabel>
        <BarList
          className="mt-3"
          bars={places}
          empty="Location needs an ipinfo key on the event door."
        />
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
          <div className="mt-3 overflow-hidden rounded-xl bg-surface">
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
          <div className="mt-3 rounded-xl bg-surface p-5 font-space text-xs leading-relaxed text-ink-muted">
            Streaming audience, top songs, and cities appear here once this artist connects a
            streaming source (Spotify / Apple Music) on the Settings tab. Today we report exact
            last-30-day site events above.
          </div>
        </section>
      </div>
    </div>
  )
}
