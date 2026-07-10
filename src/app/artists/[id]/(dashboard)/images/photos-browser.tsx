'use client'

import { useState, type ReactNode } from 'react'
import { KLabel } from '@/components/ui/ui'
import { mediaUrl } from '@/lib/site'
import { FilterBar } from '../filter-bar'
import { CardGrid } from '../card-grid'
import { EmptyState } from '../empty-state'
import { MediaDeleteButton } from '../media-delete-button'

export type PhotoItem = { id: string; storage_path: string; created_at: string }

type Sort = 'newest' | 'oldest'

/**
 * Photos — the Videos page's layout without the publish machinery, the
 * Videos/Shorts split, or a Refresh (nothing to pull): count + sort toolbar
 * with the same trailing buttons (Drive import · + Add), then the tile grid.
 * Hover a tile to delete.
 */
export function PhotosBrowser({
  photos,
  artistId,
  trailing,
}: {
  photos: PhotoItem[]
  artistId: string
  trailing?: ReactNode
}) {
  const [sort, setSort] = useState<Sort>('newest')

  const shown = [...photos].sort((a, b) =>
    sort === 'newest' ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at),
  )

  return (
    <div className="space-y-6">
      <FilterBar
        leading={
          <KLabel>
            {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
          </KLabel>
        }
        chips={[]}
        active=""
        onChip={() => {}}
        sortOptions={[
          { key: 'newest', label: 'Newest' },
          { key: 'oldest', label: 'Oldest' },
        ]}
        sort={sort}
        onSort={setSort}
        trailing={trailing}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon="photo"
          title="No photos yet"
          hint="Upload images or import them from the connected Drive folder."
        />
      ) : (
        <CardGrid size="md" count={shown.length}>
          {shown.map((m) => (
            <div key={m.id} className="group relative overflow-hidden rounded-2xl border border-hairline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(m.storage_path)} alt="" className="aspect-square w-full object-cover" />
              <span className="absolute right-1.5 top-1.5 rounded-md bg-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                <MediaDeleteButton
                  mediaId={m.id}
                  storagePath={m.storage_path}
                  artistId={artistId}
                  noun="Photo"
                  className="rounded-md px-2 py-1 text-xs font-medium text-accent-red transition-colors hover:bg-danger-soft"
                />
              </span>
            </div>
          ))}
        </CardGrid>
      )}
    </div>
  )
}
