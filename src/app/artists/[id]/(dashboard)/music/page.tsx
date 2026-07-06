import Link from 'next/link'
import { cx } from '@/lib/cx'
import { requireArtist } from '../_data'
import { TracksSection } from './tracks-section'
import { ReleasesSection } from './releases-section'

type View = 'tracks' | 'releases'

/**
 * Music tab — Tracks and Releases under one roof, swapped by a segmented control
 * (?view=). Consolidates what used to be two separate top-nav tabs. Catalog
 * import lives in the Integrations hub (Manager tools), not here.
 */
export default async function MusicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { id } = await params
  const { view: raw } = await searchParams
  await requireArtist(id) // non-owner → 404
  const view: View = raw === 'releases' ? 'releases' : 'tracks'

  const tab = (v: View, label: string) => (
    <Link
      href={`/artists/${id}/music${v === 'releases' ? '?view=releases' : ''}`}
      aria-current={view === v ? 'page' : undefined}
      className={cx(
        'rounded-lg px-3.5 py-1.5 font-space text-xs font-semibold tracking-[0.02em] transition-colors',
        view === v ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
      )}
    >
      {label}
    </Link>
  )

  return (
    <section>
      <div className="flex items-center justify-between border-b border-hairline pb-3">
        <h1 className="text-[19px] font-bold tracking-[-0.01em]">Music</h1>
        <div className="inline-flex gap-1 rounded-xl border border-hairline bg-paper p-1">
          {tab('tracks', 'Tracks')}
          {tab('releases', 'Releases')}
        </div>
      </div>

      <div className="mt-6">
        {view === 'tracks' ? <TracksSection id={id} /> : <ReleasesSection id={id} />}
      </div>
    </section>
  )
}
