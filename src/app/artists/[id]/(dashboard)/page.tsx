import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished, type SectionDiff } from '@/lib/content'
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

const METRICS = [
  { type: 'view', label: 'Views' },
  { type: 'play', label: 'Plays' },
  { type: 'link_click', label: 'Link clicks' },
  { type: 'ticket_click', label: 'Ticket clicks' },
  { type: 'buy_click', label: 'Buy clicks' },
] as const

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id)
  const diff = await diffUnpublished(supabase, id)

  // Last-30-day insights (RLS scopes the read to the owner).
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: events } = await supabase
    .from('analytics_events')
    .select('type')
    .eq('artist_id', id)
    .gte('created_at', since)
  const counts: Record<string, number> = {}
  for (const e of events ?? []) counts[e.type] = (counts[e.type] ?? 0) + 1

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Overview
      </h1>

      <section>
        <h2 className="text-sm font-medium text-zinc-500">Insights · last 30 days</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {METRICS.map((m) => (
            <li
              key={m.type}
              className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
            >
              <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {counts[m.type] ?? 0}
              </div>
              <div className="text-xs text-zinc-500">{m.label}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-500">Unpublished changes</h2>
        <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {DIFF_SECTIONS.map((s) => {
            const d = diff[s.key]
            return (
              <li key={s.key} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <Link
                  href={`/artists/${id}/${s.seg}`}
                  className="font-medium text-zinc-800 hover:underline dark:text-zinc-200"
                >
                  {s.label}
                </Link>
                <span
                  className={
                    d.dirty
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-zinc-400 dark:text-zinc-500'
                  }
                >
                  {summarize(d)}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-xs text-zinc-500">
          Use a section&apos;s <strong>Publish</strong> button, or <strong>Publish all</strong> above.
        </p>
      </section>
    </div>
  )
}
