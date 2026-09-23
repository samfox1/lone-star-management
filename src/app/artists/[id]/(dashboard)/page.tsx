import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { type SectionDiff } from '@/lib/content'
import { PlacesSection } from '@/components/ui/places-section'
// TEMPORARY (2026-09-17): the PostHog cross-check panel. Delete this import, the component
// file, src/lib/posthog-check.ts and the <PostHogCheckSlot /> below when the 30 days are over.
import { PostHogCheckSlot } from '@/components/ui/posthog-check'
import { worldMap } from '@/lib/analytics-map'
import { MetricExplorer } from './metric-explorer'
import { SourceRings } from '@/components/ui/source-rings'
import { DeviceSplit } from '@/components/ui/device-split'
import { TopContent } from '@/components/ui/top-content'
import { KLabel, StatusDot } from '@/components/ui/ui'
import { CONTEXT_SINCE, metrics, reachesBeforeContext, summarizeDevices, summarizeSources, topContent, trafficWindow, entityRows, entityTargetRows, entityFacts, targetsCover, CONTENT_KINDS, type ContentKind, type ContentList, type ContentRef, type EntityRow } from '@/lib/analytics'
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
  const [artist, diff, traffic, byEntity, byTarget] = await Promise.all([
    requireArtist(id),
    dashboardDiff(id),
    trafficWindow(supabase, id, days, now),
    entityRows(supabase, id, window.since),
    // Targets exist only on raw rows; past retention the hover would undercount, so it
    // is not read at all (review 2026-09-23).
    targetsCover(window.since, now) ? entityTargetRows(supabase, id, window.since) : null,
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

      {/* WHERE FROM and ON WHAT share a row from lg up (four 104px rings need
          464px; below lg the two stack): the rings, one per source with its share
          of everyone as the arc, beside the device waffle — mobile, tablet,
          computer, which view of the site to build out (Sam, 2026-09-14). */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section>
          <KLabel>Source</KLabel>
          <SourceRings className="mt-3" sources={summarizeSources(traffic.sources, traffic.prevSources, traffic.sourceActions)} />
        </section>
        {/* The label sits at the top beside SOURCE; the waffle centres on the ring rows
            (Sam, 2026-09-14), so the grid stretches the section and the flex column
            gives the waffle the rest of the height. */}
        <section className="lg:flex lg:flex-col lg:justify-self-end">
          <KLabel>Device</KLabel>
          <DeviceSplit className="mt-3 lg:flex-1" shares={summarizeDevices(traffic.devices)} />
        </section>
      </div>

      {/* WHERE. The map / globe on the left and the list on the right, in the SAME columns as
          Source / Device above (Sam, 2026-09-14). The list is countries, then a country's major
          cities: where the artist has a following worth touring (lib/analytics-major-cities.ts).
          Locations are recorded from 14 Sep 2026, when the door got its ipinfo key. Only the
          per-artist numbers are built here (lib/analytics-map.ts); the geography is baked once
          and loaded by the browser. Keyed by the window, so a country chosen in one window is not
          left chosen in a window where it has no visitors. No caption (Sam: "remove Where they are"). */}
      <section>
        <PlacesSection key={windowKey} map={worldMap(traffic.places)} />
      </section>

      {/* Songs by plays, products by buy clicks. Each column heads itself, so there
          is no label here. Ticket clicks are recorded and counted in the metric row
          above, but dates are not ranked against each other — see CONTENT_KINDS. */}
      <section>
        <TopContent lists={lists} facts={byTarget ? entityFacts(byTarget) : undefined} />
      </section>

      {/* The numbers above do not all reach as far back as the window does, and the
          page has to say which. */}
      {partial && (
        <p className="font-space text-xs leading-relaxed text-ink-faint">
          Source and visitor figures start 12 Sep, when the sites moved to the new ingest, and
          locations start 14 Sep. Views before that date are counted but include bot traffic, which is
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

      {/* TEMPORARY — full width, below everything: it is a wide monospace table, and it
          renders nothing for any artist but the one being compared. */}
      <PostHogCheckSlot supabase={supabase} artistId={id} slug={artist.slug} now={now} />
    </div>
  )
}
