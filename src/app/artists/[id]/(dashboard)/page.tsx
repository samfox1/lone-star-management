import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished, type SectionDiff } from '@/lib/content'
import { compactNumber, formatTrend, seriesTrend, trendLineClass, trendTextClass } from '@/lib/format'
import { cx } from '@/lib/cx'
import { AreaChart } from '@/components/ui/charts'
import { KLabel, StatusDot } from '@/components/ui/ui'
import { artistDailyViews } from '@/app/roster-data'
import { DIFF_SECTIONS } from './sections'
import { requireArtist } from './_data'

function summarize(d: SectionDiff): string {
  if (!d.dirty) return 'Published'
  const parts: string[] = []
  if (d.added) parts.push(`${d.added} new`)
  if (d.edited) parts.push(`${d.edited} edited`)
  if (d.deleted) parts.push(`${d.deleted} removed`)
  return parts.join(', ')
}

// Lifted out of the component body so the analytics window isn't an impure call
// during render (react-hooks/purity).
function thirtyDaysAgoIso(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
}

const KPIS = [
  { type: 'play', label: 'Plays' },
  { type: 'link_click', label: 'Link clicks' },
  { type: 'ticket_click', label: 'Ticket clicks' },
  { type: 'buy_click', label: 'Buy clicks' },
] as const

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  // Four independent round-trips — the ownership gate, the dirty-nav diff, the 30-day
  // analytics summary, and the daily-views series — as ONE parallel wave, not a
  // waterfall. The counts group-by is exact SQL (RLS-scoped), so it never undercounts
  // past PostgREST's 1000-row cap.
  const [, diff, { data: rows }, series] = await Promise.all([
    requireArtist(id),
    diffUnpublished(supabase, id),
    supabase.rpc('analytics_summary', { p_artist_id: id, p_since: thirtyDaysAgoIso() }),
    artistDailyViews(supabase, id),
  ])
  const counts: Record<string, number> = {}
  for (const r of (rows ?? []) as { type: string; count: number }[]) counts[r.type] = Number(r.count)
  const trend = formatTrend(seriesTrend(series))

  return (
    <div className="space-y-10">
      {/* analytics band — real site views + honest trend empty state */}
      <section>
        <div className="flex items-baseline gap-3 font-space text-[44px] font-bold leading-none tracking-[-0.015em]">
          {compactNumber(counts.view ?? 0)}
          <span className={cx('text-sm font-bold', trendTextClass(trend.dir))}>{trend.label}</span>
        </div>
        <div className="mt-2 font-space text-xs uppercase tracking-[0.1em] text-ink-faint">
          Site views · last 30 days
        </div>

        <AreaChart values={series} className={cx('mt-4', trendLineClass(trend.dir))} height={140} />

        {/* KPI divider row */}
        <div className="mt-6 flex flex-wrap gap-y-6 border-y border-hairline py-5">
          {KPIS.map((k) => (
            <div
              key={k.type}
              className="min-w-[110px] flex-1 border-hairline pr-9 [&:not(:last-child)]:mr-9 [&:not(:last-child)]:border-r"
            >
              <div className="font-space text-[25px] font-bold tabular-nums tracking-[-0.02em]">
                {compactNumber(counts[k.type] ?? 0)}
              </div>
              <div className="mt-1.5 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {k.label}
              </div>
            </div>
          ))}
        </div>
      </section>

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
