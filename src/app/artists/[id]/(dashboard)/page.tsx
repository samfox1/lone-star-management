import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished, type SectionDiff } from '@/lib/content'
import { requireArtist } from './_data'

const SECTIONS = [
  { key: 'profile', label: 'Site / profile', href: 'site' },
  { key: 'track', label: 'Tracks', href: 'tracks' },
  { key: 'tour_date', label: 'Tour dates', href: 'tour' },
  { key: 'merch', label: 'Merch', href: 'merch' },
  { key: 'link', label: 'Links', href: 'links' },
  { key: 'media', label: 'Media', href: 'site' },
  { key: 'site_content', label: 'Site text', href: 'site' },
] as const

function summarize(d: SectionDiff): string {
  if (!d.dirty) return 'Published'
  const parts: string[] = []
  if (d.added) parts.push(`${d.added} new`)
  if (d.edited) parts.push(`${d.edited} edited`)
  if (d.deleted) parts.push(`${d.deleted} removed`)
  return parts.join(', ')
}

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id)
  const diff = await diffUnpublished(supabase, id)

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Overview
      </h1>

      <section>
        <h2 className="text-sm font-medium text-zinc-500">Unpublished changes</h2>
        <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {SECTIONS.map((s) => {
            const d = diff[s.key as keyof typeof diff]
            return (
              <li key={s.key} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <Link
                  href={`/artists/${id}/${s.href}`}
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
