'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { KLabel } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { mediaThumbUrl, mediaUrl } from '@/lib/site'
import { FilterBar } from '../filter-bar'
import { CardGrid } from '../card-grid'
import { EmptyState } from '../empty-state'
import { MediaDeleteButton } from '../media-delete-button'
import { OnSiteFilter, filterBySite, siteEmptyTitle, type SiteFilter } from '../on-site-filter'

export type PhotoItem = { id: string; storage_path: string; created_at: string; on_site: boolean }

type Sort = 'newest' | 'oldest'

/** Full-image lightbox: dark backdrop, the image centred, a black × (top-right) to exit.
 *  Click-outside or Escape also closes it. */
function Lightbox({ photo, onClose }: { photo: PhotoItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink shadow-lg transition-transform hover:scale-105"
      >
        <Icon name="plus" size={20} className="rotate-45" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaUrl(photo.storage_path)}
        alt=""
        className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />
    </div>
  )
}

/**
 * Photos — the Videos page's layout without the publish machinery, the
 * Videos/Shorts split, or a Refresh (nothing to pull): count + On-site/Off-site
 * lens + sort toolbar with the same trailing buttons (Drive import · + Add),
 * then the tile grid. Click a tile to view the full image; hover to delete.
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
  const [site, setSite] = useState<SiteFilter>('all')
  const [lightbox, setLightbox] = useState<PhotoItem | null>(null)

  const shown = filterBySite([...photos], site).sort((a, b) =>
    sort === 'newest' ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at),
  )

  return (
    <div className="space-y-6">
      <FilterBar
        leading={
          <div className="flex flex-wrap items-center gap-3">
            <KLabel>
              {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
            </KLabel>
            <OnSiteFilter value={site} onChange={setSite} />
          </div>
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
          title={siteEmptyTitle(site, 'No photos yet')}
          hint="Upload images or import them from the connected Drive folder."
        />
      ) : (
        <CardGrid size="md" count={shown.length}>
          {shown.map((m) => (
            <div key={m.id} className="group relative overflow-hidden rounded-2xl border border-hairline">
              {/* Click the tile to open the full image. Downscaled thumbnail (the grid cell is
                  ~200px, not 4MP); fall back to the full object ONCE if the transform can't
                  handle this image. */}
              <button type="button" onClick={() => setLightbox(m)} className="block w-full" aria-label="View full image">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaThumbUrl(m.storage_path)}
                  alt=""
                  className="aspect-square w-full object-cover"
                  onError={(e) => {
                    const img = e.currentTarget
                    const full = mediaUrl(m.storage_path)
                    if (img.src !== full) img.src = full
                  }}
                />
              </button>
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

      {lightbox && <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
