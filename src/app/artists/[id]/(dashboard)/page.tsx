import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished, type SectionDiff } from '@/lib/content'
import { EVENT_TYPES } from '@/lib/events'
import { KLabel, StatusDot } from '@/components/ui/ui'
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

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id)
  const diff = await diffUnpublished(supabase, id)

  // Last-30-day insights: exact SQL group-by (RLS scopes to the owner), so the
  // counts don't silently undercount past PostgREST's 1000-row cap.
  const { data: rows } = await supabase.rpc('analytics_summary', {
    p_artist_id: id,
    p_since: thirtyDaysAgoIso(),
  })
  const counts: Record<string, number> = {}
  for (const r of (rows ?? []) as { type: string; count: number }[]) counts[r.type] = Number(r.count)

  return (
    <div className="space-y-10">
      <section>
        <KLabel>Insights · last 30 days</KLabel>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {EVENT_TYPES.map((m) => (
            <div key={m.type} className="rounded-xl border border-hairline px-4 py-3.5">
              <div className="font-space text-2xl font-bold tabular-nums tracking-[-0.02em]">
                {counts[m.type] ?? 0}
              </div>
              <div className="mt-1 font-space text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </section>

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
          Use a section&apos;s <strong className="font-bold text-ink-muted">Publish</strong> button, or{' '}
          <strong className="font-bold text-ink-muted">Publish all</strong> above.
        </p>
      </section>
    </div>
  )
}
