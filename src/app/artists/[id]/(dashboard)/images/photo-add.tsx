'use client'

import { useEffect, useState } from 'react'
import { KLabel, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { MediaUploader } from '../media-uploader'

/**
 * The Photos page's "+ Add" — same collapsed-label toolbar trigger as the other
 * add buttons, opening a small modal with the image drop field (direct-to-
 * Storage upload, registered as a gallery_image).
 */
export function PhotoAddButton({ artistId }: { artistId: string }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add photo"
        aria-label="Add photo"
        className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
      >
        <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[70px] group-hover:pl-1 group-hover:pr-1.5">
          Add
        </span>
        <Icon name="plus" size={14} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className={modalCardClass}>
            <div className="border-b border-hairline pb-3.5">
              <KLabel>Photo</KLabel>
              <h2 className="text-lg font-bold leading-tight tracking-[-0.01em]">Add photos</h2>
            </div>
            <div className="mt-4">
              <MediaUploader artistId={artistId} purpose="gallery_image" folder="gallery" accept="image/*" label="Drop images or click to upload" />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
