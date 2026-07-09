'use client'

import { useState } from 'react'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SectionToolbar } from '../section-toolbar'
import { SaveForm } from '../save-form'
import { CardGrid } from '../card-grid'
import { FilterBar } from '../filter-bar'
import { TrackCard, type Track, type ReleaseOption } from '../tracks/track-card'

export type BrowserTrack = Track & { created_at: string }

type AddAction = (formData: FormData) => Promise<{ error?: string }>
type PublishAction = () => Promise<{ error?: string }>
type Sort = 'catalog' | 'newest' | 'az'

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  spotify: 'Spotify',
  apple: 'Apple',
  deezer: 'Deezer',
  bandsintown: 'Bandsintown',
  shopify: 'Shopify',
}

const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s

/**
 * Tracks view for the Music tab: add/publish toolbar, a source filter (chips) +
 * sort, and the cover grid. Client-side over the full list; "Catalog" keeps the
 * synced order the server returned.
 */
export function TracksBrowser({
  tracks,
  artistId,
  releases,
  addAction,
  publishAction,
}: {
  tracks: BrowserTrack[]
  artistId: string
  releases: ReleaseOption[]
  addAction: AddAction
  publishAction: PublishAction
}) {
  const [source, setSource] = useState<string>('all')
  const [sort, setSort] = useState<Sort>('catalog')

  const sources = Array.from(new Set(tracks.map((t) => t.source ?? 'manual')))

  let shown = source === 'all' ? tracks : tracks.filter((t) => (t.source ?? 'manual') === source)
  if (sort === 'az') shown = [...shown].sort((a, b) => a.title.localeCompare(b.title))
  else if (sort === 'newest') shown = [...shown].sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <div className="space-y-5">
      <SectionToolbar
        count={tracks.length}
        singular="track"
        plural="tracks"
        addLabel="Add track"
        publishAction={publishAction}
      >
        <SaveForm action={addAction} savedMessage="Track added" resetOnSuccess className="flex items-center gap-2">
          <input name="title" placeholder="Track title" required autoFocus className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </SaveForm>
      </SectionToolbar>

      {tracks.length > 0 && (
        <FilterBar
          chips={[
            { key: 'all', label: 'All' },
            ...(sources.length > 1 ? sources.map((s) => ({ key: s, label: sourceLabel(s) })) : []),
          ]}
          active={source}
          onChip={setSource}
          sortOptions={[
            { key: 'catalog', label: 'Catalog' },
            { key: 'newest', label: 'Newest' },
            { key: 'az', label: 'A–Z' },
          ]}
          sort={sort}
          onSort={setSort}
        />
      )}

      <CardGrid
        size="sm"
        count={shown.length}
        empty={source === 'all' ? 'None yet.' : `No ${sourceLabel(source)} tracks.`}
      >
        {shown.map((t) => (
          <TrackCard key={t.id} artistId={artistId} track={t} releases={releases} />
        ))}
      </CardGrid>
    </div>
  )
}
