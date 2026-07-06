'use client'

import { useState } from 'react'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { SectionToolbar } from '../section-toolbar'
import { CardGrid } from '../card-grid'
import { FilterBar } from '../filter-bar'
import { ReleaseCard, type Release } from '../releases/release-card'

type BoundAction = (formData: FormData) => void | Promise<void>
type Filter = 'all' | ReleaseType
type Sort = 'newest' | 'oldest' | 'az'

const CHIP_LABEL: Record<Filter, string> = {
  all: 'All',
  single: 'Singles',
  ep: 'EPs',
  album: 'Albums',
  featured: 'Featured',
}

const selectClass =
  'rounded-lg border border-hairline bg-paper px-2.5 py-2 text-sm text-ink outline-none focus:border-ink-faint'

function sorted(releases: Release[], sort: Sort): Release[] {
  const copy = [...releases]
  if (sort === 'az') return copy.sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'newest') return copy.sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
  // oldest: ascending, undated last
  return copy.sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'))
}

/**
 * Releases view for the Music tab: add/publish toolbar, a type filter (chips) +
 * sort, and the cover grid. Filtering/sorting is client-side over the full list
 * the server passed, so it's instant.
 */
export function ReleasesBrowser({
  releases,
  artistId,
  artistSlug,
  addAction,
  publishAction,
}: {
  releases: Release[]
  artistId: string
  artistSlug: string
  addAction: BoundAction
  publishAction: BoundAction
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('newest')

  const shown = sorted(
    releases.filter((r) => filter === 'all' || r.release_type === filter),
    sort,
  )

  return (
    <div className="space-y-5">
      <SectionToolbar
        count={releases.length}
        singular="release"
        plural="releases"
        addLabel="Add release"
        publishAction={publishAction}
      >
        <form action={addAction} className="flex flex-wrap items-center gap-2">
          <input name="title" placeholder="Title" required autoFocus className={`${inputClass} w-44`} />
          <select name="release_type" defaultValue="single" className={selectClass}>
            {RELEASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {RELEASE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <input name="release_date" type="date" className={`${inputClass} w-40`} />
          <input name="cover_url" type="url" placeholder="Cover image URL" className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </form>
      </SectionToolbar>

      <FilterBar
        chips={(['all', ...RELEASE_TYPES] as Filter[]).map((k) => ({ key: k, label: CHIP_LABEL[k] }))}
        active={filter}
        onChip={setFilter}
        sortOptions={[
          { key: 'newest', label: 'Newest' },
          { key: 'oldest', label: 'Oldest' },
          { key: 'az', label: 'A–Z' },
        ]}
        sort={sort}
        onSort={setSort}
      />

      <CardGrid
        size="md"
        count={shown.length}
        empty={filter === 'all' ? 'No releases yet.' : `No ${CHIP_LABEL[filter].toLowerCase()} yet.`}
      >
        {shown.map((r) => (
          <ReleaseCard key={r.id} artistId={artistId} artistSlug={artistSlug} release={r} />
        ))}
      </CardGrid>
    </div>
  )
}
